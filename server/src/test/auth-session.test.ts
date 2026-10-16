/**
 * 认证与会话 契约测试。
 *
 * 登录（用户名 / 已验证邮箱）、登录限流、刷新令牌轮换与并发、退出登录、未登录 401。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { get, login, post, startContract, stopContract } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 认证 ────────────────────────────────────────────────────────

test('登录返回访问令牌与刷新令牌，密码错误给业务失败', async () => {
  resetRateLimits();
  const ok = await post('/api/v1/auth/login', { username: 'demo', password: 'password' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.ok, true);
  assert.ok(ok.body.token, '缺少访问令牌');
  assert.ok(ok.body.refreshToken, '缺少刷新令牌');
  assert.strictEqual(ok.body.user.role, 'admin');

  const bad = await post('/api/v1/auth/login', { username: 'demo', password: 'wrong' });
  assert.strictEqual(bad.status, 200, '业务失败应当是 200 + ok:false');
  assert.strictEqual(bad.body.ok, false);
  assert.ok(bad.body.error, '必须给出可展示的错误');
});

test('登录限流：同一账号连续失败到上限后给 429', async () => {
  resetRateLimits();
  const username = `rl-${Date.now().toString(36)}`;
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await post('/api/v1/auth/login', { username, password: 'wrong' });
    assert.strictEqual(last.status, 200, `第 ${i + 1} 次应当在窗口内放行`);
  }
  const blocked = await post('/api/v1/auth/login', { username, password: 'wrong' });
  assert.strictEqual(blocked.status, 429, '超出窗口上限应当 429');
  assert.ok(blocked.body.error, '429 也要给出可展示的错误');
});

test('刷新令牌可轮换，旧的一次性作废', async () => {
  const session = await login('user');
  const first = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(first.status, 200);
  assert.ok(first.body.token && first.body.refreshToken, '刷新应当换回一套新令牌');
  assert.notStrictEqual(first.body.refreshToken, session.refreshToken, '刷新令牌应当轮换');

  const reused = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(reused.status, 401, '旧刷新令牌必须失效');
});

test('并发使用同一个刷新令牌只能换到一套新令牌', async () => {
  // 轮换的撤销必须是原子的：以前「先 SELECT 判断 revoked_at、再按 id UPDATE」时，
  // 同一令牌并发用两次两个请求都能通过判断，各换一套新令牌（TOCTOU）。
  for (let round = 0; round < 3; round += 1) {
    const session = await login('user');
    const responses = await Promise.all([
      post('/api/v1/auth/refresh', { refreshToken: session.refreshToken }),
      post('/api/v1/auth/refresh', { refreshToken: session.refreshToken }),
    ]);
    const ok = responses.filter((item) => item.status === 200 && item.body.ok === true);
    const rejected = responses.filter((item) => item.status === 401);
    const seen = responses.map((item) => `${item.status}/${item.body && item.body.ok}`).join(', ');
    assert.strictEqual(ok.length, 1, `第 ${round + 1} 轮：同一个刷新令牌并发只能成功一次（${seen}）`);
    assert.strictEqual(rejected.length, 1, `第 ${round + 1} 轮：另一个请求必须按登录失效处理（${seen}）`);

    // 换到的新令牌仍然可用：只作废了被重放的那一个，不是把整条会话废掉
    const rotated = await post('/api/v1/auth/refresh', { refreshToken: ok[0]!.body.refreshToken });
    assert.strictEqual(rotated.status, 200, '轮换出来的新令牌应当还能继续刷新');
  }
});

test('退出登录会撤销刷新令牌', async () => {
  const session = await login('user');
  const out = await post('/api/v1/auth/logout', { refreshToken: session.refreshToken });
  assert.strictEqual(out.body.ok, true);
  const reused = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(reused.status, 401);
});

test('未登录访问需要身份的接口返回 401', async () => {
  for (const path of ['/api/v1/profile', '/api/v1/registrations', '/api/v1/review?exhibitionId=exh-1']) {
    const response = await get(path);
    assert.strictEqual(response.status, 401, `${path} 应当要求登录`);
    assert.ok(response.body.error, `${path} 缺少错误说明`);
  }
});
test('登录支持用户名或已验证邮箱', async () => {
  const byName = await post('/api/v1/auth/login', { username: 'user', password: 'password' });
  assert.strictEqual(byName.body.ok, true, `用户名登录失败：${JSON.stringify(byName.body)}`);

  // 登录页的占位符一直写着「昵称 / 邮箱」，但后端只按用户名匹配 —— 邮箱登录此前是坏的，
  // 而昵称没有唯一约束、本来就不能当标识。
  const byEmail = await post('/api/v1/auth/login', { username: 'user@example.com', password: 'password' });
  assert.strictEqual(byEmail.body.ok, true, `邮箱登录失败：${JSON.stringify(byEmail.body)}`);
  assert.strictEqual(byEmail.body.user.username, 'user', '邮箱登录应当拿到同一个账号');

  const wrong = await post('/api/v1/auth/login', { username: 'user@example.com', password: 'nope' });
  assert.strictEqual(wrong.body.ok, false);
});
