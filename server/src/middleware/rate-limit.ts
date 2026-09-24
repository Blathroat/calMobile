/**
 * 认证接口的内存滑动窗口限流。
 *
 * 登录 / 注册此前没有任何限速，bcrypt 只拖慢单次猜测，挡不住脚本化撞库。
 * 不引入第三方限流依赖（保持依赖收敛），单进程内存窗口足够兜住
 * 当前「应用唯一客户端 + 本机部署」的形态；将来多实例部署时再换共享存储。
 */

import { ApiError } from '../domain/errors.js';
import type { Context, MiddlewareHandler } from 'hono';

const buckets = new Map<string, number[]>();

/** 上次清理时间：避免每个请求都全表扫一遍。 */
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60 * 1000) {
    return;
  }
  lastSweep = now;
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((at) => now - at < 15 * 60 * 1000);
    if (fresh.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, fresh);
    }
  }
}

/**
 * 这次响应的 JSON 正文是不是业务失败信封。
 *
 * 写接口的规则失败是 HTTP 200 + `{ ok: false }`（见 http/envelope.ts），
 * 所以不能只看状态码。
 */
export function isEnvelopeFailure(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  return (body as { ok?: unknown }).ok === false;
}

/**
 * 这次响应是否计入认证失败窗口。
 *
 * 失败两类：状态码 ≥ 400，以及 200 + `{ ok: false }` 业务信封。
 */
export function isAuthFailure(statusCode: number, body: unknown): boolean {
  return statusCode >= 400 || isEnvelopeFailure(body);
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
}

/** 记一次失败；顺手按 15 分钟清掉过老的记录，避免长尾堆积。 */
function record(key: string, at: number): void {
  const hits = (buckets.get(key) || []).filter((time) => at - time < 15 * 60 * 1000);
  hits.push(at);
  buckets.set(key, hits);
}

/** 测试用：清空全部计数，避免用例之间互相污染。 */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

/** Hono 路由使用的同一套失败限流。 */
export function honoRateLimit({
  windowMs,
  max,
  message,
  identity,
  ip,
}: RateLimitOptions & {
  identity: (c: Context) => string | Promise<string>;
  ip?: (c: Context) => string;
}): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    sweep(now);
    const key = `${c.req.path}|${ip ? ip(c) : ''}|${String(await identity(c)).toLowerCase()}`;
    const hits = (buckets.get(key) || []).filter((at) => now - at < windowMs);
    if (hits.length >= max) {
      throw new ApiError(429, message);
    }

    try {
      await next();
    } catch (error: unknown) {
      // 统一错误出口在中间件外层处理；这里先记下抛出的失败，再把错误交回统一出口。
      const status = error instanceof ApiError ? error.status : 500;
      if (isAuthFailure(status, undefined)) {
        record(key, Date.now());
      }
      throw error;
    }
    let body: unknown = null;
    try {
      body = await c.res.clone().json();
    } catch {
      // 非 JSON 响应不属于认证信封；状态码仍会计入失败。
    }
    if (isAuthFailure(c.res.status, body)) {
      record(key, Date.now());
    }
  };
}
