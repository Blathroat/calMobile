/**
 * JSON 体积上限与写操作信封。
 *
 * 超限与解析失败必须是 413 / 400 + 固定文案（和迁移前 body-parser 的回法一致），
 * 业务规则失败才是 200 + `{ ok:false }`——两者混在一起页面就分不清
 * 「请求发错了」和「规则不允许」。
 *
 * 用 vitest 全局的 test（与 src 下其它用例一致，由 `pnpm test` 驱动）。
 */

import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  JSON_BODY_LIMIT_BYTES,
  exceedsDeclaredLength,
  jsonBodySizeGuard,
  readJsonBody,
  tooLargeResponse,
} from './body-limit.js';
import { JSON_HEADERS, failureResponse, mutate, okResponse } from './respond.js';
import { ApiError, badRequest } from '../domain/errors.js';

/** 读一次 body 的诊断入口：把 readJsonBody 抛出的错误摊平成 JSON，便于断言。 */
function bodyApp() {
  return new Hono().post('/x', (c) =>
    readJsonBody(c).then(
      (parsed) => c.json({ status: 200, parsed }),
      (error: unknown) =>
        c.json({ status: (error as ApiError).status, name: (error as Error).name, message: (error as Error).message }),
    ),
  );
}

test('exceedsDeclaredLength：按 2MB 判，缺声明或非数字都算没超', () => {
  assert.equal(exceedsDeclaredLength(String(JSON_BODY_LIMIT_BYTES)), false, '等于上限不算超');
  assert.equal(exceedsDeclaredLength(String(JSON_BODY_LIMIT_BYTES + 1)), true);
  assert.equal(exceedsDeclaredLength('99999999999'), true);
  assert.equal(exceedsDeclaredLength(undefined), false);
  assert.equal(exceedsDeclaredLength('chunked'), false);
});

test('体积守卫：声明体积超限给 413 + 固定文案，且不进路由', async () => {
  const app = new Hono();
  let reached = false;
  app.use('*', jsonBodySizeGuard());
  app.post('/api/v1/echo', (c) => {
    reached = true;
    return c.json({ ok: true });
  });
  const response = await app.request('/api/v1/echo', {
    method: 'POST',
    headers: { 'content-length': String(JSON_BODY_LIMIT_BYTES + 1), 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), { error: '请求体超过大小上限' });
  assert.equal(reached, false, '超限请求不该进路由');
});

test('体积守卫：正常体积放行', async () => {
  const app = new Hono();
  app.use('*', jsonBodySizeGuard());
  app.post('/api/v1/echo', (c) => c.json({ ok: true }));
  const response = await app.request('/api/v1/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.equal(response.status, 200);
});

test('readJsonBody：对象原样返回', async () => {
  const response = await bodyApp().request('/x', { method: 'POST', body: '{"username":"demo"}' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 200, parsed: { username: 'demo' } });
});

test('readJsonBody：空正文给空对象（与 body-parser 一致）', async () => {
  const response = await bodyApp().request('/x', { method: 'POST', body: '' });
  assert.deepEqual(await response.json(), { status: 200, parsed: {} });
});

test('readJsonBody：坏 JSON 抛 400，且不带信封', async () => {
  const response = await bodyApp().request('/x', { method: 'POST', body: '{oops' });
  assert.deepEqual(await response.json(), {
    status: 400,
    name: 'ApiError',
    message: '请求体不是合法的 JSON',
  });
});

test('readJsonBody：正文超限抛 413', async () => {
  const app = new Hono().post('/x', (c) =>
    readJsonBody(c).then(
      () => c.json({}),
      (error: unknown) => c.json({ status: (error as ApiError).status }, { status: (error as ApiError).status as 413 }),
    ),
  );
  const big = JSON.stringify({ blob: 'x'.repeat(JSON_BODY_LIMIT_BYTES + 10) });
  const response = await app.request('/x', { method: 'POST', body: big });
  assert.equal(response.status, 413);
});

test('写操作信封：成功补上 ok/error 与附加字段', async () => {
  const app = new Hono().post('/ok', (c) => mutate(c, async () => ({ token: 't1', user: { id: 'u' } })));
  const response = await app.request('/ok', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, error: '', token: 't1', user: { id: 'u' } });
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('写操作信封：业务规则失败（400/409）是 200 + ok:false', async () => {
  const app = new Hono().post('/rule', (c) =>
    mutate(c, async () => {
      throw badRequest('用户名长度需在 2-20 个字符之间');
    }),
  );
  const response = await app.request('/rule', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: false, error: '用户名长度需在 2-20 个字符之间' });
});

test('写操作信封：403 继续外抛，由统一错误处理给状态码', async () => {
  const app = new Hono()
    .onError((err, c) => c.json({ error: (err as Error).message }, { status: (err as ApiError).status as 403 }))
    .post('/denied', (c) =>
      mutate(c, async () => {
        throw new ApiError(403, '无权执行此操作');
      }),
    );
  const response = await app.request('/denied', { method: 'POST' });
  assert.equal(response.status, 403, 'mutate 不吞 403');
  assert.deepEqual(await response.json(), { error: '无权执行此操作' });
});

test('写操作信封：envelope:false 的 4xx 走真状态码，不进信封', async () => {
  // 迁移后第一个受益者就是它：请求体解析失败要回 400，不是 200 + ok:false
  const app = new Hono()
    .onError((err, c) => {
      const status = (err as ApiError).status;
      return c.json({ error: (err as Error).message }, { status: status as 400 });
    })
    .post('/broken-body', (c) =>
      mutate(c, async () => {
        throw new ApiError(400, '请求体不是合法的 JSON', false);
      }),
    );
  const response = await app.request('/broken-body', { method: 'POST' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: '请求体不是合法的 JSON' });
});

test('okResponse / failureResponse 是同一套信封', async () => {
  const app = new Hono().get('/a', (c) => okResponse(c)).get('/b', (c) => failureResponse(c, '重复报名'));
  assert.deepEqual(await (await app.request('/a')).json(), { ok: true, error: '' });
  const fail = await app.request('/b');
  assert.equal(fail.status, 200);
  assert.deepEqual(await fail.json(), { ok: false, error: '重复报名' });
});

test('tooLargeResponse：413 + 固定文案', async () => {
  const app = new Hono().get('/x', (c) => tooLargeResponse(c));
  const response = await app.request('/x');
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), { error: '请求体超过大小上限' });
});

test('JSON_HEADERS：带 charset，与 res.json() 一致', () => {
  assert.deepEqual(JSON_HEADERS, { 'Content-Type': 'application/json; charset=utf-8' });
});
