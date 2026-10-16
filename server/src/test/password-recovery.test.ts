/**
 * 找回密码 契约测试。
 *
 * 忘记密码不透露邮箱是否存在、验证码通过后改密码并撤销全部刷新令牌、一码一用。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { pool } from '../config/pool.js';
import { outbox } from '../services/mailer.js';
import { codeFromInbox, login, otherCode, post, startContract, stopContract } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('找回密码不透露邮箱是否存在，但确实给已注册邮箱发码', async () => {
  const before = outbox().length;

  const unknown = await post('/api/v1/auth/password/forgot', {
    email: `nobody-${Date.now().toString(36)}@example.com`,
  });
  assert.strictEqual(unknown.body.ok, true, '不存在的邮箱也要回 ok，否则这个接口就是账号枚举器');
  assert.strictEqual(outbox().length, before, '不存在的邮箱不该真的发信');

  const known = await post('/api/v1/auth/password/forgot', { email: 'user@example.com' });
  assert.strictEqual(known.body.ok, true, `已注册邮箱发码失败：${JSON.stringify(known.body)}`);
  assert.deepStrictEqual(
    Object.keys(known.body).sort(),
    Object.keys(unknown.body).sort(),
    '两种情况返回的字段必须完全一致，否则照样能枚举出账号是否存在',
  );
  assert.strictEqual(known.body.email, 'user@example.com');
  assert.strictEqual(outbox().length, before + 1, '已注册邮箱要真的收到码');

  // 格式不对时照常给提示：这不泄露任何账号信息
  const invalid = await post('/api/v1/auth/password/forgot', { email: 'nope' });
  assert.strictEqual(invalid.body.ok, false);
  assert.ok(invalid.body.error.includes('邮箱'), invalid.body.error);
});

test('找回密码：验证码通过后改密码、撤销全部刷新令牌，且一码一用', async () => {
  const email = 'reset-target@example.com';
  await pool.query(
    `
        INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified)
        VALUES ('usr-reset', 'resettarget', $1, $2, 'resettarget', 'user', true)
        ON CONFLICT (id) DO UPDATE
            SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email
    `,
    [await bcrypt.hash('password', 4), email],
  );

  try {
    // 先在「另一台设备」上登录，改完密码这套刷新令牌必须失效
    const session = await login('resettarget');

    const asked = await post('/api/v1/auth/password/forgot', { email });
    assert.strictEqual(asked.body.ok, true, JSON.stringify(asked.body));
    const { code, mail } = codeFromInbox(email);
    assert.ok(mail.subject.includes('找回密码'), `邮件主题要写明用途：${mail.subject}`);

    // 两次密码不一致不该把这枚码烧掉（校验在消费之前）
    const mismatch = await post('/api/v1/auth/password/reset', {
      email,
      code,
      newPassword: 'brand-new-1',
      confirmPassword: 'brand-new-2',
    });
    assert.strictEqual(mismatch.body.ok, false);
    assert.ok(mismatch.body.error.includes('不一致'), mismatch.body.error);

    // 错码要被拒
    const wrong = await post('/api/v1/auth/password/reset', {
      email,
      code: otherCode(code),
      newPassword: 'brand-new-1',
      confirmPassword: 'brand-new-1',
    });
    assert.strictEqual(wrong.status, 200, `业务失败应当是 200 信封，实际 ${wrong.status}`);
    assert.strictEqual(wrong.body.ok, false);

    // 前面两次都没消费掉它，这个码仍然可用
    const done = await post('/api/v1/auth/password/reset', {
      email,
      code,
      newPassword: 'brand-new-1',
      confirmPassword: 'brand-new-1',
    });
    assert.strictEqual(done.body.ok, true, `重置失败：${JSON.stringify(done.body)}`);

    const oldPassword = await post('/api/v1/auth/login', { username: 'resettarget', password: 'password' });
    assert.strictEqual(oldPassword.body.ok, false, '旧密码必须失效');
    const newPassword = await post('/api/v1/auth/login', { username: 'resettarget', password: 'brand-new-1' });
    assert.strictEqual(newPassword.body.ok, true, `新密码应当能登录：${JSON.stringify(newPassword.body)}`);

    // 找回密码通常意味着密码可能已经泄露：其它设备上的登录状态要一起断掉
    const stale = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
    assert.strictEqual(stale.status, 401, '重置密码后旧刷新令牌必须失效');

    // 同一枚码不能再改一次
    const again = await post('/api/v1/auth/password/reset', {
      email,
      code,
      newPassword: 'another-1',
      confirmPassword: 'another-1',
    });
    assert.strictEqual(again.body.ok, false, '同一枚码不该能重复使用');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-reset'");
  }
});
