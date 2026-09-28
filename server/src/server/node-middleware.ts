/**
 * Node 响应头中间件：安全响应头、CORS、请求日志；外加一个 HTTP 语义补丁。
 *
 * 前三个为什么落在 Node 的 `ServerResponse` 上，而不是 Hono 的 `c.res.headers`：
 *
 * `@hono/node-server` 在真服务中直接写 Node socket，因此凡是「每个响应都要有」的头，
 * 都要在处理器前写到 socket 上：
 * Node 的 `writeHead()` 会把 `setHeader()` 设过的值与适配器写进来的头合并，
 * 真服务与 `app.request()` 都能带上。
 *
 * `headContentLength()` 与 socket 无关（适配器对 HEAD 不算 `Content-Length`），是常驻中间件。
 */

import type { Context, MiddlewareHandler } from 'hono';
import type http from 'node:http';
import type { Socket } from 'node:net';
import { clientIp, ensureTrustProxy } from '../http/client-ip.js';
import type { TrustProxy } from '../config/runtime.js';

/** `@hono/node-server` 通过 `c.env` 把 Node 的请求 / 响应对象交给处理器。 */
export interface NodeEnv {
  incoming?: http.IncomingMessage & { socket?: Socket };
  outgoing?: http.ServerResponse;
}

/** 取 Node 出口（`app.request()` 之类没有 socket 的场景下是 undefined）。 */
function outgoingOf(c: Context): http.ServerResponse | undefined {
  return (c.env as NodeEnv | undefined)?.outgoing;
}

/** 迁移前 `cors` 包的默认方法表（顺序也一致，预检响应按原样返回）。 */
const DEFAULT_ALLOW_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE';

/**
 * 安全响应头。
 *
 * 值取自 Hono 自带的 `secureHeaders` 默认集（`hono/secure-headers` 的 DEFAULT_OPTIONS），
 * 一份静态表两个出口都用它，不会出现「API 有头、页面没头」。
 * Hono 本身不发送 `X-Powered-By`。
 */
export const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
  ['Referrer-Policy', 'no-referrer'],
  ['Strict-Transport-Security', 'max-age=15552000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-DNS-Prefetch-Control', 'off'],
  ['X-Download-Options', 'noopen'],
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  ['X-XSS-Protection', '0'],
];

/** 往 Vary 上追加一个来源：预检要把「客户端请求里带了哪些头」也算进去。 */
function appendVary(c: Context, value: string): void {
  const outgoing = outgoingOf(c);
  if (outgoing && typeof outgoing.appendHeader === 'function') {
    outgoing.appendHeader('Vary', value);
    return;
  }
  const existing = c.res.headers.get('Vary');
  c.res.headers.set('Vary', existing ? `${existing}, ${value}` : value);
}

/** 把「本次响应该有哪些头」落到具体出口：有 socket 写 socket，否则写 Hono 的 Response。 */
export function applyHeaders(c: Context, entries: readonly (readonly [string, string])[]): void {
  const outgoing = outgoingOf(c);
  for (const [name, value] of entries) {
    if (outgoing) {
      outgoing.setHeader(name, value);
    } else {
      c.res.headers.set(name, value);
    }
  }
}

/** 安全响应头中间件（见文件头说明：必须落在 socket 上）。 */
export function securityHeaders(hstsMaxAge = 15_552_000): MiddlewareHandler {
  // HSTS 单独拼：`HSTS_MAX_AGE=0` 表示不下发（域名还没定、或本地用 http 调试时）。
  const headers = hstsMaxAge > 0
    ? SECURITY_HEADERS
    : SECURITY_HEADERS.filter((header) => header[0] !== 'Strict-Transport-Security');
  return async function securityHeaders(c, next) {
    applyHeaders(c, headers);
    await next();
  };
}

/**
 * 明文请求跳到 https（反代已经终止 TLS 的部署用）。
 *
 * 只在 `FORCE_HTTPS=1` 时挂上；判断依据是 `X-Forwarded-Proto`（反代设置），
 * 拿不到这个头时按「已经是 https」处理 —— 直连部署误开这一项时，
 * 至少不会把请求跳到一个不存在的 https 端口上。
 */
export function requireHttps(): MiddlewareHandler {
  return async function requireHttps(c, next) {
    const forwarded = c.req.header('x-forwarded-proto');
    const proto = String(forwarded || '').split(',')[0]?.trim().toLowerCase() ?? '';
    if (proto === 'http') {
      const host = String(c.req.header('host') || '').trim();
      if (host) {
        // 308 保留方法与请求体：表单 POST 被跳到 https 后不需要客户端重发一次。
        const url = new URL(c.req.url);
        return c.redirect(`https://${host}${url.pathname}${url.search}`, 308);
      }
    }
    await next();
  };
}

/**
 * CORS：保持原有响应头和预检行为。
 *
 * - 固定来源（`CORS_ORIGIN` 是具体值）：无论请求带不带 Origin 都回同一个
 *   `Access-Control-Allow-Origin` + `Vary: Origin`，与 `cors` 包一致；
 * - `*`：回 `Access-Control-Allow-Origin: *`；
 * - 预检（OPTIONS）：204，回方法表并回显客户端请求的 `Access-Control-Request-Headers`，
 *   与标准 CORS 客户端预期一致；预检在业务路由之前就答掉。
 */
export function corsHeaders(origin: string): MiddlewareHandler {
  const allowAll = origin.trim() === '*';
  return async function corsHeaders(c, next) {
    applyHeaders(
      c,
      allowAll
        ? [['Access-Control-Allow-Origin', '*']]
        : [
            ['Access-Control-Allow-Origin', origin],
            ['Vary', 'Origin'],
          ],
    );

    if (c.req.method !== 'OPTIONS') {
      await next();
      return;
    }

    const requestedHeaders = c.req.header('Access-Control-Request-Headers');
    applyHeaders(c, [
      ['Access-Control-Allow-Methods', DEFAULT_ALLOW_METHODS],
      ...(requestedHeaders ? [['Access-Control-Allow-Headers', requestedHeaders] as const] : []),
      ['Content-Length', '0'],
    ]);
    // 回显了客户端请求的头表，缓存就必须按它分版本——与 cors 包的逐字一致
    appendVary(c, 'Access-Control-Request-Headers');
    return c.body(null, 204);
  };
}

/**
 * 请求日志：`LOG_LEVEL=quiet` 关掉（测试与联调时更清爽）。
 *
 * 监听的是 socket 的 `finish`，不是 Hono 的 Response —— 只有 socket 的 `finish`
 * 对真实服务准确（状态码与耗时都以真实写出去的那份为准）。
 * 行首是 `clientIp()` 解析出来的客户端地址：不信任代理时记 socket 对端，
 * 不会把伪造的 X-Forwarded-For 写进日志。
 */
export function requestLogger(options: { logLevel: string; trustProxy: TrustProxy }): MiddlewareHandler {
  const enabled = options.logLevel !== 'quiet';
  // 先把信任配置编译一遍：写错的 TRUST_PROXY（不是 IP、不是掩码、前缀越界）会让进程
  // 在这里就退出，而不是等到第一个请求算不出 IP 时全部 500。
  const trustProxy = enabled ? ensureTrustProxy(options.trustProxy) : options.trustProxy;
  return async function requestLogger(c, next) {
    const outgoing = outgoingOf(c);
    if (!enabled || !outgoing) {
      await next();
      return;
    }
    const incoming = (c.env as NodeEnv).incoming;
    const startedAt = Date.now();
    const url = new URL(c.req.url);
    const line = `${clientIp(
      { remoteAddress: incoming?.socket?.remoteAddress, forwardedFor: c.req.header('x-forwarded-for') },
      trustProxy,
    )} ${c.req.method} ${url.pathname}${url.search}`;
    outgoing.on('finish', () => {
      console.log(`${line} ${outgoing.statusCode} ${Date.now() - startedAt}ms`);
    });
    await next();
  };
}

/**
 * HEAD 响应补 `Content-Length`。
 *
 * `@hono/node-server` 只对带正文的响应算这个头，HEAD 会被 Node 丢掉正文却不补长度，
 * 因此 `HEAD /ping` 需要显式补齐长度。探针脚本（`curl -I`）会看它，
 * 因此在骨架里补上：正文照常生成，只是客户端收不到。
 */
export function headContentLength(): MiddlewareHandler {
  return async function headContentLength(c, next) {
    await next();
    if (c.req.method !== 'HEAD' || !c.res.body || c.res.headers.has('content-length')) {
      return;
    }
    const length = new Uint8Array(await c.res.clone().arrayBuffer()).byteLength;
    if (length > 0) {
      c.res.headers.set('content-length', String(length));
    }
  };
}
