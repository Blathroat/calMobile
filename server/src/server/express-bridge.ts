/**
 * 把尚未迁移的 Express 应用挂到 Hono 骨架下面。
 *
 * 第 12–15 单会把路由一批批搬到 Hono；在那之前，`/api/v1/*` 与 `/status` 的请求必须
 * 还能被 Express 原样接住——同一份响应、同一个状态码、同一句中文文案。
 *
 * 做法：把 Node 原始的 `incoming` / `outgoing` 直接交给 Express 应用，等它把响应写完，
 * 再返回一个**空正文 + `x-hono-already-sent`** 的标记响应，`@hono/node-server` 见到
 * 这个标记就跳过自己的 `writeHead`，连接里因此只有一份响应。
 *
 * 三条约束（改动前先读 `node-middleware.ts` 的文件头）：
 *
 * 1. **必须建服务时传 `overrideGlobalObjects: false`**。适配器默认会把全局 `Response`
 *    换成带缓存的子类，空响应走的是「缓存分支」，那里不看这个标记，于是 Express 写完它
 *    再写一次，报 `ERR_HTTP_HEADERS_SENT`；
 * 2. **公共层要落在 Node 的 socket 上**。Express 把响应直接写进 socket，Hono 那个壳
 *    响应会被整份丢掉，所以安全头 / CORS / 请求日志都由骨架提前写到 `ServerResponse`；
 * 3. **不能有中间件提前读走请求体**。Express 的 `express.json()` 自己会读，骨架的体积
 *    守卫只看 `content-length`（见 `http/body-limit.ts`）。
 */

import type { MiddlewareHandler } from 'hono';
import type { RequestListener } from 'node:http';
import { applyHeaders, type NodeEnv } from './node-middleware.js';

/** 标记：这份响应已经有人写过了，适配器别再写一次。 */
function alreadySent(): Response {
  return new Response(null, { headers: { 'x-hono-already-sent': 'true' } });
}

/** 同一事件只放行一次：finish 与 close 都可能触发。 */
function once(fn: () => void): () => void {
  let fired = false;
  return () => {
    if (fired) {
      return;
    }
    fired = true;
    fn();
  };
}

/**
 * 生成「交给 Express 代答」的处理器。
 *
 * @param expressApp 尚未迁移的 Express 应用（`express-app.ts` 建出来的那个）
 */
export function delegateTo(expressApp: RequestListener): MiddlewareHandler {
  return async function delegateTo(c) {
    const env = c.env as NodeEnv | undefined;
    if (!env?.incoming || !env?.outgoing) {
      // 没有 socket（例如单元测试里的 `app.request()`）时没有可承接的 Express 实例。
      // 这种情况只可能来自测试：真实服务里 Node 适配器总会带上 incoming/outgoing。
      return c.notFound();
    }
    const { incoming, outgoing } = env;
    await new Promise<void>((resolve) => {
      const done = once(() => resolve());
      outgoing.on('finish', done);
      outgoing.on('close', done);
      expressApp(incoming, outgoing);
    });

    // 兜底：Express 一个字节都没写就回来了。正常不会发生（它的路由表后面挂着 404 与
    // 错误中间件，两种情况都会写响应），但不补一句的话客户端只能干等到超时。
    if (!outgoing.headersSent && outgoing.writable) {
      applyHeaders(c, [['Content-Type', 'application/json; charset=utf-8']]);
      outgoing.writeHead(500);
      outgoing.end(JSON.stringify({ error: '服务器内部错误' }));
    }
    return alreadySent();
  };
}
