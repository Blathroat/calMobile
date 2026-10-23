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
import { corsHeaders, headContentLength, requestLogger, requireHttps, securityHeaders } from './node-middleware.js';
import { errorResponse } from '../http/error-response.js';
import { jsonResponse } from '../http/respond.js';
import { jsonBodySizeGuard } from '../http/body-limit.js';
import { readStatusReport } from '../routes/status.js';
import { renderStatusPage, renderStatusFallbackPage } from '../status-page.js';
import { createAuthRoutes } from '../routes/auth-hono.js';
import { createExhibitionsRoutes } from '../routes/exhibitions-hono.js';
import { createMeetingsRoutes } from '../routes/meetings-hono.js';
import { createRegistrationsRoutes } from '../routes/registrations-hono.js';
import { createReviewRoutes } from '../routes/review-hono.js';
import { createCheckinRoutes } from '../routes/checkin-hono.js';
import { createProfileRoutes } from '../routes/profile-hono.js';
import { createBootstrapRoutes } from '../routes/bootstrap-hono.js';
import { createAppRoutes } from '../routes/app-hono.js';
import { createUsersRoutes } from '../routes/users-hono.js';
import { createSearchRoutes } from '../routes/search-hono.js';
import { createSettingsRoutes } from '../routes/settings-hono.js';
import { createMediaRoutes } from '../routes/media-hono.js';
import { createContentMediaRoutes } from '../routes/content-media-hono.js';
import type { TrustProxy } from '../config/runtime.js';
import { lookupAppFile } from './app-shell.js';
import { canonicalRedirect, isJoinPagePath, lookupJoinFile, requestHost } from './join-site.js';

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
  /** `/ping` 与 `/api/v1/ping` 是否开放。 */
  readonly pingEnabled: boolean;
  /** `/health` 是否开放（生产默认关）。 */
  readonly healthEnabled: boolean;
  /** 服务版本号（`package.json` 的 version），`/ping` 下发它。 */
  readonly serviceVersion: string;
  /** `HSTS_MAX_AGE`：0 表示不下发 `Strict-Transport-Security`；缺省 180 天。 */
  readonly hstsMaxAge?: number;
  /** `FORCE_HTTPS`：反代已终止 TLS 时把明文请求 308 跳到 https。 */
  readonly forceHttps?: boolean;
  /** 报名站构建目录。缺省或目录里没有入口文件时，未知路径仍是 JSON 404。 */
  readonly joinRoot?: string;
  /** 应用页面构建目录（`web/dist`）。有入口才托管 `/app/`。 */
  readonly appRoot?: string;
  /** `PUBLIC_BASE_URL`。配了之后，报名站和应用页面的 Host 必须和它对齐。 */
  readonly publicBaseUrl?: string;
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
   * `POST /api/v1/profile/avatar` 与 `POST /api/v1/media` 除外：它们传的是文件字节，上限由上传设置单独把关。
   * 所有正文都由 Hono 路由读取。
   * 实现只有一份：`http/body-limit.ts`。
   */
  app.use('*', jsonBodySizeGuard());

  // ── 探针（不代表数据库可用；连库一起看的是 /api/v1/status） ────
  // 关掉时不注册路由，404 与未知路径同一句，不说明开关名字。
  if (options.pingEnabled) {
    const ping = (c: Context): Response =>
      jsonResponse(c, { ok: true, service: SERVICE_NAME, version: options.serviceVersion });
    app.get('/ping', ping);
    app.get('/api/v1/ping', ping);
  }

  if (options.healthEnabled) {
    app.get('/health', (c) =>
      jsonResponse(c, { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }),
    );
  }

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
  }

  // 认证、资料、展会、报名、审核、核销、用户、搜索、设置和启动数据都由 Hono 处理。
  app.route('/api/v1/auth', createAuthRoutes({ trustProxy: options.trustProxy }));
  app.route('/api/v1/profile', createProfileRoutes({ trustProxy: options.trustProxy }));
  app.route('/api/v1', createBootstrapRoutes());
  // 公开的「最新版本 / 下载地址」：网页端检查更新与报名站下载条共用。
  app.route('/api/v1', createAppRoutes());
  app.route('/api/v1/users', createUsersRoutes());
  app.route('/api/v1/search', createSearchRoutes());
  app.route('/api/v1/settings', createSettingsRoutes());
  app.route('/api/v1/media', createContentMediaRoutes());

  app.route('/api/v1/exhibitions', createExhibitionsRoutes());
  app.route('/api/v1/meetings', createMeetingsRoutes());
  app.route('/api/v1/registrations', createRegistrationsRoutes());
  app.route('/api/v1/review', createReviewRoutes());
  app.route('/api/v1/checkin', createCheckinRoutes());
  app.route('/media', createMediaRoutes());

  if (options.appRoot) {
    const appRoot = options.appRoot;
    const serveAppShell = (c: Context): Response => {
      const url = new URL(c.req.url);
      const location = canonicalRedirect({
        requestHost: requestHost({
          host: c.req.header('host') || '',
          forwardedHost: c.req.header('x-forwarded-host') || '',
          trustProxy: options.trustProxy,
        }),
        publicBaseUrl: options.publicBaseUrl || '',
        pathAndQuery: `${url.pathname}${url.search}`,
      });
      if (location) return c.redirect(location, 308);
      const found = lookupAppFile(appRoot, url.pathname);
      if (found.kind === 'missing') {
        return new Response('资源不存在', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return new Response(new Uint8Array(found.file.body), {
        status: 200,
        headers: {
          'content-type': found.file.type,
          'cache-control': found.file.cache,
        },
      });
    };
    app.get('/app', serveAppShell);
    app.get('/app/*', serveAppShell);
  }

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
    const path = `${url.pathname}${url.search}`;
    const missing = jsonResponse(
      c,
      { error: `路径 ${path} 不存在`, errorCode: 'app.routeNotFound', errorParams: { path } },
      404,
    );
    if (!options.joinRoot || !isJoinPagePath(url.pathname)) return missing;
    const location = canonicalRedirect({
      requestHost: requestHost({
        host: c.req.header('host') || '',
        forwardedHost: c.req.header('x-forwarded-host') || '',
        trustProxy: options.trustProxy,
      }),
      publicBaseUrl: options.publicBaseUrl || '',
      pathAndQuery: `${url.pathname}${url.search}`,
    });
    if (location) return c.redirect(location, 308);
    const found = lookupJoinFile(options.joinRoot, url.pathname);
    if (found.kind === 'missing') {
      return new Response('资源不存在', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response(new Uint8Array(found.file.body), {
      status: 200,
      headers: {
        'content-type': found.file.type,
        'cache-control': found.file.cache,
      },
    });
  });

  return app;
}
