/**
 * 通行密钥 契约测试。
 *
 * 绑定 / 启用的完整链路需要真实认证器，测试不伪造签名：这里覆盖服务端自己能保证的部分 ——
 * 选项形状、身份复核、挑战一次一用、凭据列表的字段边界、最后一枚的删除保护、
 * 登录第一步的 methods.passkey、以及 passkey 方式下验证码通道被关掉。
 */

import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { loadProcessConfig } from '../config/env.js';
import {
  createVerifiedAccount,
  del,
  get,
  identityTicket,
  login,
  post,
  startContract,
  stopContract,
} from './contract-harness.js';

beforeAll(async () => {
  await startContract();
  await createVerifiedAccount('usr-pk', 'passkeyuser', 'passkey@example.com');
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = 'usr-pk'");
  await stopContract();
});

const BOGUS_REGISTRATION = {
  id: 'bogus-credential',
  rawId: 'bogus-credential',
  type: 'public-key',
  clientExtensionResults: {},
  response: { clientDataJSON: '', attestationObject: '' },
};

const BOGUS_ASSERTION = {
  id: 'test-credential',
  rawId: 'test-credential',
  type: 'public-key',
  clientExtensionResults: {},
  response: { clientDataJSON: '', authenticatorData: '', signature: '', userHandle: null },
};

async function seedCredential(id: string, credentialId: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO passkey_credentials (id, user_id, credential_id, public_key, counter, transports, name)
     VALUES ($1, 'usr-pk', $2, $3, 0, $4, $5)
     ON CONFLICT (credential_id) DO NOTHING`,
    [id, credentialId, 'AAAA', JSON.stringify(['internal']), name],
  );
}

test('绑定通行密钥：要身份复核、挑战一次一用、列表不下发安全字段', async () => {
  const session = await login('passkeyuser');

  const before = await get('/api/v1/profile/security', { token: session.token });
  assert.deepStrictEqual(before.body.passkeys, []);
  assert.strictEqual(before.body.passkeyBound, false);

  // 没有身份复核票不能拿注册选项
  const noProof = await post('/api/v1/profile/2fa/passkey/options', {}, { token: session.token });
  assert.strictEqual(noProof.status, 400);
  assert.strictEqual(noProof.body.errorCode, 'security.stepUpRequired');

  const proof = await identityTicket(session.token, 'passkey@example.com', 'factor');
  const optionsResponse = await post(
    '/api/v1/profile/2fa/passkey/options',
    { stepUpToken: proof },
    { token: session.token },
  );
  assert.strictEqual(optionsResponse.body.ok, true, JSON.stringify(optionsResponse.body));
  assert.ok(optionsResponse.body.challengeId);
  const options = optionsResponse.body.options;
  assert.strictEqual(options.rp.id, loadProcessConfig().webauthn.rpId);
  assert.match(options.challenge, /^[A-Za-z0-9_-]+$/);
  assert.match(options.user.id, /^[A-Za-z0-9_-]+$/);
  assert.strictEqual(options.authenticatorSelection.residentKey, 'preferred');
  assert.strictEqual(options.authenticatorSelection.userVerification, 'preferred');
  assert.deepStrictEqual(options.excludeCredentials, [], '还没有凭据时不该有排除项');

  // 伪造的注册响应必须被拒；挑战先被消费掉，重放同一个 challengeId 直接是「已过期」
  const bad = await post(
    '/api/v1/profile/2fa/passkey/verify',
    { challengeId: optionsResponse.body.challengeId, credential: BOGUS_REGISTRATION },
    { token: session.token },
  );
  assert.strictEqual(bad.body.ok, false, JSON.stringify(bad.body));
  assert.match(String(bad.body.errorCode), /^security\.passkey/);
  const replay = await post(
    '/api/v1/profile/2fa/passkey/verify',
    { challengeId: optionsResponse.body.challengeId, credential: BOGUS_REGISTRATION },
    { token: session.token },
  );
  assert.strictEqual(replay.body.ok, false);
  assert.strictEqual(replay.body.errorCode, 'security.passkeyChallenge');

  // 直接落一枚凭据（真实签名由浏览器产生，契约测试不伪造认证器）
  await seedCredential('pk-test-1', 'test-credential-1', '测试设备');
  const listed = await get('/api/v1/profile/security', { token: session.token });
  assert.strictEqual(listed.body.passkeyBound, true);
  assert.strictEqual(listed.body.passkeys.length, 1);
  assert.strictEqual(listed.body.passkeys[0].name, '测试设备');
  assert.deepStrictEqual(listed.body.passkeys[0].transports, ['internal']);
  assert.strictEqual(listed.body.passkeys[0].credentialId, undefined, '列表不得下发 credentialId');
  assert.strictEqual(listed.body.passkeys[0].publicKey, undefined, '列表不得下发公钥');

  // 最后一枚 + 当前方式就是 passkey：拒绝删除
  await pool.query("UPDATE users SET two_factor_enabled = true, two_factor_method = 'passkey' WHERE id = 'usr-pk'");
  const denied = await del('/api/v1/profile/2fa/passkey/pk-test-1', { token: session.token });
  assert.strictEqual(denied.body.ok, false);
  assert.strictEqual(denied.body.errorCode, 'security.passkeyLastOne');
  // 切到邮箱方式后可以删
  await pool.query("UPDATE users SET two_factor_method = 'email' WHERE id = 'usr-pk'");
  const removed = await del('/api/v1/profile/2fa/passkey/pk-test-1', { token: session.token });
  assert.strictEqual(removed.body.ok, true, JSON.stringify(removed.body));
  assert.deepStrictEqual(removed.body.passkeys, []);
});

test('启用通行密钥、登录第一步的 methods、验证码通道关闭与关闭后保留凭据', async () => {
  await pool.query("UPDATE users SET two_factor_enabled = false, two_factor_method = 'email' WHERE id = 'usr-pk'");
  await pool.query("DELETE FROM backup_codes WHERE user_id = 'usr-pk'");
  const session = await login('passkeyuser');

  // 一枚凭据都没有：启用被拒（errorCode 让前端提示先添加）
  const noPasskeyProof = await identityTicket(session.token, 'passkey@example.com', 'factor');
  const noPasskey = await post(
    '/api/v1/profile/2fa/passkey/enable',
    { stepUpToken: noPasskeyProof },
    { token: session.token },
  );
  assert.strictEqual(noPasskey.body.ok, false);
  assert.strictEqual(noPasskey.body.errorCode, 'security.passkeyRequired');

  await seedCredential('pk-test-2', 'test-credential', '登录设备');
  const enableProof = await identityTicket(session.token, 'passkey@example.com', 'factor');
  const enabled = await post(
    '/api/v1/profile/2fa/passkey/enable',
    { stepUpToken: enableProof },
    { token: session.token },
  );
  assert.strictEqual(enabled.body.ok, true, JSON.stringify(enabled.body));
  assert.strictEqual(enabled.body.twoFactorEnabled, true);
  assert.strictEqual(enabled.body.twoFactorMethod, 'passkey');
  // 切到通行密钥时如果还没有备用码，顺手补一批并回给前端（丢设备时就靠它）
  assert.strictEqual(enabled.body.backupCodes.length, 10, JSON.stringify(enabled.body.backupCodes));

  const security = await get('/api/v1/profile/security', { token: session.token });
  assert.strictEqual(security.body.twoFactorEnabled, true);
  assert.strictEqual(security.body.twoFactorMethod, 'passkey');
  assert.strictEqual(security.body.passkeyBound, true);
  assert.strictEqual(security.body.backupCodesLeft, 10);

  // 再启用一次：已有备用码就一枚都不动，响应里给空数组
  const againProof = await identityTicket(session.token, 'passkey@example.com', 'factor');
  const again = await post('/api/v1/profile/2fa/passkey/enable', { stepUpToken: againProof }, { token: session.token });
  assert.strictEqual(again.body.ok, true, JSON.stringify(again.body));
  assert.deepStrictEqual(again.body.backupCodes, [], '已有备用码时不轮换，避免悄悄作废旧码');

  const step1 = await post('/api/v1/auth/login', { username: 'passkeyuser', password: 'password' });
  assert.strictEqual(step1.body.twoFactorRequired, true);
  assert.strictEqual(step1.body.methods.passkey, true, '绑过凭据就要在第一步告诉前端');
  assert.strictEqual(step1.body.methods.email, false, '当前方式是 passkey 时不再发邮箱码');
  assert.strictEqual(step1.body.emailSent, false);
  assert.ok(step1.body.ticket);

  // 拿票换登录断言选项：allowCredentials 只放自己的凭据
  const options = await post('/api/v1/auth/login/passkey/options', { ticket: step1.body.ticket });
  assert.strictEqual(options.body.ok, true, JSON.stringify(options.body));
  assert.strictEqual(options.body.options.userVerification, 'preferred');
  assert.ok(
    options.body.options.allowCredentials.some((item: { id: string }) => item.id === 'test-credential'),
    `allowCredentials 缺少已绑定凭据：${JSON.stringify(options.body.options.allowCredentials)}`,
  );

  // 票不存在 / 过期：与现有登录验证同一句文案
  const invalidTicket = await post('/api/v1/auth/login/passkey/options', { ticket: 'not-a-real-ticket' });
  assert.strictEqual(invalidTicket.body.ok, false);
  assert.strictEqual(invalidTicket.body.error, '验证已过期，请重新登录');

  // 伪造的断言被拒，且不签发令牌；挑战一次一用
  const badVerify = await post('/api/v1/auth/login/passkey/verify', {
    ticket: step1.body.ticket,
    challengeId: options.body.challengeId,
    credential: BOGUS_ASSERTION,
  });
  assert.strictEqual(badVerify.body.ok, false);
  assert.strictEqual(badVerify.body.token, undefined);
  assert.strictEqual(badVerify.body.refreshToken, undefined);
  const verifyReplay = await post('/api/v1/auth/login/passkey/verify', {
    ticket: step1.body.ticket,
    challengeId: options.body.challengeId,
    credential: BOGUS_ASSERTION,
  });
  assert.strictEqual(verifyReplay.body.errorCode, 'security.passkeyChallenge');

  // passkey 方式下，邮箱验证码与验证器码都不能走
  const codeBlocked = await post('/api/v1/auth/login/code', { ticket: step1.body.ticket });
  assert.strictEqual(codeBlocked.body.ok, false);
  const verifyBlocked = await post('/api/v1/auth/login/verify', { ticket: step1.body.ticket, code: '000000' });
  assert.strictEqual(verifyBlocked.body.ok, false);
  assert.match(String(verifyBlocked.body.error), /通行密钥/);

  // 关闭两步验证保留已绑定的通行密钥（与保留 TOTP 密钥一致）
  const disableProof = await identityTicket(session.token, 'passkey@example.com', 'factor');
  const disabled = await post('/api/v1/profile/2fa/disable', { stepUpToken: disableProof }, { token: session.token });
  assert.strictEqual(disabled.body.ok, true, JSON.stringify(disabled.body));
  const after = await get('/api/v1/profile/security', { token: session.token });
  assert.strictEqual(after.body.twoFactorEnabled, false);
  assert.strictEqual(after.body.passkeyBound, true, '关闭两步验证不应删除通行密钥');
  assert.strictEqual(after.body.passkeys.length, 1);
});
