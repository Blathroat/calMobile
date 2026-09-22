/**
 * 错误 → HTTP 响应：状态码与对外文案的唯一实现处。
 *
 * `domain/errors.ts` 只回答「这是什么错」（ApiError 的类型、数据库是不是不可用），
 * 这里回答「该回什么状态码、该说什么话」。Hono 的 `onError` 与尚未迁移的 Express
 * 错误中间件共用同一套函数，因此两条路径回出去的形状完全一致。
 *
 * 两条纪律（迁移前就是这两条，逐字保留）：
 *
 * - **不把内部细节回给调用方**：只有 `ApiError` 的文案是写给用户看的，pg 的连接错误
 *   （含内网 `host:port`）、SQL 片段、文件路径与堆栈一律只出现在服务端日志里；
 * - **库故障不是 500 而是 503**：判定在 `domain/errors.ts` 的 `isDatabaseUnavailable()`。
 */

import { ApiError, isDatabaseUnavailable } from '../domain/errors.js';

/** body-parser 之类中间件的错误类型 → 对外文案（私有 `err.type` 的映射表）。 */
export const MIDDLEWARE_MESSAGES: Record<string, string> = {
  'entity.parse.failed': '请求体不是合法的 JSON',
  'entity.too.large': '请求体超过大小上限',
  'encoding.unsupported': '不支持的请求体编码',
  'request.aborted': '请求被中断',
};

/** 中间件错误自带的形状（body-parser 的 `err.status` / `err.type`）。 */
export interface RaisedError {
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

/** 错误 → HTTP 状态码：ApiError 自带 > 中间件自带的 4xx > 数据库不可用 503 > 500。 */
export function statusFor(err: unknown): number {
  if (err instanceof ApiError) {
    return err.status;
  }
  const record = err as RaisedError;
  const declared = Number(record.status || record.statusCode);
  if (Number.isInteger(declared) && declared >= 400 && declared < 500) {
    return declared;
  }
  return isDatabaseUnavailable(err) ? 503 : 500;
}

/**
 * 错误 → 给客户端的文案。
 *
 * 只有 ApiError 的文案是写给用户看的；其余一律换成固定文案：
 * pg 的连接错误里有内网 host:port、解析错误里有请求体片段，都不该回给调用方
 * （排查用的原文与堆栈只进服务端日志）。
 */
export function clientMessage(err: unknown, status: number): string {
  if (err instanceof ApiError) {
    return err.message || '请求失败';
  }
  const record = err as RaisedError;
  const message = record.type ? MIDDLEWARE_MESSAGES[record.type] : undefined;
  if (message) {
    return message;
  }
  if (status === 503) {
    return '数据库暂时不可用，请稍后重试';
  }
  return status < 500 ? '请求不合法' : '服务器内部错误';
}

/** 一次错误的完整出口：状态码 + 响应体。 */
export function errorResponse(err: unknown): { status: number; body: { error: string } } {
  const status = statusFor(err);
  return { status, body: { error: clientMessage(err, status) } };
}
