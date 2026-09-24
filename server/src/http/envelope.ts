import { ApiError } from '../domain/errors.js';

/** 会被转成应用层信封的状态码。 */
export const ENVELOPE_STATUS = new Set([400, 409]);

/** 成功信封：`{ ok:true, error:'', ...payload }`。 */
export function successEnvelope(payload: unknown = {}): Record<string, unknown> {
  return { ok: true, error: '', ...(payload as Record<string, unknown>) };
}

/**
 * 跑一段写操作并收成信封。
 *
 * 规则失败继续用 HTTP 200 + `{ ok:false }`，认证、授权、可用性和内部错误继续
 * 交给 Hono 的统一错误出口处理。
 */
export async function runEnveloped(run: () => unknown | Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    return successEnvelope(await run());
  } catch (error: unknown) {
    if (error instanceof ApiError && error.envelope && ENVELOPE_STATUS.has(error.status)) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
