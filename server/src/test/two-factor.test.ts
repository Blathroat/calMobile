/**
 * 两步验证与可信设备 契约测试。
 *
 * 密码正确只发预认证票、过码才发令牌、可信设备跳过验证、会话撤销。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import {
  codeFromInbox,
  createVerifiedAccount,
  del,
  get,
  identityTicket,
  login,
  otherCode,
  post,
  startContract,
  stopContract,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/**
 * 读用户行上的最近登录记录，方便断言「哪一步才算一次登录」。
 *
 * 需求 11：最近登录不是只写时间，而是时间 + 客户端 IP + 离线解析的地区；
 * 密码只走到第一步（还没过码）时不该刷新它。
 */
async function loginRecord(userId: string) {
  const result = await pool.query<{
    last_login_time: Date | null;
    last_login_ip: string;
    last_login_region: string;
  }>('SELECT last_login_time, last_login_ip, last_login_region FROM users WHERE id = $1', [userId]);
  return result.rows[0];
}

/** 清空最近登录记录：紧跟着的那条登录路径必须自己重新把它写回来。 */
async function clearLoginRecord(userId: string): Promise<void> {
  await pool.query(
    "UPDATE users SET last_login_time = NULL, last_login_ip = '', last_login_region = '' WHERE id = $1",
    [userId],
  );
}

test('开启两步验证后，密码对了也只发预认证票，过码才发令牌', async () => {
  await createVerifiedAccount('usr-2fa', 'twofactor', 'twofactor@example.com');
  try {
    const session = await login('twofactor');

    // 开启第一步：验证码发到已验证邮箱，且回给页面的是打码后的地址
    const enableProof = await identityTicket(session.token, 'twofactor@example.com', 'factor');
    const enable = await post('/api/v1/profile/2fa/enable', { stepUpToken: enableProof }, { token: session.token });
    assert.strictEqual(enable.body.ok, true, `开启失败：${JSON.stringify(enable.body)}`);
    assert.ok(enable.body.maskedEmail, '要告诉用户码发到哪个邮箱了');
    assert.ok(!enable.body.maskedEmail.includes('twofactor@'), `邮箱应当打码：${enable.body.maskedEmail}`);

    const enableCode = codeFromInbox('twofactor@example.com');
    const enabled = await post(
      '/api/v1/profile/2fa/enable/verify',
      { code: enableCode.code },
      { token: session.token },
    );
    assert.strictEqual(enabled.body.ok, true, `验证码通过却没开起来：${JSON.stringify(enabled.body)}`);
    assert.strictEqual(enabled.body.twoFactorEnabled, true);

    // 再登录：密码正确，但**没有令牌**，只有一张票。
    // 先把最近登录记录清空：只拿到预认证票不算登录，过码之后才该重新写回来。
    await clearLoginRecord('usr-2fa');
    const step1 = await post('/api/v1/auth/login', { username: 'twofactor', password: 'password' });
    assert.strictEqual(step1.body.ok, true, JSON.stringify(step1.body));
    assert.strictEqual(step1.body.twoFactorRequired, true, '应当进入两步验证');
    assert.strictEqual(step1.body.token, undefined, '两步验证没过之前不能有访问令牌');
    assert.strictEqual(step1.body.refreshToken, undefined, '更不能有刷新令牌');
    assert.strictEqual(step1.body.user, undefined, '这一步也不该下发用户态');
    assert.ok(step1.body.ticket, '要给出预认证票');
    assert.strictEqual((await loginRecord('usr-2fa'))?.last_login_time ?? null, null, '只拿到票这一步不算登录');

    const loginCode = codeFromInbox('twofactor@example.com');
    const wrong = await post('/api/v1/auth/login/verify', {
      ticket: step1.body.ticket,
      code: otherCode(loginCode.code),
    });
    assert.strictEqual(wrong.body.ok, false, '错码不该通过');
    assert.strictEqual(wrong.body.token, undefined, '错码之后仍然不能有令牌');

    const done = await post('/api/v1/auth/login/verify', { ticket: step1.body.ticket, code: loginCode.code });
    assert.strictEqual(done.body.ok, true, `过码后应当登录成功：${JSON.stringify(done.body)}`);
    assert.ok(done.body.token && done.body.refreshToken, '过码后才发令牌');
    assert.strictEqual(done.body.user.username, 'twofactor');
    // 两步验证通过是一次真正的登录：最近登录时间、IP 与地区都要刷新。
    const afterVerify = await loginRecord('usr-2fa');
    assert.ok(afterVerify?.last_login_time, '两步验证通过后要写最近登录时间');
    assert.strictEqual(afterVerify?.last_login_ip, '127.0.0.1', '两步验证通过后要记客户端 IP');
    assert.strictEqual(afterVerify?.last_login_region, '内网', '本机来源是回环地址，地区记成内网');

    // 同一张票不能再用（单次使用）
    const replay = await post('/api/v1/auth/login/verify', { ticket: step1.body.ticket, code: loginCode.code });
    assert.strictEqual(replay.body.ok, false, '预认证票只能用一次');

    // 关闭也要先用当前邮箱身份复核；旧的密码字段不能绕过复核。
    const noProof = await post('/api/v1/profile/2fa/disable', { password: 'password' }, { token: done.body.token });
    assert.strictEqual(noProof.body.ok, false, '只提交密码不应能关闭两步验证');
    const proof = await identityTicket(done.body.token, 'twofactor@example.com', 'factor');
    const disabled = await post('/api/v1/profile/2fa/disable', { stepUpToken: proof }, { token: done.body.token });
    assert.strictEqual(disabled.body.ok, true, JSON.stringify(disabled.body));

    const plain = await post('/api/v1/auth/login', { username: 'twofactor', password: 'password' });
    assert.ok(plain.body.token, '关掉之后应当恢复成一步登录');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-2fa'");
  }
});

test('可信设备跳过二步验证，设备管理可立即撤销单台或全部会话', async () => {
  await createVerifiedAccount('usr-devices', 'deviceowner', 'devices@example.com');
  try {
    const base = await login('deviceowner');
    const enableProof = await identityTicket(base.token, 'devices@example.com', 'factor');
    const enable = await post('/api/v1/profile/2fa/enable', { stepUpToken: enableProof }, { token: base.token });
    assert.strictEqual(enable.body.ok, true);
    const setupCode = codeFromInbox('devices@example.com').code;
    const enabled = await post('/api/v1/profile/2fa/enable/verify', { code: setupCode }, { token: base.token });
    assert.strictEqual(enabled.body.ok, true);

    const deviceToken = 'persistent-device-secret-a1b2c3';
    const challenge = await post('/api/v1/auth/login', {
      username: 'deviceowner',
      password: 'password',
      deviceToken,
      deviceName: 'QA Laptop',
    });
    assert.strictEqual(challenge.body.twoFactorRequired, true);
    const loginCode = codeFromInbox('devices@example.com').code;
    const verified = await post('/api/v1/auth/login/verify', {
      ticket: challenge.body.ticket,
      code: loginCode,
      deviceToken,
      deviceName: 'QA Laptop',
      trustDevice: true,
    });
    assert.strictEqual(verified.body.ok, true);

    // 可信设备跳过二步验证也是真正的登录：清空记录后必须被这次登录重新写回来。
    await clearLoginRecord('usr-devices');
    const trustedLogin = await post('/api/v1/auth/login', {
      username: 'deviceowner',
      password: 'password',
      deviceToken,
      deviceName: 'QA Laptop',
    });
    assert.strictEqual(trustedLogin.body.ok, true);
    assert.strictEqual(trustedLogin.body.trustedDevice, true);
    assert.strictEqual(trustedLogin.body.twoFactorRequired, undefined);
    const trustedRecord = await loginRecord('usr-devices');
    assert.ok(trustedRecord?.last_login_time, '可信设备跳过验证也要写最近登录时间');
    assert.strictEqual(trustedRecord?.last_login_ip, '127.0.0.1');
    assert.strictEqual(trustedRecord?.last_login_region, '内网');

    const listed = await get('/api/v1/profile/sessions', { token: trustedLogin.body.token });
    assert.strictEqual(listed.status, 200);
    const device = listed.body.sessions.find((item: { deviceName: string }) => item.deviceName === 'QA Laptop');
    assert.ok(device, `应显示可信设备：${JSON.stringify(listed.body)}`);
    assert.strictEqual(device.current, true);
    assert.ok(!JSON.stringify(listed.body).includes(deviceToken), '设备列表不得泄露可重用的本机凭据');

    const revoked = await del(`/api/v1/profile/sessions/${encodeURIComponent(device.id)}`, {
      token: trustedLogin.body.token,
    });
    assert.strictEqual(revoked.body.ok, true);
    const invalidated = await get('/api/v1/profile', { token: trustedLogin.body.token });
    assert.strictEqual(invalidated.status, 401, '下线设备后访问令牌也应立即失效');

    // 下线全部会话会一并清除可信设备，之后同一设备也必须重新过码。
    const all = await post('/api/v1/profile/sessions/revoke-all', undefined, { token: base.token });
    assert.strictEqual(all.body.ok, true);
    const baseInvalidated = await get('/api/v1/profile', { token: base.token });
    assert.strictEqual(baseInvalidated.status, 401);
    // 清除测试中上一封已消费验证码产生的冷却，模拟下一次真实登录可重新发码。
    await pool.query("DELETE FROM email_codes WHERE user_id = $1 AND purpose = 'login'", ['usr-devices']);
    const relogin = await post('/api/v1/auth/login', {
      username: 'deviceowner',
      password: 'password',
      deviceToken,
      deviceName: 'QA Laptop',
    });
    assert.strictEqual(relogin.body.twoFactorRequired, true, '全部下线后不应继续信任旧设备凭据');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-devices'");
  }
});
