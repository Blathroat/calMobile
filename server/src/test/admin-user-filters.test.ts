/**
 * 管理端用户列表筛选 契约测试。
 *
 * `GET /users` 的身份 / 状态筛选与关键字搜索同时生效：
 * - `role` 只认 user / exhibitor / admin，`status` 只认 active / limited / banned；
 *   空串与无法识别的值按不过滤处理，不返回 4xx。
 * - 无筛选时结果与改造前一致（全部用户，按注册时间、id 排序）。
 * - 角色按批量结算后的 `users.role` 过滤：已到期展商先降级，不会出现在展商列表里。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { pool } from '../config/pool.js';
import {
  createVerifiedAccount,
  get,
  put,
  startContract,
  stopContract,
  tokens,
  type HttpResponse,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/** 以管理员身份列用户；筛选参数直接拼在查询串里，和页面发请求的方式一致。 */
function list(query = ''): Promise<HttpResponse> {
  return get(`/api/v1/users${query}`, { token: tokens.admin.token });
}

test('无筛选时返回全部用户，空串与无法识别的筛选值不改变结果', async () => {
  const plain = await list();
  assert.strictEqual(plain.status, 200, JSON.stringify(plain.body));
  assert.ok(Array.isArray(plain.body), '用户列表应当直接返回数组');

  // 与库里的用户集合、排序完全一致：无筛选就是改造前的行为。
  const stored = await pool.query<{ id: string }>('SELECT id FROM users ORDER BY registration_time, id');
  assert.deepStrictEqual(
    plain.body.map((row: { id: string }) => row.id),
    stored.rows.map((row) => row.id),
  );

  // 页面切到「全部」时会把 role / status 写成空串；无法识别的值（含旧前端可能传的）都按不过滤处理。
  assert.deepStrictEqual((await list('?role=&status=')).body, plain.body);
  assert.deepStrictEqual((await list('?role=guest&status=deleted')).body, plain.body);
});

test('role 只返回对应身份的用户，三种身份加起来就是全部用户', async () => {
  const exhibitors = await list('?role=exhibitor');
  assert.ok(exhibitors.body.length > 0, '种子数据里至少有一位展商');
  assert.ok(exhibitors.body.every((row: { roleCode: string }) => row.roleCode === 'exhibitor'));
  assert.ok(
    exhibitors.body.some((row: { id: string }) => row.id === 'usr-2'),
    '永久展商应当出现在展商列表',
  );

  const admins = await list('?role=admin');
  assert.ok(admins.body.length > 0, '种子数据里至少有一位管理员');
  assert.ok(admins.body.every((row: { roleCode: string }) => row.roleCode === 'admin'));
  assert.ok(admins.body.some((row: { id: string }) => row.id === 'usr-1'));

  const users = await list('?role=user');
  assert.ok(users.body.length > 0, '种子数据里至少有一位普通用户');
  assert.ok(users.body.every((row: { roleCode: string }) => row.roleCode === 'user'));
  assert.ok(users.body.some((row: { id: string }) => row.id === 'usr-3'));

  // 身份互斥：三种筛选结果没有重叠，拼起来正好是全部用户。
  const all = await list();
  const total = exhibitors.body.length + admins.body.length + users.body.length;
  assert.strictEqual(total, all.body.length, '三种身份的条数加起来应当等于全部用户');
});

test('status 只返回对应账号状态，封禁与受限互不串台', async () => {
  const before = await list('?status=banned');
  assert.ok(before.body.every((row: { statusCode: string }) => row.statusCode === 'banned'));

  // 用例自己封禁再还原：usr-3 是种子普通用户，后面的用例还要用。
  const banned = await put('/api/v1/users/usr-3/status', { status: 'banned' }, { token: tokens.admin.token });
  assert.strictEqual(banned.body.ok, true, JSON.stringify(banned.body));
  assert.strictEqual(banned.body.user.statusCode, 'banned');
  try {
    const rows = await list('?status=banned');
    assert.ok(rows.body.every((row: { statusCode: string }) => row.statusCode === 'banned'));
    assert.ok(
      rows.body.some((row: { id: string }) => row.id === 'usr-3'),
      '刚封禁的账号应当出现在封禁列表',
    );

    // 其它状态不再包含它：状态筛选是精确匹配，不是「非正常」这类宽口径。
    const limited = await list('?status=limited');
    assert.ok(limited.body.every((row: { statusCode: string }) => row.statusCode === 'limited'));
    assert.strictEqual(
      limited.body.some((row: { id: string }) => row.id === 'usr-3'),
      false,
    );
    const active = await list('?status=active');
    assert.ok(active.body.every((row: { statusCode: string }) => row.statusCode === 'active'));
    assert.strictEqual(
      active.body.some((row: { id: string }) => row.id === 'usr-3'),
      false,
    );

    // 三种状态加起来仍然是全部用户。
    const all = await list();
    assert.strictEqual(active.body.length + limited.body.length + rows.body.length, all.body.length);
  } finally {
    const restored = await put('/api/v1/users/usr-3/status', { status: 'active' }, { token: tokens.admin.token });
    assert.strictEqual(restored.body.ok, true, '封禁状态没有还原，后续用例会被污染');
  }
});

test('role + status + query 组合生效（三个条件是 AND）', async () => {
  await createVerifiedAccount('usr-filter-combo', 'filtercombo', 'filtercombo@example.com');
  const banned = await put(
    '/api/v1/users/usr-filter-combo/status',
    { status: 'banned' },
    {
      token: tokens.admin.token,
    },
  );
  assert.strictEqual(banned.body.ok, true, JSON.stringify(banned.body));
  try {
    const matched = await list('?role=user&status=banned&query=filtercombo');
    assert.deepStrictEqual(
      matched.body.map((row: { id: string }) => row.id),
      ['usr-filter-combo'],
    );

    // 关键字命中了，但身份 / 状态不符时仍然不返回：说明条件是 AND。
    assert.deepStrictEqual((await list('?role=admin&status=banned&query=filtercombo')).body, []);
    assert.deepStrictEqual((await list('?role=user&status=active&query=filtercombo')).body, []);
    // 身份与状态都命中，但关键字对不上时也不返回。
    assert.deepStrictEqual((await list('?role=user&status=banned&query=no-such-filter-keyword')).body, []);

    // 关键字照旧在昵称 / 用户名 / 邮箱三列上 ILIKE（大小写不敏感）。
    for (const keyword of ['filtercom', 'FILTERCOMBO', 'filtercombo@example.com']) {
      const rows = await list(`?query=${keyword}`);
      assert.deepStrictEqual(
        rows.body.map((row: { id: string }) => row.id),
        ['usr-filter-combo'],
        `关键字 ${keyword} 应当命中昵称 / 用户名 / 邮箱`,
      );
    }
  } finally {
    const restored = await put(
      '/api/v1/users/usr-filter-combo/status',
      { status: 'active' },
      {
        token: tokens.admin.token,
      },
    );
    assert.strictEqual(restored.body.ok, true);
  }
});

test('身份筛选按结算后的 users.role：已到期展商只出现在普通用户列表', async () => {
  await createVerifiedAccount('usr-filter-expired', 'filterexpired', 'filterexpired@example.com');
  // 直接把库里的角色做成「已到期」：列表请求会先批量结算，再按结算后的 users.role 过滤。
  await pool.query(
    `UPDATE users SET role = 'exhibitor', accept_meetings = true, exhibitor_expires_at = now() - interval '1 day'
      WHERE id = $1`,
    ['usr-filter-expired'],
  );

  const exhibitors = await list('?role=exhibitor');
  assert.strictEqual(
    exhibitors.body.some((row: { id: string }) => row.id === 'usr-filter-expired'),
    false,
    '已到期的展商不该出现在展商列表',
  );

  const users = await list('?role=user');
  const row = users.body.find((item: { id: string }) => item.id === 'usr-filter-expired');
  assert.ok(row, '结算后它应当出现在普通用户列表');
  assert.strictEqual(row.roleCode, 'user');
  assert.strictEqual(row.exhibitorExpired, true, '到期时间仍保留，管理页据此说明原因');

  const stored = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', ['usr-filter-expired']);
  assert.strictEqual(stored.rows[0]?.role, 'user', '批量结算应当已经写回 users.role');
});
