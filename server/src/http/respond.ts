/**
 * 写操作信封的 Hono 版出口（Express 版在 `domain/respond.ts`）。
 *
 * Hono 里没有 `next(error)` 这类漏斗：handler 里抛出的异常由 `app.onError()` 统一
 * 序列化（见 `src/server/hono-app.ts`）。因此这里只做一件事——把业务规则失败
 * （400 / 409）收成 200 + `{ ok:false, error }`，其余异常原样抛出。
 *
 * 用法（迁移后的写接口）：
 *
 * ```ts
 * app.post('/exhibitions', authenticate, (c) => mutate(c, async () => { ... }));
 * ```
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { runEnveloped } from '../domain/respond.js';

/** 成功信封：`{ ok:true, error:'', ...payload }`。 */
export function successEnvelope(payload: unknown = {}): Record<string, unknown> {
  return { ok: true, error: '', ...(payload as Record<string, unknown>) };
}

/** 失败信封：`{ ok:false, error }`（HTTP 200）。 */
export function failureEnvelope(message: string): Record<string, unknown> {
  return { ok: false, error: message };
}

/** JSON 响应统一带 charset：与 `res.json()` 的 `application/json; charset=utf-8` 对齐。 */
export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/** Hono 的 c.json 只接受它自己那套字面量状态码类型，我们自己算出来的数字要先过一次断言。 */
function statusCode(status: number): ContentfulStatusCode {
  return status as ContentfulStatusCode;
}

/** JSON 响应：与 Express 的 `res.json()` 一样带 charset。 */
export function jsonResponse(c: Context, body: unknown, status = 200): Response {
  return c.json(body, statusCode(status), JSON_HEADERS);
}

/** 200 + 成功信封。 */
export function okResponse(c: Context, payload: unknown = {}): Response {
  return jsonResponse(c, successEnvelope(payload));
}

/** 200 + 失败信封。 */
export function failureResponse(c: Context, message: string): Response {
  return jsonResponse(c, failureEnvelope(message));
}

/**
 * 包住一段写操作：成功补上 ok/error，业务失败转成信封（Hono 路由用）。
 *
 * 401 / 403 / 404 / 503 以及 `envelope: false` 的错误会继续往外抛，
 * 交给统一错误处理给出对应状态码。
 */
export async function mutate(c: Context, run: () => unknown | Promise<unknown>): Promise<Response> {
  return jsonResponse(c, await runEnveloped(run));
}
