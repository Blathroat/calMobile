/**
 * 操作日志 契约测试。
 *
 * 管理端读取、权限、设置里的存储上限收敛、变更请求自动落一条日志、
 * 级别筛选与按大小上限清理（直接调服务函数）。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { pruneLogs } from '../services/logs.js';
import { get, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

interface LogRow {
  id: string;
  level: string;
  category: string;
  message: string;
  actorName: string;
  method: string;
  path: string;
  status: number;
  ip: string;
  createdAt: string;
}

/** 写日志是旁路（响应先回、插库稍后），这里轮询等它落库。 */
async function waitForLog(
  options: { token: string; level?: string; query?: string },
  predicate: (row: LogRow) => boolean,
): Promise<{
  logs: LogRow[];
  stats: { usedBytes: number; entryCount: number; storageMb: number; limitBytes: number };
}> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const query: string[] = ['limit=500'];
    if (options.level) query.push(`level=${options.level}`);
    // harness 会统一 encodeURI 整条路径，这里给中文原文即可，别重复编码。
    if (options.query) query.push(`query=${options.query}`);
    const result = await get(`/api/v1/logs?${query.join('&')}`, { token: options.token });
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    const rows = result.body.logs as LogRow[];
    if (rows.some(predicate)) return { logs: rows, stats: result.body.stats };
    if (Date.now() > deadline) {
      const all = await get('/api/v1/logs?limit=20', { token: tokens.admin.token });
      throw new Error(`等待日志超时：${JSON.stringify(rows.slice(0, 5))}；全部=${JSON.stringify(all.body.logs)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

test('日志只有管理员能看，返回列表与用量', async () => {
  const anonymous = await get('/api/v1/logs');
  assert.strictEqual(anonymous.status, 401);

  const asUser = await get('/api/v1/logs', { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);

  const asAdmin = await get('/api/v1/logs', { token: tokens.admin.token });
  assert.strictEqual(asAdmin.status, 200);
  assert.ok(Array.isArray(asAdmin.body.logs));
  assert.strictEqual(typeof asAdmin.body.stats.storageMb, 'number');
  assert.strictEqual(typeof asAdmin.body.stats.limitBytes, 'number');
  assert.strictEqual(typeof asAdmin.body.stats.usedBytes, 'number');
  assert.strictEqual(typeof asAdmin.body.stats.entryCount, 'number');
  assert.strictEqual(asAdmin.body.stats.storageMb, 64, '默认保留 64 MB');
});

test('日志上限在设置里可改，越界值被收敛', async () => {
  const saved = await put('/api/v1/settings', { logs: { storageMb: 5 } }, { token: tokens.admin.token });
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.settings.logs.storageMb, 5);
  assert.strictEqual(typeof saved.body.settings.logs.usedBytes, 'number', '管理员能看到当前用量');

  const tooSmall = await put('/api/v1/settings', { logs: { storageMb: 0 } }, { token: tokens.admin.token });
  assert.strictEqual(tooSmall.body.settings.logs.storageMb, 1, '0 收敛到 1 MB');
  const tooBig = await put('/api/v1/settings', { logsStorageMb: 99999 }, { token: tokens.admin.token });
  assert.strictEqual(tooBig.body.settings.logs.storageMb, 10240, '超过上限收敛到 10240 MB，扁平写法也认');

  // 上面的越界收敛把上限改到了 10240，恢复成 5 再验证普通角色的读回与用量不下发。
  await put('/api/v1/settings', { logs: { storageMb: 5 } }, { token: tokens.admin.token });
  const asUser = await get('/api/v1/settings', { token: tokens.user.token });
  assert.strictEqual(asUser.body.logs.storageMb, 5);
  assert.strictEqual('usedBytes' in asUser.body.logs, false, '普通角色不下发用量');
});

test('变更请求会落一条日志，管理操作记下操作人', async () => {
  await put('/api/v1/settings', { themeIndex: 0 }, { token: tokens.admin.token });
  const found = await waitForLog({ token: tokens.admin.token }, (row) => row.path === '/api/v1/settings');
  const entry = found.logs.find((row) => row.path === '/api/v1/settings')!;
  assert.strictEqual(entry.level, 'info');
  assert.strictEqual(entry.method, 'PUT');
  assert.strictEqual(entry.category, 'settings');
  assert.strictEqual(entry.status, 200);
  assert.strictEqual(entry.actorName, tokens.admin.user?.nickname || tokens.admin.user?.username);
  assert.ok(entry.message.includes('PUT /api/v1/settings'));
});

test('登录失败被记成 warn，并能按级别/关键字筛出来', async () => {
  const failed = await post('/api/v1/auth/login', { username: 'demo', password: 'wrong-password' }, {});
  assert.strictEqual(failed.status, 200);
  assert.strictEqual(failed.body.ok, false);

  const warned = await waitForLog({ token: tokens.admin.token, level: 'warn', query: '登录失败' }, (row) =>
    row.message.includes('登录失败'),
  );
  assert.ok(warned.logs.every((row) => row.level === 'warn'));
  const hit = warned.logs.find((row) => row.message.includes('登录失败'))!;
  assert.ok(hit.message.includes('账号或密码') || hit.message.includes('失败'), hit.message);
  assert.strictEqual(hit.category, 'auth');

  const searched = await get('/api/v1/logs?query=登录', { token: tokens.admin.token });
  assert.strictEqual(searched.status, 200);
  assert.ok(
    (searched.body.logs as LogRow[]).every(
      (row) =>
        row.message.includes('登录') ||
        row.category.includes('登录') ||
        row.actorName.includes('登录') ||
        row.path.includes('登录'),
    ),
  );
});

test('超过大小上限时清理最早的日志', async () => {
  // 先把上限压到 1 MB，再塞 30 条 × 100 KB 的假日志（合计约 3 MB）。
  await put('/api/v1/settings', { logs: { storageMb: 1 } }, { token: tokens.admin.token });
  const insertedIds: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO app_logs (level, category, message, size_bytes, created_at)
       VALUES ('info', 'test', $1, $2, now() - make_interval(mins => $3)) RETURNING id`,
      [`假日志 ${index}`, 100 * 1024, 30 - index],
    );
    insertedIds.push(result.rows[0]!.id);
  }
  await pruneLogs();
  const stats = await pool.query<{ used: string; count: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS used, COUNT(*) AS count FROM app_logs`,
  );
  const used = Number(stats.rows[0]!.used);
  assert.ok(used <= 1024 * 1024, `清理后占用应不超过 1 MB，实际 ${used}`);
  // 最早的一条应已被删掉，最新写入的还在
  const older = await pool.query(`SELECT 1 FROM app_logs WHERE id = $1`, [insertedIds[0]]);
  assert.strictEqual(older.rowCount, 0, '最早插入的日志应被清理');
  const newest = await pool.query(`SELECT 1 FROM app_logs WHERE id = $1`, [insertedIds.at(-1)]);
  assert.strictEqual(newest.rowCount, 1, '最新插入的日志应保留');
});
