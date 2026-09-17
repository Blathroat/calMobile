/**
 * 业务错误。
 *
 * 路由里直接 `throw new ApiError(403, '无权执行此操作')`，由 index.js 的错误中间件
 * 统一序列化成 `{ error: '…' }`；前端 api.js 把 4xx + error 当作**业务失败**
 * （就地提示，不退回原生桥接），把 5xx 与网络错误当作传输失败（可以降级）。
 */

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const badRequest = (message) => new ApiError(400, message);
const unauthorized = (message = '请先登录') => new ApiError(401, message);
const forbidden = (message = '无权执行此操作') => new ApiError(403, message);
const notFound = (message = '内容不存在或已删除') => new ApiError(404, message);
const conflict = (message = '操作与当前状态冲突') => new ApiError(409, message);

/** 条件成立时抛出，用于把「校验 + 报错」写成一行。 */
function assert(condition, error) {
  if (!condition) {
    throw error;
  }
}

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  assert,
};
