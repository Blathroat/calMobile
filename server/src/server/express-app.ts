/**
 * 尚未迁移的 Express 应用：只留业务路由与错误出口。
 *
 * 公共层（CORS、请求体解析之外的部分、请求日志、探针、404、统一错误处理）已经搬到
 * Hono 骨架（`src/server/hono-app.ts`），这里**不再重复**：
 *
 * - `cors()` 已删——骨架的 `corsHeaders()` 会替它把 `Access-Control-Allow-*` 写到 socket；
 * - 请求日志已删——骨架的 `requestLogger()` 监听同一个 socket 的 `finish`；
 * - `/ping`、`/health`、404、错误中间件已删——分别由骨架的探针、`notFound` 与 `onError` 接管，
 *   但错误分类复用同一套函数（`http/error-response.ts`），因此响应对外一模一样；
 * - `express.urlencoded` 保留：删它属于第 21 单（依赖清理）的范围，与行为无关但先不动。
 *
 * `trust proxy` 与 `x-powered-by` 仍在 Express 这边管：`req.ip`（限流按 IP 分桶）、
 * `req.protocol` 之类的语义只有本框架读得到，三条信任状态与 `clientIp()` 完全一致。
 */

import express from 'express';
import type { ErrorRequestHandler, Router } from 'express';
import type { RequestListener } from 'node:http';
import * as runtime from '../config/runtime.js';
import { routes } from '../routes/registry.js';
import { errorResponse } from '../http/error-response.js';

export interface DelegatedOptions {
  /** `/status` 与 `/api/v1/status` 是否挂载（骨架按同一个开关决定谁来答）。 */
  readonly statusPageEnabled: boolean;
}

/**
 * 建 Express 应用。
 *
 * @param statusRoutes 状态页路由（`/status` 与 `/api/v1/status` 共用一份探测逻辑）。
 *                     放进来而不是在这里 import，是为了把「状态页」这个待迁移模块的
 *                     依赖方向保持单向（第 16 单整个搬到 Hono 时这里自然消失）。
 */
export function createDelegatedApp(statusRoutes: Router, options: DelegatedOptions): RequestListener {
  const app = express();

  // 不广播技术栈（一行成本的信息收敛）。
  app.disable('x-powered-by');

  // 反向代理后面必须显式声明：不设的话 `req.ip` 是代理地址，按 IP 的验证码限流会
  // 退化成「全体用户共用一个额度」；反过来在直连场景开着它，客户端就能伪造
  // X-Forwarded-For 绕过限流。三态语义与骨架的 clientIp() 一致（见 http/client-ip.ts）。
  app.set('trust proxy', runtime.trustProxy);

  // 请求体解析留在这里：路由还没迁完，`req.body` 仍由 body-parser 填。
  // 体积上限 2MB 与骨架的守卫是同一个值，超限/坏 JSON 的文案也同源。
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 业务路由：路径与前端 `js/core/api.js` 的动作域一一对应（见 README「前后端边界」）。
  for (const [prefix, router] of Object.entries(routes)) {
    app.use(`/api/v1${prefix ? `/${prefix}` : ''}`, router);
  }

  // 状态页：人读的 HTML（/status）与机器读的 JSON（/api/v1/status）共用一份探测逻辑。
  // 骨架只在 `statusPageEnabled` 时把这两个路径交给这个应用。
  if (options.statusPageEnabled) {
    app.use('/api/v1/status', statusRoutes);
    app.use('/status', statusRoutes);
  }

  // 路径不存在（不是「资源不存在」，那种情况由各路由给 404 + 一句业务文案）。
  // 骨架的 notFound 也回同一句话，因此这个兜底只在「Express 自己接住了未知路径」时生效
  // （/api/v1/* 承接点之外的路径不会到这里）。
  app.use((req, res) => {
    res.status(404).json({ error: `路径 ${req.originalUrl} 不存在` });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const { status, body } = errorResponse(err);
    console.error(`请求失败（${status}）：`, err);
    res.status(status).json(body);
  };
  app.use(errorHandler);

  return app as unknown as RequestListener;
}
