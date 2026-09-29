/**
 * Hono 骨架：公共中间件、探针、认证路由、状态页、统一错误处理和业务路由。
 *
 * 所有业务路由都在这里直接挂载，服务不再保留 Express 兼容层。
 *
 * 骨架的公共层依次是：安全响应头 → CORS → 请求日志 → JSON 体积守卫 → 路由。
 * 这些层同时支持真 Node socket 和 `app.request()` 测试调用。
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { TrustProxy } from '../config/runtime.js';
import { corsHeaders, headContentLength, requestLogger, requireHttps, securityHeaders } from './node-middleware.js';
import { errorResponse } from '../http/error-response.js';
import { jsonResponse } from '../http/respond.js';
import { jsonBodySizeGuard } from '../http/body-limit.js';
import { readStatusReport } from '../routes/status.js';
import { renderStatusPage, renderStatusFallbackPage } from '../status-page.js';
import { createAuthRoutes } from '../routes/auth-hono.js';
import { createExhibitionsRoutes } from '../routes/exhibitions-hono.js';
import { createRegistrationsRoutes } from '../routes/registrations-hono.js';
import { createReviewRoutes } from '../routes/review-hono.js';
import { createCheckinRoutes } from '../routes/checkin-hono.js';
import { createProfileRoutes } from '../routes/profile-hono.js';
import { createBootstrapRoutes } from '../routes/bootstrap-hono.js';
import { createUsersRoutes } from '../routes/users-hono.js';
import { createSearchRoutes } from '../routes/search-hono.js';
import { createSettingsRoutes } from '../routes/settings-hono.js';

/** 与 `/api/v1/status` 的服务标识一致。 */
const SERVICE_NAME = 'calmobile-server';

export interface AppOptions {
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
  /** `HSTS_MAX_AGE`：0 表示不下发 `Strict-Transport-Security`；缺省 180 天。 */
  readonly hstsMaxAge?: number;
  /** `FORCE_HTTPS`：反代已终止 TLS 时把明文请求 308 跳到 https。 */
  readonly forceHttps?: boolean;
}

/**
 * 建一个 Hono 应用。
 *
 * 依赖全部从参数进来（不直接读 `process.env`），便于测试不同运行模式。
 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  // ── 公共层（每个响应都要经过） ──────────────────────────────
  // 顺序有讲究：安全头要落在 socket 上（见文件头），HEAD 补长度要包住后面的所有层，
  // CORS 要能在预检上先答 204，日志要能监听整个链路的 finish。
  app.use(headContentLength());
  app.use(securityHeaders(options.hstsMaxAge));
  // 反代终止 TLS 时先把明文请求跳走：安全头与 CORS 都在它之后，跳转响应本身不需要它们。
  if (options.forceHttps === true) app.use(requireHttps());
  app.use(corsHeaders(options.corsOrigin));
  app.use(requestLogger({ logLevel: options.logLevel, trustProxy: options.trustProxy }));

  /**
   * JSON 体积守卫：声明体积超过 2MB 直接 413。
   *
   * 放在所有路由之前，超限请求不会进入业务处理器。
   * 所有正文都由 Hono 路由读取。
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
  // 生产默认关：它暴露迁移清单、各表行数与接口清单，属于运维排查入口。
  if (options.statusPageEnabled) {
    const report = async (c: Context, html: boolean): Promise<Response> => {
      const status = await readStatusReport(app.routes);
      if (!html) return jsonResponse(c, status, status.ok ? 200 : 503);
      try {
        return new Response(renderStatusPage(status), {
          status: 200,
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch (error: unknown) {
        console.error('状态页渲染失败：', error);
        return new Response(renderStatusFallbackPage(), {
          status: 200,
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    };
    app.get('/status', (c) => report(c, true));
    app.get('/api/v1/status', (c) => report(c, false));
  } else {
    const disabled = (c: Context): Response =>
      jsonResponse(c, { error: '状态页在生产环境已关闭（需要时设 ENABLE_STATUS_PAGE=true 再启动）' }, 404);
    app.get('/status', disabled);
    app.get('/api/v1/status', disabled);
  }

  // 认证、资料、展会、报名、审核、核销、用户、搜索、设置和启动数据都由 Hono 处理。
  app.route('/api/v1/auth', createAuthRoutes({ trustProxy: options.trustProxy }));
  app.route('/api/v1/profile', createProfileRoutes({ trustProxy: options.trustProxy }));
  app.route('/api/v1', createBootstrapRoutes());
  app.route('/api/v1/users', createUsersRoutes());
  app.route('/api/v1/search', createSearchRoutes());
  app.route('/api/v1/settings', createSettingsRoutes());

  app.route('/api/v1/exhibitions', createExhibitionsRoutes());
  app.route('/api/v1/registrations', createRegistrationsRoutes());
  app.route('/api/v1/review', createReviewRoutes());
  app.route('/api/v1/checkin', createCheckinRoutes());

  /**
   * 统一错误处理。
   *
   * 状态码与文案的唯一实现在 `http/error-response.ts`。堆栈只进日志。
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
