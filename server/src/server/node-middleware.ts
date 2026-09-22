/**
 * 迁移期的 Node 响应头中间件：安全响应头、CORS、请求日志；外加一个 HTTP 语义补丁。
 *
 * 前三个为什么落在 Node 的 `ServerResponse` 上，而不是 Hono 的 `c.res.headers`：
 *
 * 骨架刚换过来时，`/api/v1/*` 与 `/status` 的路由还跑在 Express 里，Express 把响应
 * **直接写进 socket**（见 `express-bridge.ts`），Hono 那个「壳」响应会被整份丢掉。
 * 因此凡是「每个响应都要有」的头，必须在把请求交出去**之前**写到 socket 上：
 * Node 的 `writeHead()` 会把 `setHeader()` 设过的值与适配器写进来的头合并，
 * 两条路径（Hono 自己答、Express 代答）就都能带上。
 *
 * 路由全部迁完（第 12–15 单）之后，这三个会回到 `c.res` 上——那时 Express 已删，
 * 本文件随之删除。第四个 `headContentLength()` 与 socket 无关（适配器对 HEAD 不算
 * `Content-Length`），是常驻中间件，迁移完成后仍然留下。
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
 * `X-Powered-By` 交给 Express 的 `disable('x-powered-by')`（Hono 本来就不发它）。
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
export function securityHeaders(): MiddlewareHandler {
  return async function securityHeaders(c, next) {
    applyHeaders(c, SECURITY_HEADERS);
    await next();
  };
}

/**
 * CORS：把迁移前 `cors` 包的行为搬过来。
 *
 * - 固定来源（`CORS_ORIGIN` 是具体值）：无论请求带不带 Origin 都回同一个
 *   `Access-Control-Allow-Origin` + `Vary: Origin`，与 `cors` 包一致；
 * - `*`：回 `Access-Control-Allow-Origin: *`；
 * - 预检（OPTIONS）：204，回方法表并回显客户端请求的 `Access-Control-Request-Headers`，
 *   与 `cors` 包逐字一致；预检在**交给 Express 之前**就答掉，Express 那边不再看见它。
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
 * 监听的是 socket 的 `finish`，不是 Hono 的 Response —— 迁移期 Express 直接写响应，
 * 只有 socket 的 `finish` 对两条路径都准确（状态码与耗时都以真实写出去的那份为准）。
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
 * 于是 `HEAD /ping` 少一个 Express 会给的头。探针脚本（`curl -I`）会看它，
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
