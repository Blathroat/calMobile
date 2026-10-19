/**
 * 改邮箱与身份复核 契约测试。
 *
 * 改邮箱验证码发到新地址、别人的码用不了、身份复核票绑定账号 / 会话 / 操作且一次性。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import {
  codeFromInbox,
  createVerifiedAccount,
  get,
  identityTicket,
  login,
  post,
  put,
  startContract,
  stopContract,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('改邮箱要把验证码发到新地址，通过才落库；别人的码用不了', async () => {
  await createVerifiedAccount('usr-email', 'emailchange', 'before@example.com');
  try {
    const session = await login('emailchange');

    // 直接写 email 被拦住：PUT /profile 不再接受这个字段
    const direct = await put('/api/v1/profile', { email: 'hacked@example.com' }, { token: session.token });
    assert.strictEqual(direct.body.ok, false, '邮箱不该能直接改');
    assert.ok(direct.body.error.includes('验证'), `要指出正确路径：${direct.body.error}`);
    const untouched = await get('/api/v1/profile', { token: session.token });
    assert.strictEqual(untouched.body.email, 'before@example.com', '被拦住之后邮箱不能变');

    // 没做当前身份复核不能发新地址验证码。
    const noProof = await post('/api/v1/profile/email', { email: 'after1@example.com' }, { token: session.token });
    assert.strictEqual(noProof.status, 400);
    assert.match(noProof.body.error, /请先验证身份/);
    const noProofTaken = await post('/api/v1/profile/email', { email: 'demo@example.com' }, { token: session.token });
    assert.strictEqual(noProofTaken.status, 400, '没有身份复核时不能通过返回值探测邮箱是否已被占用');
    assert.match(noProofTaken.body.error, /请先验证身份/);

    // 新邮箱与当前邮箱相同：直接拒绝，中文旁带稳定错误码
    const proof0 = await identityTicket(session.token, 'before@example.com', 'email');
    const same = await post(
      '/api/v1/profile/email',
      { email: 'before@example.com', stepUpToken: proof0 },
      { token: session.token },
    );
    assert.strictEqual(same.status, 400);
    assert.strictEqual(same.body.error, '新邮箱与当前邮箱相同');
    assert.strictEqual(same.body.errorCode, 'profile.emailUnchanged');

    // 第一轮：换到 after1，验证码被别人拿去用（换了登录身份）应当失败
    const proof1 = await identityTicket(session.token, 'before@example.com', 'email');
    const asked = await post(
      '/api/v1/profile/email',
      { email: 'after1@example.com', stepUpToken: proof1 },
      { token: session.token },
    );
    assert.strictEqual(asked.body.ok, true, `发码失败：${JSON.stringify(asked.body)}`);
    const stolen = codeFromInbox('after1@example.com');
    const adminSession = await login('demo');
    const foreign = await post(
      '/api/v1/profile/email/verify',
      { email: 'after1@example.com', code: stolen.code },
      { token: adminSession.token },
    );
    assert.strictEqual(foreign.body.ok, false, '别人账号的改邮箱验证码不能用来改自己的邮箱');
    assert.strictEqual(
      foreign.body.error.includes('不正确') || foreign.body.error.includes('失效'),
      true,
      `文案要说不通：${foreign.body.error}`,
    );

    // 第二轮：换到 after2，这一次自己走完
    const proof2 = await identityTicket(session.token, 'before@example.com', 'email');
    const asked2 = await post(
      '/api/v1/profile/email',
      { email: 'after2@example.com', stepUpToken: proof2 },
      { token: session.token },
    );
    assert.strictEqual(asked2.body.ok, true, JSON.stringify(asked2.body));
    const own = codeFromInbox('after2@example.com');
    const done = await post(
      '/api/v1/profile/email/verify',
      { email: 'after2@example.com', code: own.code },
      { token: session.token },
    );
    assert.strictEqual(done.body.ok, true, `改邮箱失败：${JSON.stringify(done.body)}`);
    assert.strictEqual(done.body.user.email, 'after2@example.com');
    assert.strictEqual(done.body.user.emailVerified, true, '新邮箱是验证过的，账号不会掉进「未验证」状态');

    // 新邮箱可以直接用来登录
    const byNewEmail = await post('/api/v1/auth/login', { username: 'after2@example.com', password: 'password' });
    assert.strictEqual(byNewEmail.body.ok, true, '改完之后新邮箱应当能登录');

    // 已被占用的邮箱不能再被改成目标
    const proof3 = await identityTicket(session.token, 'after2@example.com', 'email');
    const taken = await post(
      '/api/v1/profile/email',
      { email: 'demo@example.com', stepUpToken: proof3 },
      { token: session.token },
    );
    assert.strictEqual(taken.body.ok, false);
    assert.ok(taken.body.error.includes('已被'), taken.body.error);
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-email'");
  }
});

test('身份复核票绑定账号、当前会话和单个操作，只能使用一次', async () => {
  await createVerifiedAccount('usr-stepup', 'stepupuser', 'stepup@example.com');
  try {
    const current = await login('stepupuser');
    const other = await login('stepupuser');
    const proof = await identityTicket(current.token, 'stepup@example.com', 'email');

    const wrongSession = await post(
      '/api/v1/profile/email',
      {
        email: 'wrong-session@example.com',
        stepUpToken: proof,
      },
      { token: other.token },
    );
    assert.strictEqual(wrongSession.status, 400, '身份票不能跨设备会话使用');

    const wrongScope = await post('/api/v1/profile/2fa/disable', { stepUpToken: proof }, { token: current.token });
    assert.strictEqual(wrongScope.body.ok, false, '换邮箱的票不能用于关闭两步验证');

    const accepted = await post(
      '/api/v1/profile/email',
      {
        email: 'accepted@example.com',
        stepUpToken: proof,
      },
      { token: current.token },
    );
    assert.strictEqual(accepted.body.ok, true, `正确会话与用途应能使用：${JSON.stringify(accepted.body)}`);

    const replay = await post(
      '/api/v1/profile/email',
      {
        email: 'replay@example.com',
        stepUpToken: proof,
      },
      { token: current.token },
    );
    assert.strictEqual(replay.status, 400, '身份票必须是一次性的');

    const noTotp = await post(
      '/api/v1/profile/security/verify',
      {
        method: 'totp',
        scope: 'password',
        code: '123456',
      },
      { token: current.token },
    );
    assert.strictEqual(noTotp.body.ok, false, '没有配置 TOTP 的账号不能用 TOTP 复核身份');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-stepup'");
  }
});
