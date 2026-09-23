/**
 * 展会排期助手后端服务器。
 *
 * 与客户端的约定见 server/README.md：
 * - 读取类接口直接返回数据本身（数组或对象）；
 * - 写入类接口返回应用层信封 `{ ok, error, ... }`，业务失败也是 200，页面按 `.ok` 判断；
 * - 认证 / 授权 / 服务器错误用 4xx / 5xx + `{ error }`，前端会当作异常处理；
 * - **数据库连不上/用不了**统一 503（`domain/errors.ts` 的 `isDatabaseUnavailable()`），
 *   不是 500 —— 这是「暂时不可用、可以重试」，也能避免把 pg 的错误原文回给调用方。
 *
 * 服务骨架是 Hono（`src/server/hono-app.ts`）；认证路由已经在 Hono 上运行，其余尚未迁移的
 * `/api/v1/*` 与 `/status` 由 `src/server/express-app.ts` 的 Express 应用代答（承接机制见
 * `src/server/express-bridge.ts`）。因此本文件只做三件事：
 * 解析运行环境、把两个应用接起来、把服务起起来。
 */

// 运行环境必须在**任何**读取 NODE_ENV 的模块之前定下来（见 config/runtime.ts：
// pnpm start 走生产、pnpm dev 走开发，状态页与启动自检都按它决定）。
import * as runtime from './config/runtime.js';
import { loadProcessConfig } from './config/env.js';
import { isEntry } from './entry.js';

import { createAdaptorServer } from '@hono/node-server';
import { createApp } from './server/hono-app.js';
import { createDelegatedApp } from './server/express-app.js';
import statusRoutes from './routes/status.js';
import { routes } from './routes/registry.js';
import { productionProblems } from './config/production.js';
import { pool } from './config/pool.js';
import packageJson from '../package.json' with { type: 'json' };

/** @hono/node-server 起的服务：HTTP/1 与 HTTP/2 是这个工具的类型并集，这里按 HTTP/1 用。 */
type NodeServer = ReturnType<typeof createAdaptorServer>;

const config = loadProcessConfig();
const PORT = config.port;

/**
 * 尚未迁移的 Express 应用。
 *
 * 现在只承载尚未迁移的业务路由与请求体解析；骨架每搬走一批路由，这里就小一圈，
 * 第 15 单之后整个模块连同 Express 依赖一起退役。
 */
const delegatedApp = createDelegatedApp(statusRoutes, { statusPageEnabled: runtime.statusPageEnabled });

/** 骨架：公共层 + 探针 + 统一错误处理 + 「其余交给 Express」的承接点。 */
const app = createApp({
  expressApp: delegatedApp,
  corsOrigin: config.corsOrigin,
  logLevel: config.logLevel,
  trustProxy: runtime.trustProxy,
  statusPageEnabled: runtime.statusPageEnabled,
  serviceVersion: packageJson.version,
});

/**
 * 起一个 Node 服务跑给定的 `fetch`（`Hono.fetch`）。
 *
 * `overrideGlobalObjects: false` 是硬要求：它让适配器保留 Node 原生的 `Response`，
 * Express 代答才能用 `x-hono-already-sent` 标记跳过「再写一次」
 * （详见 `src/server/express-bridge.ts` 的文件头）。
 *
 * 不给 hostname 时绑全部网卡（与迁移前 `app.listen(PORT)` 一致）；测试与脚本传
 * `127.0.0.1` 更稳。
 */
export function serveApp(
  fetch: typeof app.fetch,
  port: number,
  hostname?: string,
  listeningListener?: () => void,
): NodeServer {
  const server = createAdaptorServer({ fetch, overrideGlobalObjects: false });
  server.listen(port, hostname, listeningListener);
  return server;
}

/** 监听本进程的服务端口。 */
function listen(port: number, hostname?: string, listeningListener?: () => void): NodeServer {
  return serveApp(app.fetch, port, hostname, listeningListener);
}

/**
 * 启动服务。
 *
 * **数据库连不上也要把 HTTP 服务起起来**：这样 `/status` 能告诉你「是数据库挂了」，
 * 而不是只看到进程退出、什么线索都没有。真正的失败由 `/api/v1/status` 返回 503 表达，
 * 业务接口在数据库恢复后自动可用（连接池会重建连接）。
 */
async function start() {
  const startedBy = runtime.startedBy ? `（pnpm ${runtime.startedBy}）` : '';
  console.log(`运行模式：${runtime.nodeEnv}${startedBy}`);

  // 生产环境先做配置自检：致命项**拒绝启动**（配错了会静默地不安全或根本用不了），
  // 可疑项只打警告。开发/测试不检查，保持 `pnpm dev` 开箱即用。
  if (runtime.isProduction) {
    const { fatal, warnings } = productionProblems(config.env);
    for (const item of warnings) {
      console.warn(`[生产环境警告] ${item}`);
    }
    if (fatal.length > 0) {
      console.error('生产环境配置检查未通过，拒绝启动：');
      for (const item of fatal) {
        console.error(`  · ${item}`);
      }
      console.error('本机开发请用 pnpm dev（开发模式，不做这些检查）。');
      process.exit(1);
    }
    console.log(
      runtime.statusPageEnabled
        ? '状态页：已按 ENABLE_STATUS_PAGE 打开，请确保外部访问不到'
        : '状态页：已关闭（生产默认；需要时设 ENABLE_STATUS_PAGE=true）',
    );
  }

  const server = listen(PORT, undefined, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    if (runtime.statusPageEnabled) {
      console.log(`状态页：http://localhost:${PORT}/status`);
    }
    console.log(`连通性检查：http://localhost:${PORT}/ping`);
    console.log(`健康检查：http://localhost:${PORT}/health`);
  });

  // 优雅停机：先停接新请求，再收连接池。
  const shutdown = async (signal: string) => {
    console.log(`收到 ${signal} 信号，正在关闭服务器...`);
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (isEntry(import.meta.url)) {
  start();
}

export { app, listen, routes };
