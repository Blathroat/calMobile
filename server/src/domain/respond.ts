/**
 * 写操作的统一收尾。
 *
 * 约定（前后端都按这个来，见 server/README.md「响应约定」）：
 *
 * - **校验与业务规则失败**（400 / 409：参数不合法、状态不允许、重复报名…）
 *   → HTTP 200 + `{ ok:false, error }`。页面用 `if (!result.ok)` 就地提示，
 *    前端 `core/api.js` 也按 `.ok` 判断，因此写接口的失败形态前后端只有这一种；
 * - **认证 / 授权 / 找不到目标**（401 / 403 / 404）→ 原样抛出，交给错误处理
 *    （Express 的错误中间件 / Hono 的 `onError`）给出对应状态码 + `{ error }`。
 *    前端 api.js 会当作异常抛出，由页面的 catch 展示；也避免把「无权访问」伪装成 200 成功。
 *
 * `runEnveloped()` 是信封的唯一实现；Express 版 `mutate(res, next, run)` 与
 * Hono 版 `mutate(c, run)`（在 `http/respond.ts`）都只是它的两个出口。
 */

import { ApiError } from './errors.js';

/** 会被转成应用层信封的状态码。 */
export const ENVELOPE_STATUS = new Set([400, 409]);

interface EnvelopeResponse {
  json(body: Record<string, unknown>): void;
}

type NextFn = (error?: unknown) => void;

/**
 * 跑一段写操作并收成信封。
 *
 * `ApiError(..., false)`（例如请求体解析失败）刻意**不进**信封：那是 HTTP 形状错误，
 * 不是业务规则失败，回 200 + ok:false 会让页面把「发了个坏请求」当成「规则不允许」。
 */
export async function runEnveloped(run: () => unknown | Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    const payload = await run();
    return { ok: true, error: '', ...(payload as Record<string, unknown>) };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.envelope && ENVELOPE_STATUS.has(error.status)) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** 包住一段写操作：成功补上 ok/error，业务失败转成信封（Express 路由用）。 */
export async function mutate(
  res: EnvelopeResponse,
  next: NextFn,
  run: () => unknown | Promise<unknown>,
): Promise<void> {
  try {
    res.json(await runEnveloped(run));
  } catch (error: unknown) {
    next(error);
  }
}
