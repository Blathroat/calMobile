/**
 * JSON 请求体的体积上限与解析。
 *
 * Hono 没有内置的体积上限，因此写守卫这件事落到这里。文案与状态码保持既有 API 约定：
 *
 * - 声明体积超限 → 413 `请求体超过大小上限`；
 * - 正文不是合法 JSON → 400 `请求体不是合法的 JSON`；
 * - 空正文 → `{}`（与 body-parser 对无正文请求的处理一致，路由照样能读到空对象）。
 *
 * 这里先按声明长度挡住明显超限的请求，实际 JSON 仍由每个 Hono 写路由按需读取。
 */

import type { Context } from 'hono';
import { ApiError } from '../domain/errors.js';
import { jsonResponse } from './respond.js';

/** 2MB：保持既有公共 API 约定。 */
export const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export const TOO_LARGE_MESSAGE = '请求体超过大小上限';
export const PARSE_FAILED_MESSAGE = '请求体不是合法的 JSON';

/** 声明的 Content-Length 是否已经超限（没有声明 / 非法值都算没超）。 */
export function exceedsDeclaredLength(headerValue: string | undefined): boolean {
  if (!headerValue) {
    return false;
  }
  const declared = Number(headerValue.trim());
  return Number.isFinite(declared) && declared > JSON_BODY_LIMIT_BYTES;
}

/** 体积超限的响应：413 + `{ error }`，与迁移前一致（不是 200 信封）。 */
export function tooLargeResponse(c: Context): Response {
  return jsonResponse(c, { error: TOO_LARGE_MESSAGE }, 413);
}

/**
 * JSON 体积守卫：声明体积超限直接拒绝，绝不进入路由。
 *
 * 挂在**所有路由之前**，因此超限请求不会进入业务处理器。
 */
export function jsonBodySizeGuard() {
  return async function jsonBodySizeGuard(c: Context, next: () => Promise<void>): Promise<Response | void> {
    if (exceedsDeclaredLength(c.req.header('content-length'))) {
      return tooLargeResponse(c);
    }
    await next();
  };
}

/**
 * 读一个受限的 JSON 请求体（Hono 自己的路由用）。
 *
 * 迁移后的写接口用它取入参：正文超限抛 413、不是合法 JSON 抛 400，都由统一错误处理
 * 变成对应状态码；这两类**不走**写操作信封（信封是给业务规则失败用的）。
 * 顶层形状的宽严与 body-parser 一致：只要能被 `JSON.parse` 就收（数组也收，
 * 由路由自己判「这个接口要不要对象」）。
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  const buffer = Buffer.from(await c.req.arrayBuffer());
  if (buffer.byteLength > JSON_BODY_LIMIT_BYTES) {
    throw new ApiError(413, TOO_LARGE_MESSAGE, false);
  }
  if (buffer.byteLength === 0) {
    return {};
  }
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, PARSE_FAILED_MESSAGE, false);
  }
}
