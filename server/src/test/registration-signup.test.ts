/**
 * 注册与验证码 契约测试。
 *
 * 两步注册、邮箱占用、60 秒重发窗口、错码累计作废、验证阶段用户名竞争。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { outbox } from '../services/mailer.js';
import { codeFromInbox, otherCode, post, startContract, stopContract } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('注册是两步的：第一步只发码不建号，验证码通过才建号', async () => {
  const short = await post('/api/v1/auth/register', { username: 'ab', password: 'password', email: 'a@b.com' });
  assert.strictEqual(short.body.ok, false);

  const weak = await post('/api/v1/auth/register', { username: 'tester01', password: '123', email: 'a@b.com' });
  assert.strictEqual(weak.body.ok, false);

  const badEmail = await post('/api/v1/auth/register', { username: 'tester01', password: 'password', email: 'nope' });
  assert.strictEqual(badEmail.body.ok, false);

  const email = 'tester01@example.com';
  const applied = await post('/api/v1/auth/register', {
    username: 'tester01',
    password: 'password',
    email,
  });
  assert.strictEqual(applied.body.ok, true, `申请发码失败：${JSON.stringify(applied.body)}`);
  assert.strictEqual(applied.body.email, email, '要告诉用户码发到了哪个邮箱');
  assert.ok(applied.body.expiresInSec >= 60, '要给出有效期');
  assert.ok(applied.body.resendAfterSec >= 30, '要给出多久之后能重发');
  assert.strictEqual(applied.body.token, undefined, '第一步不该发令牌');
  assert.strictEqual(applied.body.refreshToken, undefined, '第一步不该发刷新令牌');
  assert.strictEqual(applied.body.user, undefined, '第一步还没建账号，不该有用户态');

  // 「先验证邮箱、通过后才建账号」的核心：没验证的申请不能变成能登录的账号
  const notYet = await post('/api/v1/auth/login', { username: 'tester01', password: 'password' });
  assert.strictEqual(notYet.body.ok, false, '邮箱没验证就等于没注册，这一步不该能登录');

  const { code, mail } = codeFromInbox(email);
  assert.ok(mail.subject.includes('注册'), `邮件主题要写明用途：${mail.subject}`);
  assert.ok(mail.text.includes('10 分钟'), '邮件要写上有效期');

  const wrong = await post('/api/v1/auth/register/verify', { email, code: otherCode(code) });
  assert.strictEqual(
    wrong.status,
    200,
    `错码应当走 200 + ok:false 信封，实际 ${wrong.status}：${JSON.stringify(wrong.body)}`,
  );
  assert.strictEqual(wrong.body.ok, false, `错码不该通过：${JSON.stringify(wrong.body)}`);
  assert.ok(wrong.body.error.includes('验证码'), `错码要说明是验证码的问题：${wrong.body.error}`);
  const stillNot = await post('/api/v1/auth/login', { username: 'tester01', password: 'password' });
  assert.strictEqual(stillNot.body.ok, false, '错码之后仍然不该有账号');

  const registeredDeviceToken = 'register-device-token-123';
  const created = await post('/api/v1/auth/register/verify', {
    email,
    code,
    deviceToken: registeredDeviceToken,
    deviceName: 'New Phone',
  });
  assert.strictEqual(created.body.ok, true, `验证失败：${JSON.stringify(created.body)}`);
  assert.strictEqual(created.body.user.role, 'user', '自助注册固定为普通用户');
  assert.strictEqual(created.body.user.email, email);
  assert.ok(created.body.token, '验证通过后应当直接进入登录态');
  const remembered = await pool.query(
    `SELECT 1 FROM trusted_devices d JOIN users u ON u.id = d.user_id
      WHERE u.username = $1 AND d.name = $2`,
    ['tester01', 'New Phone'],
  );
  assert.strictEqual(remembered.rowCount, 1, '注册设备应当默认记为可信设备');

  // 邮箱当场就是已验证状态：它就是刚刚被验证过的那个
  const stored = await pool.query('SELECT email_verified, email_verified_at FROM users WHERE lower(email) = $1', [
    email,
  ]);
  assert.strictEqual(stored.rows.length, 1, '验证通过后应当建出账号');
  assert.strictEqual(stored.rows[0].email_verified, true, '新账号的邮箱必须是已验证状态');
  assert.ok(stored.rows[0].email_verified_at);

  // 建出来的账号能正常登录（会话不是一次性的）
  const signedIn = await post('/api/v1/auth/login', { username: 'tester01', password: 'password' });
  assert.strictEqual(signedIn.body.ok, true, `验证建的账号应当能登录：${JSON.stringify(signedIn.body)}`);

  // 同一枚码不能再用第二次
  const replay = await post('/api/v1/auth/register/verify', { email, code });
  assert.strictEqual(replay.body.ok, false, '同一枚验证码不该能重复使用');

  // 用户名与邮箱各自唯一，且都在第一步就查出来（不必等用户输完码）
  const duplicateName = await post('/api/v1/auth/register', {
    username: 'tester01',
    password: 'password',
    email: 'tester01-other@example.com',
  });
  assert.strictEqual(duplicateName.body.ok, false);
  assert.ok(duplicateName.body.error.includes('用户名已被注册'), `错误文案要具体：${duplicateName.body.error}`);
});

test('邮箱已被注册时在第一步就拦下，不发码也不建号', async () => {
  const before = outbox().length;
  const applied = await post('/api/v1/auth/register', {
    username: 'fresh01',
    password: 'password',
    email: 'demo@example.com',
  });
  assert.strictEqual(applied.body.ok, false, 'demo@example.com 是示例管理员的邮箱，不该被重复注册');
  assert.ok(applied.body.error.includes('邮箱已被注册'), `错误文案要具体：${applied.body.error}`);
  assert.strictEqual(outbox().length, before, '被拦下时不该发码');
});

test('同一邮箱 60 秒内不能重复发码，且要说清多久能重试', async () => {
  const email = 'cooldown01@example.com';
  const first = await post('/api/v1/auth/register', { username: 'cooldown01', password: 'password', email });
  assert.strictEqual(first.body.ok, true, `第一次发码就失败了：${JSON.stringify(first.body)}`);

  const second = await post('/api/v1/auth/register', { username: 'cooldown01', password: 'password', email });
  assert.strictEqual(second.status, 429, '60 秒内重复发码应当按限流拒绝');
  assert.ok(second.body.error.includes('秒'), `要告诉用户多久能重试：${second.body.error}`);
});

test('错码累计到上限后这枚码作废，必须重新获取', async () => {
  const email = 'attempts01@example.com';
  const applied = await post('/api/v1/auth/register', { username: 'attempts01', password: 'password', email });
  assert.strictEqual(applied.body.ok, true, JSON.stringify(applied.body));
  const { code } = codeFromInbox(email);
  const wrong = otherCode(code);

  for (let i = 1; i <= 5; i += 1) {
    const attempt = await post('/api/v1/auth/register/verify', { email, code: wrong });
    assert.strictEqual(
      attempt.body.ok,
      false,
      `第 ${i} 次错码不该通过：status=${attempt.status} body=${JSON.stringify(attempt.body)}`,
    );
  }

  // 试满 5 次之后，连正确的码也不认了：这枚码已经作废
  const blocked = await post('/api/v1/auth/register/verify', { email, code });
  assert.strictEqual(blocked.body.ok, false, '作废的码不该还能通过');
  assert.ok(/重新获取/.test(blocked.body.error), `应当提示重新获取：${blocked.body.error}`);
  const never = await post('/api/v1/auth/login', { username: 'attempts01', password: 'password' });
  assert.strictEqual(never.body.ok, false, '一直没验证成功，就不该有账号');
});

test('发码到验证之间用户名被占用时，验证阶段给出可读提示而不是 500', async () => {
  const email = 'race01@example.com';
  const applied = await post('/api/v1/auth/register', { username: 'race01', password: 'password', email });
  assert.strictEqual(applied.body.ok, true, JSON.stringify(applied.body));

  // 模拟另一个请求抢先完成注册，把用户名占掉
  await pool.query(`
        INSERT INTO users (id, username, password_hash, email, nickname, role)
        VALUES ('usr-race01', 'race01', 'not-a-real-hash', 'race01-other@example.com', 'race01', 'user')
    `);
  try {
    const { code } = codeFromInbox(email);
    const verified = await post('/api/v1/auth/register/verify', { email, code });
    assert.strictEqual(verified.status, 200, '业务冲突是 200 + ok:false，不该是 500');
    assert.strictEqual(verified.body.ok, false);
    assert.ok(verified.body.error.includes('已被注册'), `要给出可读原因：${verified.body.error}`);
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-race01'");
  }
});
