/**
 * 限流中间件的单元测试：窗口内放行、超限给 429、不同账号互不牵连。
 *
 * 用 jest 全局的 test/beforeEach（与 src 下其它用例一致，由 `npm test` 驱动），
 * 断言用 node 的 assert/strict，不绑死 jest 的 expect API。
 */

const assert = require('node:assert/strict');

const { rateLimit, resetRateLimits } = require('./rate-limit');

function fakeReq(username, ip = '10.0.0.1') {
  return { path: '/login', ip, body: { username } };
}

/** 跑 max + 1 次，返回最后一次 next 收到的错误。 */
function run(limiter, req, times) {
  let lastError = null;
  for (let i = 0; i < times; i += 1) {
    limiter(req, {}, (err) => { lastError = err || null; });
  }
  return lastError;
}

beforeEach(() => resetRateLimits());

test('窗口内前 N 次放行，第 N+1 次给 429', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: '太频繁' });
  const req = fakeReq('demo');
  assert.equal(run(limiter, req, 3), null);
  const error = run(limiter, req, 1);
  assert.equal(error?.status, 429);
  assert.equal(error?.message, '太频繁');
});

test('不同用户名各自计数，不会互相挤占', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 2, message: '太频繁' });
  assert.equal(run(limiter, fakeReq('alice'), 2), null);
  // alice 已到上限，但 bob 是另一个桶，仍然放行
  assert.equal(run(limiter, fakeReq('bob'), 2), null);
  assert.equal(run(limiter, fakeReq('alice'), 1)?.status, 429);
});

test('不同 IP 各自计数', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 1, message: '太频繁' });
  assert.equal(run(limiter, fakeReq('demo', '10.0.0.1'), 1), null);
  assert.equal(run(limiter, fakeReq('demo', '10.0.0.2'), 1), null);
  assert.equal(run(limiter, fakeReq('demo', '10.0.0.1'), 1)?.status, 429);
});
