/**
 * 认证接口的内存滑动窗口限流。
 *
 * 登录 / 注册此前没有任何限速，bcrypt 只拖慢单次猜测，挡不住脚本化撞库。
 * 不引入 express-rate-limit 依赖（保持依赖收敛），单进程内存窗口足够兜住
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
 * 写接口的规则失败是 HTTP 200 + `{ ok: false }`（见 domain/respond.ts），
 * 所以不能只看状态码。抽成纯函数，Express 猴补丁与日后读 clone 响应共用。
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

export interface RateLimitRequest {
  path: string;
  ip?: string;
  body?: {
    username?: unknown;
    email?: unknown;
  };
}

export interface RateLimitResponse {
  statusCode: number;
  json(body: unknown): unknown;
  on(event: string, handler: () => void): unknown;
}

type NextFn = (error?: unknown) => void;

/**
 * 固定窗口内最多 max 次**失败**，超出给 429。
 *
 * key 按「IP + 用户名」分桶：只按 IP 会把同一 NAT 后的用户一起误伤，
 * 只按用户名又挡不住对一批账号的轮询爆破，两个维度相与才够窄。
 *
 * **只统计失败**：登录成功不该被计数——否则一个人连着登录十来次（演示、回归、
 * 换账号）就会把自己锁在外面 5 分钟，而撞库脚本恰恰全是失败请求，这样拦得住。
 * 失败包含两类：4xx（认证 / 授权错误）与 200 + `{ ok:false }`（业务失败信封）。
 */
export function rateLimit({ windowMs, max, message }: RateLimitOptions) {
  return (req: RateLimitRequest, res: RateLimitResponse, next: NextFn): void => {
    const now = Date.now();
    sweep(now);
    const identity = String(req.body?.username || req.body?.email || '').toLowerCase();
    const key = `${req.path}|${req.ip || ''}|${identity}`;
    const hits = (buckets.get(key) || []).filter((at) => now - at < windowMs);
    if (hits.length >= max) {
      next(new ApiError(429, message));
      return;
    }

    // 响应是失败才记账：先看信封（业务失败也是 200），再看状态码。
    // 信封失败是粘性的：同一次响应里只要出现过 `{ ok:false }`，后续再 json 成功也不清掉。
    let envelopeFailure = false;
    const sendJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (isEnvelopeFailure(body)) {
        envelopeFailure = true;
      }
      return sendJson(body);
    };
    res.on('finish', () => {
      if (envelopeFailure || res.statusCode >= 400) {
        record(key, Date.now());
      }
    });
    next();
  };
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
      // Hono 的统一错误出口在中间件外层处理；这里先记下与 Express
      // `finish` + statusCode >= 400 相同的失败，再把错误交回统一出口。
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
