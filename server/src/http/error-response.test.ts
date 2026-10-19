/**
 * 错误分类：状态码的来源。
 *
 * 两条最要紧的：**库故障必须是 503 而不是 500**（判成 500 页面就按「坏了」而不是
 * 「重试一下」提示），以及**pg/SQL/堆栈一个字都不能回给调用方**。
 *
 * 用 vitest 全局的 test（与 src 下其它用例一致，由 `pnpm test` 驱动）。
 */

import assert from 'node:assert/strict';
import { statusFor, clientMessage, errorResponse, MIDDLEWARE_MESSAGES } from './error-response.js';
import { ApiError } from '../domain/errors.js';

test('statusFor：ApiError 用自己的状态码', () => {
  assert.equal(statusFor(new ApiError(403, '无权')), 403);
  assert.equal(statusFor(new ApiError(404, '找不到')), 404);
  assert.equal(statusFor(new ApiError(409, '冲突')), 409);
});

test('statusFor：中间件自带的 4xx 状态码照用，没有状态码的错按内部错误算', () => {
  assert.equal(statusFor({ status: 400, type: 'entity.parse.failed' }), 400);
  assert.equal(statusFor({ statusCode: 413, type: 'entity.too.large' }), 413);
  assert.equal(statusFor({ type: 'some.other.type' }), 500);
});

test('statusFor：数据库不可用是 503，SQL 语法错与唯一冲突照旧 500', () => {
  assert.equal(statusFor({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' }), 503);
  assert.equal(statusFor({ code: '08006' }), 503);
  assert.equal(statusFor({ message: 'Connection terminated unexpectedly' }), 503);
  assert.equal(
    statusFor({ code: '23505', message: 'duplicate key value violates unique constraint' }),
    500,
    '唯一冲突不是不可用',
  );
  assert.equal(statusFor(new TypeError('boom')), 500);
});

test('clientMessage：只有 ApiError 的文案是给用户看的', () => {
  assert.equal(clientMessage(new ApiError(403, '账号已被限制，不能报名'), 403), '账号已被限制，不能报名');
  assert.equal(clientMessage(new ApiError(400, ''), 400), '请求失败', '空文案要有兜底');
});

test('clientMessage：不回显内部细节', () => {
  // pg 的连接错误里有内网 host:port，SQL 片段里有表结构，都不该回给调用方
  assert.equal(
    clientMessage({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432', stack: 'at pool' }, 503),
    '数据库暂时不可用，请稍后重试',
  );
  assert.equal(clientMessage(new Error('syntax error at or near "SELCT"'), 500), '服务器内部错误');
  assert.equal(clientMessage({ status: 402, message: '内部: host 10.0.0.5' }, 402), '请求不合法');
});

test('clientMessage：中间件错误按 type 查表，且不泄漏私有类型名', () => {
  assert.equal(clientMessage({ type: 'entity.parse.failed' }, 400), '请求体不是合法的 JSON');
  assert.equal(clientMessage({ type: 'entity.too.large' }, 413), '请求体超过大小上限');
  assert.equal(clientMessage({ type: 'encoding.unsupported' }, 415), '不支持的请求体编码');
  assert.equal(clientMessage({ type: 'request.aborted' }, 400), '请求被中断');
  assert.deepEqual(Object.keys(MIDDLEWARE_MESSAGES).sort(), [
    'encoding.unsupported',
    'entity.parse.failed',
    'entity.too.large',
    'request.aborted',
  ]);
  for (const message of Object.values(MIDDLEWARE_MESSAGES)) {
    assert.ok(!message.includes('entity'), '文案不能泄漏 body-parser 私有类型');
  }
});

test('errorResponse：状态码与正文一次给全', () => {
  assert.deepEqual(errorResponse(new ApiError(401, '登录状态已失效，请重新登录')), {
    status: 401,
    body: { error: '登录状态已失效，请重新登录' },
  });
  assert.deepEqual(errorResponse({ code: '08000' }), {
    status: 503,
    body: { error: '数据库暂时不可用，请稍后重试' },
  });
});

test('errorResponse：带稳定错误码时一起下发，没有码时形状与改造前逐字一致', () => {
  // 带变量：errorParams 一并给出，键与中文里的 {名字} 对应。
  assert.deepEqual(
    errorResponse(
      new ApiError(400, '当前状态为「已通过」，只有已通过的报名可以核销', true, {
        code: 'checkin.notApproved',
        params: { status: '已通过' },
      }),
    ),
    {
      status: 400,
      body: {
        error: '当前状态为「已通过」，只有已通过的报名可以核销',
        errorCode: 'checkin.notApproved',
        errorParams: { status: '已通过' },
      },
    },
  );
  // 没有变量：只有 errorCode，不带 errorParams。
  assert.deepEqual(errorResponse(new ApiError(404, '报名记录不存在', true, { code: 'review.recordMissing' })), {
    status: 404,
    body: { error: '报名记录不存在', errorCode: 'review.recordMissing' },
  });
  // 没有码：一个多余字段都不能出现。
  assert.deepEqual(errorResponse(new ApiError(403, '无权执行此操作')), {
    status: 403,
    body: { error: '无权执行此操作' },
  });
});
