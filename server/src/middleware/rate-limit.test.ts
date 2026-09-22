/**
 * 限流中间件的单元测试：失败计数、窗口内放行、超限给 429、不同账号与 IP 互不牵连。
 *
 * 用 vitest 全局的 test/beforeEach（与 src 下其它用例一致，由 `pnpm test` 驱动），
 * 断言用 node 的 assert/strict，不绑死 vitest 的 expect API。
 */

import assert from 'node:assert/strict';
import { ApiError } from '../domain/errors.js';
import { isAuthFailure, isEnvelopeFailure, rateLimit, resetRateLimits } from './rate-limit.js';

function fakeReq(username: string, ip = '10.0.0.1') {
  return { path: '/login', ip, body: { username } };
}

/** 最小 res 打桩：中间件会挂 res.json / res.on('finish')，所以要真的能调。 */
function fakeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    listeners: {} as Record<string, () => void>,
    json(body: unknown) {
      res.body = body;
      return res;
    },
    on(event: string, handler: () => void) {
      res.listeners[event] = handler;
      return res;
    },
  };
  return res;
}

/**
 * 跑一次请求。
 *
 * @param failed 是否模拟「失败」——失败的两种形态都会计数：
 *               200 + `{ ok:false }` 的信封，或 4xx 状态码。
 */
function once(limiter: ReturnType<typeof rateLimit>, req: ReturnType<typeof fakeReq>, failed = true) {
  const res = fakeRes();
  let error: unknown = null;
  limiter(req, res, (received) => {
    error = received || null;
  });
  if (!error) {
    if (failed) {
      res.json({ ok: false, error: '账号或密码不正确' });
    } else {
      res.json({ ok: true, error: '' });
    }
    res.listeners.finish?.();
  }
  return error as ApiError | null;
}

/** 连续跑 times 次，返回最后一次的错误（没有错误就是 null）。 */
function run(limiter: ReturnType<typeof rateLimit>, req: ReturnType<typeof fakeReq>, times: number, failed = true) {
  let lastError: ApiError | null = null;
  for (let i = 0; i < times; i += 1) {
    lastError = once(limiter, req, failed);
  }
  return lastError;
}

beforeEach(() => resetRateLimits());

test('信封失败只认 { ok: false }，与猴补丁时期同一判定', () => {
  assert.equal(isEnvelopeFailure({ ok: false, error: '账号或密码不正确' }), true);
  assert.equal(isEnvelopeFailure({ ok: true, error: '' }), false);
  assert.equal(isEnvelopeFailure({ error: '请先登录' }), false);
  assert.equal(isEnvelopeFailure(null), false);
  assert.equal(isEnvelopeFailure(undefined), false);
  assert.equal(isEnvelopeFailure('nope'), false);
  assert.equal(isEnvelopeFailure(0), false);
});

test('认证失败计数：4xx 或业务信封都算，成功信封不算', () => {
  assert.equal(isAuthFailure(200, { ok: false, error: '账号或密码不正确' }), true);
  assert.equal(isAuthFailure(401, { error: '请先登录' }), true);
  assert.equal(isAuthFailure(429, undefined), true);
  assert.equal(isAuthFailure(200, { ok: true, error: '' }), false);
  assert.equal(isAuthFailure(200, undefined), false);
});

test('失败累计到上限后给 429', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: '太频繁' });
  const req = fakeReq('demo');
  assert.equal(run(limiter, req, 3), null);
  const error = run(limiter, req, 1);
  assert.equal(error?.status, 429);
  assert.equal(error?.message, '太频繁');
});

test('成功登录不计数：连着登录很多次也不会把自己锁住', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 3, message: '太频繁' });
  const req = fakeReq('demo');
  assert.equal(run(limiter, req, 50, false), null, '成功的请求不该触发限流');
  // 期间夹着的失败仍要计数：打满 3 次之后第 4 次失败被拦
  assert.equal(run(limiter, req, 3), null);
  assert.equal(run(limiter, req, 1)?.status, 429);
});

test('同一次响应里信封失败是粘性的：先 ok:false 再 ok:true 仍计数', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 1, message: '太频繁' });
  const req = fakeReq('demo');
  const res = fakeRes();
  limiter(req, res, () => {});
  res.json({ ok: false, error: '账号或密码不正确' });
  res.json({ ok: true, error: '' });
  res.listeners.finish?.();
  assert.equal(once(limiter, req, false)?.status, 429, '粘性信封失败之后应当已被计数');
});

test('4xx 状态码也算失败', () => {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 1, message: '太频繁' });
  const req = fakeReq('demo');
  const res = fakeRes();
  res.statusCode = 401;
  limiter(req, res, () => {});
  res.json({ error: '请先登录' });
  res.listeners.finish?.();
  assert.equal(once(limiter, req, false)?.status, 429, '4xx 之后应当已被计数');
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
