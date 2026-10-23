/**
 * TOTP 与备用码 契约测试。
 *
 * 验证器绑定要过码、登录三选一、备用码一次一枚、重新生成与轮换。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { codeFor } from '../domain/totp.js';
import { pool } from '../config/pool.js';
import {
  createVerifiedAccount,
  get,
  identityTicket,
  login,
  post,
  startContract,
  stopContract,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('验证器（TOTP）与备用码：绑定要过码，登录三选一，备用码一次一枚', async () => {
  await createVerifiedAccount('usr-totp', 'totpuser', 'totp@example.com');
  try {
    const session = await login('totpuser');

    // 配置验证器前要通过邮箱身份复核；密钥生成本身不打开两步验证。
    const noSetupProof = await post('/api/v1/profile/2fa/totp/setup', undefined, { token: session.token });
    assert.strictEqual(noSetupProof.status, 400, '没有身份复核票不能生成新密钥');
    const setupProof = await identityTicket(session.token, 'totp@example.com', 'totp');
    const setup = await post('/api/v1/profile/2fa/totp/setup', { stepUpToken: setupProof }, { token: session.token });
    assert.strictEqual(setup.body.ok, true, `生成密钥失败：${JSON.stringify(setup.body)}`);
    assert.match(setup.body.secret, /^[A-Z2-7]{32}$/, '密钥应当是 32 个 base32 字符');
    assert.ok(String(setup.body.otpauthUri).startsWith('otpauth://totp/'), '要给出验证器能扫的地址');
    assert.ok(setup.body.issuer, 'otpauth 里要带发行方');

    // 码不对不给绑，开关也不能开
    const farCode = codeFor(setup.body.secret, { at: Date.now() + 5 * 60 * 1000 });
    const wrong = await post(
      '/api/v1/profile/2fa/totp/enable',
      { code: farCode, stepUpToken: setup.body.stepUpToken },
      { token: session.token },
    );
    assert.strictEqual(wrong.body.ok, false, '漂移 5 分钟的码不该通过');
    let security = await get('/api/v1/profile/security', { token: session.token });
    assert.strictEqual(security.body.twoFactorEnabled, false, '没确认之前开关不该被打开');

    // 输对码 → 正式绑定，并带回一批备用码
    const bound = await post(
      '/api/v1/profile/2fa/totp/enable',
      { code: codeFor(setup.body.secret), stepUpToken: setup.body.stepUpToken },
      { token: session.token },
    );
    assert.strictEqual(bound.body.ok, true, `绑定失败：${JSON.stringify(bound.body)}`);
    assert.strictEqual(bound.body.backupCodes.length, 10, '开启时应当发一批备用码');
    security = await get('/api/v1/profile/security', { token: session.token });
    assert.strictEqual(security.body.twoFactorEnabled, true);
    assert.strictEqual(security.body.totpEnabled, true, '要能区分「绑过验证器」与「开关打开」');
    assert.strictEqual(security.body.backupCodesLeft, 10);

    // TOTP 身份复核每个会话五次上限；正确码通过后清空失败窗口。
    const wrongIdentityCode = codeFor(setup.body.secret, { at: Date.now() + 5 * 60 * 1000 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wrongIdentity = await post(
        '/api/v1/profile/security/verify',
        {
          method: 'totp',
          scope: 'password',
          code: wrongIdentityCode,
        },
        { token: session.token },
      );
      assert.strictEqual(wrongIdentity.body.ok, false);
    }
    const recoveredIdentity = await post(
      '/api/v1/profile/security/verify',
      {
        method: 'totp',
        scope: 'password',
        code: codeFor(setup.body.secret),
      },
      { token: session.token },
    );
    assert.strictEqual(recoveredIdentity.body.ok, true, '正确 TOTP 应可复核并清空失败次数');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrongIdentity = await post(
        '/api/v1/profile/security/verify',
        {
          method: 'totp',
          scope: 'password',
          code: wrongIdentityCode,
        },
        { token: session.token },
      );
      assert.strictEqual(wrongIdentity.body.ok, false);
    }
    const limitedIdentity = await post(
      '/api/v1/profile/security/verify',
      {
        method: 'totp',
        scope: 'password',
        code: wrongIdentityCode,
      },
      { token: session.token },
    );
    assert.strictEqual(limitedIdentity.status, 429, '并发猜码窗口达到上限后必须限流');
    await pool.query("DELETE FROM security_stepup_attempts WHERE user_id = 'usr-totp'");

    // 登录第一步要告诉页面能用哪些方式
    const step1 = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    assert.strictEqual(step1.body.twoFactorRequired, true);
    assert.deepStrictEqual(step1.body.methods, { totp: true, email: false, backup: true, passkey: false });
    assert.strictEqual(step1.body.token, undefined, '第一步仍然不能有令牌');
    const emailedDespiteTotp = await post('/api/v1/auth/login/code', { ticket: step1.body.ticket });
    assert.strictEqual(emailedDespiteTotp.body.ok, false, '选择 TOTP 后不能绕过选择改走邮箱验证码');

    // 用验证器码登录
    const viaTotp = await post('/api/v1/auth/login/verify', {
      ticket: step1.body.ticket,
      code: codeFor(setup.body.secret),
    });
    assert.strictEqual(viaTotp.body.ok, true, `验证器登录失败：${JSON.stringify(viaTotp.body)}`);
    assert.ok(viaTotp.body.token, '过码后应当发令牌');

    // 用备用码登录（换一张票）
    const step2 = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    const backupCode = bound.body.backupCodes[0];
    const viaBackup = await post('/api/v1/auth/login/verify', { ticket: step2.body.ticket, code: backupCode });
    assert.strictEqual(viaBackup.body.ok, true, `备用码登录失败：${JSON.stringify(viaBackup.body)}`);

    const step3 = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    const loose = bound.body.backupCodes[1].replace('-', '').toLowerCase();
    const viaLoose = await post('/api/v1/auth/login/verify', { ticket: step3.body.ticket, code: loose });
    assert.strictEqual(viaLoose.body.ok, true, `备用码的大小写与横线不该影响匹配：${JSON.stringify(viaLoose.body)}`);

    // 同一枚备用码不能用第二次
    const step4 = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    const replay = await post('/api/v1/auth/login/verify', { ticket: step4.body.ticket, code: backupCode });
    assert.strictEqual(replay.body.ok, false, '用过的备用码必须失效');
    security = await get('/api/v1/profile/security', { token: session.token });
    assert.strictEqual(security.body.backupCodesLeft, 8, '用掉两枚之后应当只剩 8 枚');

    // 重新生成会作废旧码
    const regenerated = await post(
      '/api/v1/profile/2fa/backup-codes',
      { password: 'password' },
      { token: session.token },
    );
    assert.strictEqual(regenerated.body.ok, true, JSON.stringify(regenerated.body));
    assert.strictEqual(regenerated.body.backupCodes.length, 10);
    assert.notDeepEqual(regenerated.body.backupCodes, bound.body.backupCodes);
    const step5 = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    const stale = await post('/api/v1/auth/login/verify', {
      ticket: step5.body.ticket,
      code: bound.body.backupCodes[2],
    });
    assert.strictEqual(stale.body.ok, false, '重新生成之后旧备用码必须失效');

    // 轮换前也要复核身份；旧密钥在新密钥确认前继续有效。
    const noRotateProof = await post(
      '/api/v1/profile/2fa/totp/setup',
      { stepUpToken: 'wrong-ticket' },
      { token: session.token },
    );
    assert.strictEqual(noRotateProof.status, 400);
    const rotateProof = await identityTicket(session.token, 'totp@example.com', 'totp', {
      method: 'totp',
      code: codeFor(setup.body.secret),
    });
    const rotatedSetup = await post(
      '/api/v1/profile/2fa/totp/setup',
      { stepUpToken: rotateProof },
      { token: session.token },
    );
    assert.strictEqual(rotatedSetup.body.ok, true);
    assert.notStrictEqual(rotatedSetup.body.secret, setup.body.secret);
    const wrongRotation = await post(
      '/api/v1/profile/2fa/totp/enable',
      {
        code: codeFor(rotatedSetup.body.secret, { at: Date.now() + 5 * 60 * 1000 }),
        stepUpToken: rotatedSetup.body.stepUpToken,
      },
      { token: session.token },
    );
    assert.strictEqual(wrongRotation.body.ok, false);
    const stillOld = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    const oldFactorWorks = await post('/api/v1/auth/login/verify', {
      ticket: stillOld.body.ticket,
      code: codeFor(setup.body.secret),
    });
    assert.strictEqual(oldFactorWorks.body.ok, true, '新密钥尚未确认时旧验证器仍然可用');
    const rotated = await post(
      '/api/v1/profile/2fa/totp/enable',
      {
        code: codeFor(rotatedSetup.body.secret),
        stepUpToken: rotatedSetup.body.stepUpToken,
      },
      { token: session.token },
    );
    assert.strictEqual(rotated.body.ok, true);
    const newFactorLogin = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    const newFactorWorks = await post('/api/v1/auth/login/verify', {
      ticket: newFactorLogin.body.ticket,
      code: codeFor(rotatedSetup.body.secret),
    });
    assert.strictEqual(newFactorWorks.body.ok, true, '确认轮换后新验证器立即生效');

    // 关闭必须经过身份复核，但保留 TOTP 密钥与备用码，供后续一键恢复。
    const noDisableProof = await post(
      '/api/v1/profile/2fa/disable',
      { password: 'password' },
      { token: session.token },
    );
    assert.strictEqual(noDisableProof.body.ok, false);
    const disableProof = await identityTicket(session.token, 'totp@example.com', 'factor', {
      method: 'totp',
      code: codeFor(rotatedSetup.body.secret),
    });
    const disabled = await post('/api/v1/profile/2fa/disable', { stepUpToken: disableProof }, { token: session.token });
    assert.strictEqual(disabled.body.ok, true, JSON.stringify(disabled.body));
    security = await get('/api/v1/profile/security', { token: session.token });
    assert.strictEqual(security.body.twoFactorEnabled, false);
    assert.strictEqual(security.body.totpEnabled, true, '关闭后保留验证器绑定');
    assert.strictEqual(security.body.backupCodesLeft, 10, '关闭后保留尚未使用的备用码');

    const activated = await post('/api/v1/profile/2fa/totp/activate', undefined, { token: session.token });
    assert.strictEqual(activated.body.ok, true, '已配置的验证器应可直接重新开启');
    security = await get('/api/v1/profile/security', { token: session.token });
    assert.strictEqual(security.body.twoFactorEnabled, true);
    assert.strictEqual(security.body.twoFactorMethod, 'totp');
    assert.strictEqual(security.body.backupCodesLeft, 10, '一键开启不应轮换备用码');

    const finalProof = await identityTicket(session.token, 'totp@example.com', 'factor');
    const finalDisable = await post(
      '/api/v1/profile/2fa/disable',
      { stepUpToken: finalProof },
      { token: session.token },
    );
    assert.strictEqual(finalDisable.body.ok, true);
    security = await get('/api/v1/profile/security', { token: session.token });
    assert.strictEqual(security.body.twoFactorEnabled, false);
    assert.strictEqual(security.body.totpEnabled, true);

    const plain = await post('/api/v1/auth/login', { username: 'totpuser', password: 'password' });
    assert.ok(plain.body.token, '关闭之后应当恢复成一步登录');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-totp'");
  }
});
