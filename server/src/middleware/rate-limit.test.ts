import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ApiError } from '../domain/errors.js';
import { honoRateLimit, isAuthFailure, isEnvelopeFailure, resetRateLimits } from './rate-limit.js';

beforeEach(() => resetRateLimits());

test('信封失败只认 { ok: false }', () => {
  assert.equal(isEnvelopeFailure({ ok: false, error: '账号或密码不正确' }), true);
  assert.equal(isEnvelopeFailure({ ok: true, error: '' }), false);
  assert.equal(isEnvelopeFailure({ error: '请先登录' }), false);
  assert.equal(isEnvelopeFailure(null), false);
  assert.equal(isEnvelopeFailure(undefined), false);
});

test('认证失败计数：4xx 或业务信封都算，成功信封不算', () => {
  assert.equal(isAuthFailure(200, { ok: false, error: '账号或密码不正确' }), true);
  assert.equal(isAuthFailure(401, { error: '请先登录' }), true);
  assert.equal(isAuthFailure(429, undefined), true);
  assert.equal(isAuthFailure(200, { ok: true, error: '' }), false);
  assert.equal(isAuthFailure(200, undefined), false);
});

test('Hono 失败信封与抛出的 4xx 都计数，成功不计数', async () => {
  const app = new Hono();
  const limiter = honoRateLimit({
    windowMs: 60 * 1000,
    max: 2,
    message: '太频繁',
    identity: (c) => c.req.header('x-account') || '',
    ip: (c) => c.req.header('x-ip') || '',
  });
  app.post('/login', limiter, (c) => {
    if (c.req.header('x-result') === 'success') return c.json({ ok: true, error: '' });
    if (c.req.header('x-result') === 'unauthorized') throw new ApiError(401, '未登录');
    return c.json({ ok: false, error: '账号或密码不正确' });
  });
  app.onError((error, c) => c.json({ error: error.message }, (error as ApiError).status as 401 | 429));
  const hit = (account: string, result: string, ip = '1.2.3.4') =>
    app.request('/login', { method: 'POST', headers: { 'x-account': account, 'x-result': result, 'x-ip': ip } });

  for (let i = 0; i < 4; i += 1) assert.equal((await hit('success', 'success')).status, 200);
  assert.equal((await hit('alice', 'unauthorized')).status, 401);
  assert.equal((await hit('alice', 'failure')).status, 200);
  assert.equal((await hit('alice', 'success')).status, 429);
  assert.equal((await hit('bob', 'success')).status, 200);
  assert.equal((await hit('alice', 'success', '4.3.2.1')).status, 200);
});
