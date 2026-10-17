/**
 * 邀请码与权限调整 契约测试。
 *
 * 错误码不发邮件；有效码注册或兑换后成为展商并消耗次数；
 * 管理员不能改自己，也不能去掉最后一位管理员。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { outbox } from '../services/mailer.js';
import {
  codeFromInbox,
  createVerifiedAccount,
  del,
  get,
  login,
  post,
  put,
  startContract,
  stopContract,
  tokens,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('登录用户态带上 id，私人会议链接才能拼出报名站地址', () => {
  assert.strictEqual(tokens.admin.user.id, 'usr-1');
  assert.strictEqual(tokens.exhibitor.user.id, 'usr-2');
  assert.strictEqual(tokens.user.user.id, 'usr-3');
});

test('错误的邀请码不发邮件，也不建账号', async () => {
  const before = outbox().length;
  const applied = await post('/api/v1/auth/register', {
    username: 'badinvite',
    password: 'password',
    email: 'badinvite@example.com',
    inviteCode: 'not-a-code',
  });
  assert.strictEqual(applied.status, 200);
  assert.strictEqual(applied.body.ok, false);
  assert.match(String(applied.body.error), /邀请码无效/);
  assert.strictEqual(outbox().length, before, '无效码不该发注册邮件');
  const stored = await pool.query('SELECT 1 FROM users WHERE username = $1', ['badinvite']);
  assert.strictEqual(stored.rowCount, 0);
});

test('有效邀请码注册后成为展商，并记一次使用', async () => {
  const created = await post('/api/v1/settings/invites', { uses: 2, validHours: 0 }, { token: tokens.admin.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  assert.strictEqual(created.body.settings.invite.uses, 2);
  assert.strictEqual(created.body.settings.invite.validHours, 0);
  const invite = created.body.invites[0];
  assert.strictEqual(invite.maxUses, 2);
  assert.strictEqual(invite.usedCount, 0);
  assert.strictEqual(invite.expiresAt, '');
  assert.strictEqual(invite.status, 'available');

  const email = 'invited01@example.com';
  const applied = await post('/api/v1/auth/register', {
    username: 'invited01',
    password: 'password',
    email,
    inviteCode: String(invite.code).toLowerCase(),
  });
  assert.strictEqual(applied.body.ok, true, JSON.stringify(applied.body));
  const { code } = codeFromInbox(email);
  const verified = await post('/api/v1/auth/register/verify', { email, code });
  assert.strictEqual(verified.body.ok, true, JSON.stringify(verified.body));
  assert.strictEqual(verified.body.user.role, 'exhibitor');
  assert.ok(verified.body.user.id);

  const used = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [invite.code]);
  assert.strictEqual(Number(used.rows[0]?.used_count), 1);
});

test('用完的邀请码在发邮件之前就拒绝', async () => {
  const created = await post('/api/v1/settings/invites', { uses: 1, validHours: 7 }, { token: tokens.admin.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const invite = created.body.invites[0];
  const email = 'spent01@example.com';
  const applied = await post('/api/v1/auth/register', {
    username: 'spent01',
    password: 'password',
    email,
    inviteCode: invite.code,
  });
  assert.strictEqual(applied.body.ok, true, JSON.stringify(applied.body));
  const verified = await post('/api/v1/auth/register/verify', { email, code: codeFromInbox(email).code });
  assert.strictEqual(verified.body.ok, true, JSON.stringify(verified.body));

  const before = outbox().length;
  const again = await post('/api/v1/auth/register', {
    username: 'spent02',
    password: 'password',
    email: 'spent02@example.com',
    inviteCode: invite.code,
  });
  assert.strictEqual(again.body.ok, false);
  assert.match(String(again.body.error), /已用完/);
  assert.strictEqual(outbox().length, before);
});

test('删除和过期的邀请码不能注册', async () => {
  const created = await post('/api/v1/settings/invites', { uses: 1, validHours: 7 }, { token: tokens.admin.token });
  const invite = created.body.invites[0];
  const removed = await del(`/api/v1/settings/invites/${invite.id}`, { token: tokens.admin.token });
  assert.strictEqual(removed.body.ok, true, JSON.stringify(removed.body));
  assert.strictEqual(
    removed.body.invites.find((item: { id: string }) => item.id === invite.id),
    undefined,
  );

  const before = outbox().length;
  const blocked = await post('/api/v1/auth/register', {
    username: 'revoked01',
    password: 'password',
    email: 'revoked01@example.com',
    inviteCode: invite.code,
  });
  assert.strictEqual(blocked.body.ok, false);
  assert.match(String(blocked.body.error), /无效/);
  assert.strictEqual(outbox().length, before);

  await pool.query(
    `INSERT INTO exhibitor_invites (id, code, max_uses, expires_at, created_by)
     VALUES ('inv-expired', 'EXPIRED1', 1, now() - interval '1 day', 'usr-1')`,
  );
  const expired = await post('/api/v1/auth/register', {
    username: 'expired01',
    password: 'password',
    email: 'expired01@example.com',
    inviteCode: 'expired1',
  });
  assert.strictEqual(expired.body.ok, false);
  assert.match(String(expired.body.error), /已过期/);
  const gone = await pool.query(`SELECT id FROM exhibitor_invites WHERE id = 'inv-expired'`);
  assert.strictEqual(gone.rowCount, 0);
  const again = await post('/api/v1/auth/register', {
    username: 'expired02',
    password: 'password',
    email: 'expired02@example.com',
    inviteCode: 'expired1',
  });
  assert.strictEqual(again.body.ok, false);
  assert.match(String(again.body.error), /无效/);
});

test('普通用户兑换邀请码后成为展商，展商再兑不会消耗次数', async () => {
  const created = await post('/api/v1/settings/invites', { uses: 3, validHours: 7 }, { token: tokens.admin.token });
  const invite = created.body.invites[0];
  await createVerifiedAccount('usr-redeem', 'redeemer', 'redeemer@example.com');
  const session = await login('redeemer');
  const redeemed = await post(
    '/api/v1/profile/invite',
    { code: ` ${String(invite.code).toLowerCase()} ` },
    { token: session.token },
  );
  assert.strictEqual(redeemed.body.ok, true, JSON.stringify(redeemed.body));
  assert.strictEqual(redeemed.body.user.role, 'exhibitor');

  const again = await post('/api/v1/profile/invite', { code: invite.code }, { token: session.token });
  assert.strictEqual(again.body.ok, false);
  assert.match(String(again.body.error), /已经是展商/);
  const used = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [invite.code]);
  assert.strictEqual(Number(used.rows[0]?.used_count), 1);

  const adminTry = await post('/api/v1/profile/invite', { code: invite.code }, { token: tokens.admin.token });
  assert.strictEqual(adminTry.body.ok, false);
  assert.match(String(adminTry.body.error), /已经是管理员/);
  const still = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [invite.code]);
  assert.strictEqual(Number(still.rows[0]?.used_count), 1);
});

test('受限账号不能兑换邀请码', async () => {
  const created = await post('/api/v1/settings/invites', { uses: 1, validHours: 7 }, { token: tokens.admin.token });
  const limited = await put('/api/v1/users/usr-3/status', { status: '受限' }, { token: tokens.admin.token });
  assert.strictEqual(limited.body.ok, true, JSON.stringify(limited.body));
  const before = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [
    created.body.invites[0].code,
  ]);
  const denied = await post(
    '/api/v1/profile/invite',
    { code: created.body.invites[0].code },
    { token: tokens.user.token },
  );
  assert.strictEqual(denied.status, 403);
  assert.match(String(denied.body.error), /不能使用邀请码/);
  const after = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [
    created.body.invites[0].code,
  ]);
  assert.strictEqual(Number(after.rows[0]?.used_count), Number(before.rows[0]?.used_count));
  const restored = await put('/api/v1/users/usr-3/status', { status: '正常' }, { token: tokens.admin.token });
  assert.strictEqual(restored.body.ok, true, JSON.stringify(restored.body));
});

test('管理员调整别人的权限，不能改自己，也不能去掉最后一位管理员', async () => {
  const self = await put('/api/v1/users/usr-1/role', { role: 'user' }, { token: tokens.admin.token });
  assert.strictEqual(self.status, 200);
  assert.strictEqual(self.body.ok, false);
  assert.match(String(self.body.error), /不能修改自己的权限/);

  const stranger = await put('/api/v1/users/usr-3/role', { role: 'exhibitor' }, { token: tokens.user.token });
  assert.strictEqual(stranger.status, 403);

  const promoted = await put('/api/v1/users/usr-3/role', { role: 'exhibitor' }, { token: tokens.admin.token });
  assert.strictEqual(promoted.body.ok, true, JSON.stringify(promoted.body));
  assert.strictEqual(promoted.body.user.roleCode, 'exhibitor');
  await pool.query('UPDATE users SET accept_meetings = true WHERE id = $1', ['usr-3']);
  const demoted = await put('/api/v1/users/usr-3/role', { role: 'user' }, { token: tokens.admin.token });
  assert.strictEqual(demoted.body.ok, true, JSON.stringify(demoted.body));
  assert.strictEqual(demoted.body.user.roleCode, 'user');
  const meetings = await pool.query('SELECT accept_meetings, role FROM users WHERE id = $1', ['usr-3']);
  assert.strictEqual(meetings.rows[0]?.role, 'user');
  assert.strictEqual(meetings.rows[0]?.accept_meetings, false);

  const second = await put('/api/v1/users/usr-3/role', { role: 'admin' }, { token: tokens.admin.token });
  assert.strictEqual(second.body.ok, true, JSON.stringify(second.body));
  const back = await put('/api/v1/users/usr-3/role', { role: 'user' }, { token: tokens.admin.token });
  assert.strictEqual(back.body.ok, true, JSON.stringify(back.body));
  assert.strictEqual(back.body.user.roleCode, 'user');
  const admins = await pool.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id`);
  assert.deepStrictEqual(
    admins.rows.map((row) => row.id),
    ['usr-1'],
  );
});

test('管理设置才列出邀请码，普通用户看不到这份名单', async () => {
  const admin = await get('/api/v1/settings', { token: tokens.admin.token });
  assert.strictEqual(typeof admin.body.invite.uses, 'number');
  assert.strictEqual(typeof admin.body.invite.validHours, 'number');
  assert.ok(Array.isArray(admin.body.invites));
  const user = await get('/api/v1/settings', { token: tokens.user.token });
  assert.strictEqual(user.body.invites, undefined);
  const denied = await post('/api/v1/settings/invites', { uses: 1, validHours: 7 }, { token: tokens.user.token });
  assert.strictEqual(denied.status, 403);
});
