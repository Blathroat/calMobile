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

test('邀请码可以按天发展商时长，兑换后写入到期时间', async () => {
  const created = await post(
    '/api/v1/settings/invites',
    { uses: 1, validHours: 7, durationDays: 30 },
    { token: tokens.admin.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  assert.strictEqual(created.body.settings.invite.durationDays, 30);
  const invite = created.body.invites[0];
  assert.strictEqual(invite.durationDays, 30);

  await createVerifiedAccount('usr-timed', 'timeduser', 'timeduser@example.com');
  const session = await login('timeduser');
  const redeemed = await post('/api/v1/profile/invite', { code: invite.code }, { token: session.token });
  assert.strictEqual(redeemed.body.ok, true, JSON.stringify(redeemed.body));
  assert.strictEqual(redeemed.body.user.role, 'exhibitor');
  const days = (new Date(redeemed.body.user.exhibitorExpiresAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29 && days < 31, `到期时间应约在 30 天后，实际 ${days} 天`);

  const stored = await pool.query('SELECT exhibitor_expires_at FROM users WHERE id = $1', ['usr-timed']);
  assert.ok(stored.rows[0]?.exhibitor_expires_at, '到期时间要落库');
});

test('限时展商续兑从原到期时间顺延，0 天码转为永久', async () => {
  const first = await post(
    '/api/v1/settings/invites',
    { uses: 1, validHours: 7, durationDays: 30 },
    { token: tokens.admin.token },
  );
  await createVerifiedAccount('usr-renew', 'renewer', 'renewer@example.com');
  const session = await login('renewer');
  const opened = await post('/api/v1/profile/invite', { code: first.body.invites[0].code }, { token: session.token });
  assert.strictEqual(opened.body.ok, true, JSON.stringify(opened.body));
  const firstExpiry = new Date(opened.body.user.exhibitorExpiresAt).getTime();

  const second = await post(
    '/api/v1/settings/invites',
    { uses: 1, validHours: 7, durationDays: 10 },
    { token: tokens.admin.token },
  );
  const extended = await post(
    '/api/v1/profile/invite',
    { code: second.body.invites[0].code },
    { token: session.token },
  );
  assert.strictEqual(extended.body.ok, true, JSON.stringify(extended.body));
  const extendedExpiry = new Date(extended.body.user.exhibitorExpiresAt).getTime();
  const added = (extendedExpiry - firstExpiry) / 86_400_000;
  assert.ok(added > 9.9 && added < 10.1, `续期应顺延约 10 天，实际 ${added} 天`);

  const permanent = await post(
    '/api/v1/settings/invites',
    { uses: 1, validHours: 7, durationDays: 0 },
    { token: tokens.admin.token },
  );
  const upgraded = await post(
    '/api/v1/profile/invite',
    { code: permanent.body.invites[0].code },
    { token: session.token },
  );
  assert.strictEqual(upgraded.body.ok, true, JSON.stringify(upgraded.body));
  assert.strictEqual(upgraded.body.user.exhibitorExpiresAt, '', '0 天码把限时展商转成永久');

  // 永久展商没有可续的时长：再次兑换是业务失败，且不消耗次数。
  const before = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [
    permanent.body.invites[0].code,
  ]);
  const again = await post(
    '/api/v1/profile/invite',
    { code: permanent.body.invites[0].code },
    { token: session.token },
  );
  assert.strictEqual(again.body.ok, false);
  assert.match(String(again.body.error), /已经是展商/);
  const after = await pool.query('SELECT used_count FROM exhibitor_invites WHERE code = $1', [
    permanent.body.invites[0].code,
  ]);
  assert.strictEqual(Number(after.rows[0]?.used_count), Number(before.rows[0]?.used_count));
});

test('展商到期后自动降为普通用户，展商功能被收回', async () => {
  await createVerifiedAccount('usr-expired', 'expireduser', 'expireduser@example.com');
  await pool.query(
    `UPDATE users SET role = 'exhibitor', accept_meetings = true, exhibitor_expires_at = now() - interval '1 day'
      WHERE id = 'usr-expired'`,
  );
  const session = await login('expireduser');

  // 任意一次鉴权请求先把角色结算成普通用户
  const boot = await get('/api/v1/bootstrap', { token: session.token });
  assert.strictEqual(boot.body.user.role, 'user', JSON.stringify(boot.body.user));
  assert.strictEqual(boot.body.user.can.exhibitor, false);
  assert.strictEqual(boot.body.user.exhibitorExpired, true);
  assert.ok(boot.body.user.exhibitorExpiresAt);
  const stored = await pool.query('SELECT role, accept_meetings FROM users WHERE id = $1', ['usr-expired']);
  assert.strictEqual(stored.rows[0]?.role, 'user');
  assert.strictEqual(stored.rows[0]?.accept_meetings, false);

  const exhibition = await post('/api/v1/exhibitions', {}, { token: session.token });
  assert.strictEqual(exhibition.status, 403);
  assert.match(String(exhibition.body.error), /展商身份已到期/);
  const meetingSettings = await get('/api/v1/meetings/settings', { token: session.token });
  assert.strictEqual(meetingSettings.status, 403);

  // 公开页也不再显示展商，且会议入口关闭
  const publicPage = await get('/api/v1/users/public?userId=usr-expired');
  assert.strictEqual(publicPage.body.roleCode, 'user');
  assert.strictEqual(publicPage.body.meetingsOpen, false);
});

test('到期展商即使没登录过，也不能再接受新的会议预约', async () => {
  await createVerifiedAccount('usr-expired-host', 'expiredhost', 'expiredhost@example.com');
  await pool.query(
    `UPDATE users SET role = 'exhibitor', accept_meetings = true, exhibitor_expires_at = now() - interval '1 hour'
      WHERE id = 'usr-expired-host'`,
  );
  const apply = await get('/api/v1/meetings/apply/usr-expired-host', { token: tokens.user.token });
  assert.strictEqual(apply.body.open, false, JSON.stringify(apply.body));
  const created = await post(
    '/api/v1/meetings',
    { exhibitorId: 'usr-expired-host', meetingDate: '2099-01-01', meetingTime: '10:00' },
    { token: tokens.user.token },
  );
  assert.strictEqual(created.body.ok, false, JSON.stringify(created.body));
  assert.match(String(created.body.error), /暂不接受/);
});

test('管理员改角色时设置或清空展商到期时间', async () => {
  await createVerifiedAccount('usr-role-move', 'rolemove', 'rolemove@example.com');
  await pool.query(
    `UPDATE users SET role = 'exhibitor', exhibitor_expires_at = now() + interval '3 days'
      WHERE id = 'usr-role-move'`,
  );
  // 手动设成展商视为永久
  const promoted = await put('/api/v1/users/usr-role-move/role', { role: 'exhibitor' }, { token: tokens.admin.token });
  assert.strictEqual(promoted.body.ok, true, JSON.stringify(promoted.body));
  const permanent = await pool.query('SELECT role, exhibitor_expires_at FROM users WHERE id = $1', ['usr-role-move']);
  assert.strictEqual(permanent.rows[0]?.role, 'exhibitor');
  assert.strictEqual(permanent.rows[0]?.exhibitor_expires_at, null, '手动设展商是永久');

  // 降级时清掉到期时间，避免显示成“展商已到期”
  await pool.query(`UPDATE users SET exhibitor_expires_at = now() + interval '3 days' WHERE id = 'usr-role-move'`);
  const demoted = await put('/api/v1/users/usr-role-move/role', { role: 'user' }, { token: tokens.admin.token });
  assert.strictEqual(demoted.body.ok, true, JSON.stringify(demoted.body));
  const cleared = await pool.query('SELECT role, exhibitor_expires_at FROM users WHERE id = $1', ['usr-role-move']);
  assert.strictEqual(cleared.rows[0]?.role, 'user');
  assert.strictEqual(cleared.rows[0]?.exhibitor_expires_at, null);
});

test('管理员用户列表带展商到期字段', async () => {
  await createVerifiedAccount('usr-list-timed', 'listtimed', 'listtimed@example.com');
  await pool.query(
    `UPDATE users SET role = 'exhibitor', exhibitor_expires_at = now() + interval '7 days'
      WHERE id = 'usr-list-timed'`,
  );
  const listed = await get('/api/v1/users', { token: tokens.admin.token });
  const row = listed.body.find((item: { id: string }) => item.id === 'usr-list-timed');
  assert.ok(row, '用户列表里应有这个账号');
  assert.strictEqual(row.roleCode, 'exhibitor');
  assert.ok(row.exhibitorExpiresAt, '限时展商要下发到期时间');
  assert.strictEqual(row.exhibitorExpired, false);
});

test('管理设置才列出邀请码，普通用户看不到这份名单', async () => {
  const admin = await get('/api/v1/settings', { token: tokens.admin.token });
  assert.strictEqual(typeof admin.body.invite.uses, 'number');
  assert.strictEqual(typeof admin.body.invite.validHours, 'number');
  assert.strictEqual(typeof admin.body.invite.durationDays, 'number');
  assert.ok(Array.isArray(admin.body.invites));
  const user = await get('/api/v1/settings', { token: tokens.user.token });
  assert.strictEqual(user.body.invites, undefined);
  const denied = await post('/api/v1/settings/invites', { uses: 1, validHours: 7 }, { token: tokens.user.token });
  assert.strictEqual(denied.status, 403);
});
