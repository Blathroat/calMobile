import assert from 'node:assert/strict';
import { ApiError, serviceUnavailable, isDatabaseUnavailable } from './errors';

/**
 * 数据库不可用的判定。
 *
 * 这段分类是**状态码的来源**（index.js 的 statusFor 用它把库故障从 500 里分出来给 503），
 * 判错就会让客户端把「库暂时不可用」当成服务器内部错误，因此单独测。
 */

test('serviceUnavailable 是 503', () => {
  const error = serviceUnavailable();
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 503);
  assert.match(error.message, /数据库暂时不可用/);
});

test('连接类错误无论 code 还是 message 都能认出来', () => {
  // pg 建连失败时给的是 Node 的 errno code
  assert.equal(isDatabaseUnavailable({ code: 'ECONNREFUSED' }), true);
  assert.equal(isDatabaseUnavailable({ code: 'ENOTFOUND' }), true);
  // 驱动在池等待超时时只给一句文案，没有 code
  assert.equal(isDatabaseUnavailable({ message: 'timeout exceeded when trying to connect' }), true);
  assert.equal(isDatabaseUnavailable({ message: 'Connection terminated unexpectedly' }), true);
});

test('服务端侧的错误码也算不可用', () => {
  // 08006 连接失败 / 57P01 管理员关库 / 53300 连接数打满 / 3D000 库不存在 / 28P01 密码错
  for (const code of ['08006', '57P01', '53300', '3D000', '28P01']) {
    assert.equal(isDatabaseUnavailable({ code }), true, `${code} 应当算数据库不可用`);
  }
});

test('SQL 语法错、约束冲突不算不可用', () => {
  // 这两类该是 500 / 409，不能被 503 掩盖成「稍后重试」
  assert.equal(isDatabaseUnavailable({ code: '42601' }), false); // syntax_error
  assert.equal(isDatabaseUnavailable({ code: '23505' }), false); // unique_violation
  assert.equal(isDatabaseUnavailable(new Error('column "x" does not exist')), false);
  assert.equal(isDatabaseUnavailable(null), false);
  assert.equal(isDatabaseUnavailable(undefined), false);
});
