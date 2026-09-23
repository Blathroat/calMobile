/**
 * Hono 骨架：中间件、探针、统一错误处理，以及「还没迁移的路由交给 Express」的承接点。
 *
 * 这一份是**结构**，不含业务：业务仍按资源分在 `src/routes/`（第 12–15 单逐批搬到
 * Hono），本文件只决定请求流过哪些公共层、怎么答错、404 长什么样。
 *
 * 骨架的公共层依次是：安全响应头 → CORS → 请求日志 → JSON 体积守卫 → 路由。
 * 前三层必须落在 Node socket 上（迁移期 Express 直接写响应，理由见
 * `node-middleware.ts` 的文件头），后两类是 Hono 自己的。
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { RequestListener } from 'node:http';
import type { TrustProxy } from '../config/runtime.js';
import { corsHeaders, headContentLength, requestLogger, securityHeaders } from './node-middleware.js';
import { delegateTo } from './express-bridge.js';
import { errorResponse } from '../http/error-response.js';
import { jsonResponse } from '../http/respond.js';
import { jsonBodySizeGuard } from '../http/body-limit.js';

/** 与 `/api/v1/status` 的服务标识一致。 */
const SERVICE_NAME = 'calmobile-server';

export interface AppOptions {
  /** 尚未迁移的 Express 应用（`express-app.ts` 负责建它）。 */
  readonly expressApp: RequestListener;
  /** `CORS_ORIGIN`：固定来源或 `*`。 */
  readonly corsOrigin: string;
  /** `LOG_LEVEL`：`quiet` 关掉请求日志。 */
  readonly logLevel: string;
  /** `TRUST_PROXY`：决定 `clientIp()` 怎么解析客户端地址。 */
  readonly trustProxy: TrustProxy;
  /** `/status` 与 `/api/v1/status` 是否开放（生产默认关）。 */
  readonly statusPageEnabled: boolean;
  /** 服务版本号（`package.json` 的 version），`/ping` 下发它。 */
  readonly serviceVersion: string;
}

/**
 * 建一个 Hono 应用。
 *
 * 依赖全部从参数进来（不直接读 `process.env`）：单元测试可以拿一个迷你 Express 应用
 * 把骨架完整跑起来，不需要数据库、也不需要真端口。
 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  // ── 公共层（每个响应都要经过） ──────────────────────────────
  // 顺序有讲究：安全头要落在 socket 上（见文件头），HEAD 补长度要包住后面的所有层，
  // CORS 要能在预检上先答 204，日志要能监听整个链路的 finish。
  app.use(headContentLength());
  app.use(securityHeaders());
  app.use(corsHeaders(options.corsOrigin));
  app.use(requestLogger({ logLevel: options.logLevel, trustProxy: options.trustProxy }));

  /**
   * JSON 体积守卫：声明体积超过 2MB 直接 413。
   *
   * 放在所有路由（含 Express 承接点）之前，超限请求既不会进 Hono 也不会进 Express。
   * 正文本身的解析仍由 Express 的 `express.json()` 做（它带的 limit 是同一数值），
   * 守卫因此只看 `content-length` 不碰字节流，免得把流读走（见 express-bridge.ts）。
   * 实现只有一份：`http/body-limit.ts`。
   */
  app.use('*', jsonBodySizeGuard());

  // ── 探针（不代表数据库可用；连库一起看的是 /api/v1/status） ────
  // 探针不是写操作：响应里没有 error 字段，和迁移前的 res.json 一模一样
  const ping = (c: Context): Response =>
    jsonResponse(c, { ok: true, service: SERVICE_NAME, version: options.serviceVersion });

  app.get('/ping', ping);
  app.get('/api/v1/ping', ping);

  /** 与 /ping 同义的存活探针。 */
  app.get('/health', (c) =>
    jsonResponse(c, { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }),
  );

  // ── 状态页开关 ────────────────────────────────────────────
  // 生产默认关：它暴露迁移清单、各表行数与接口清单，
  // 属于运维排查入口而不是公开接口。开着时由 Express 的状态路由提供（第 16 单搬到 Hono）。
  if (!options.statusPageEnabled) {
    const disabled = (c: Context): Response =>
      jsonResponse(c, { error: '状态页在生产环境已关闭（需要时设 ENABLE_STATUS_PAGE=true 再启动）' }, 404);
    app.get('/status', disabled);
    app.get('/api/v1/status', disabled);
  }

  // ── 其余全部交给尚未迁移的 Express 应用 ─────────────────────
  // Hono 按注册顺序匹配，所以两个探针与状态页开关要注册在兜底之前，
  // 否则 `/api/v1/ping`、`/api/v1/status` 会被这条兜底先接走。
  app.all('/api/v1/*', delegateTo(options.expressApp));
  if (options.statusPageEnabled) {
    app.all('/status', delegateTo(options.expressApp));
  }

  /**
   * 统一错误处理。
   *
   * 状态码与文案的唯一实现在 `http/error-response.ts`（尚未迁移的 Express 错误
   * 中间件用的是同一套函数，因此两条路径回出去的东西完全一致）。堆栈只进日志。
   */
  app.onError((err, c) => {
    const { status, body } = errorResponse(err);
    console.error(`请求失败（${status}）：`, err);
    return jsonResponse(c, body, status);
  });

  /**
   * 404：路径不存在。
   *
   * 带上查询串（与迁移前 `req.originalUrl` 的形状一致）；找不到**资源**由各路由自己
   * 给 404 + 一句业务文案，这里只答「路由不存在」。
   */
  app.notFound((c) => {
    const url = new URL(c.req.url);
    return jsonResponse(c, { error: `路径 ${url.pathname}${url.search} 不存在` }, 404);
  });

  return app;
}
