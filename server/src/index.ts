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
 * 服务骨架和全部业务路由都运行在 Hono（`src/server/hono-app.ts`）。因此本文件只做三件事：
 * 解析运行环境、创建 Hono 应用并把服务起起来。
 */

// 运行环境必须在**任何**读取 NODE_ENV 的模块之前定下来（见 config/runtime.ts：
// pnpm start 走生产、pnpm dev 走开发，状态页与启动自检都按它决定）。
import * as runtime from './config/runtime.js';
import { loadProcessConfig } from './config/env.js';
import { isEntry } from './entry.js';

import { createAdaptorServer } from '@hono/node-server';
import { createApp } from './server/hono-app.js';
import { appShellReady, defaultAppRoot } from './server/app-shell.js';
import { defaultJoinRoot, joinSiteMissingMessage, joinSiteReady } from './server/join-site.js';
import { adminIdentity, productionProblems } from './config/production.js';
import { demoAccountsUsingExamplePassword, ensureProductionAdmin } from './config/bootstrap-admin.js';
import { isDatabaseUnavailable } from './domain/errors.js';
import { pool } from './config/pool.js';
import packageJson from '../package.json' with { type: 'json' };

/** @hono/node-server 起的服务：HTTP/1 与 HTTP/2 是这个工具的类型并集，这里按 HTTP/1 用。 */
type NodeServer = ReturnType<typeof createAdaptorServer>;

const config = loadProcessConfig();
const PORT = config.port;

/**
 * 报名站产物在加载时定下来：有 `join.html` 才托管。
 * 测试直接 `listen()` / `createApp()` 时目录可以不存在，不会在 import 时退出。
 */
const joinRoot = defaultJoinRoot();
const joinReady = joinSiteReady(joinRoot);
const appRoot = defaultAppRoot();
const appReady = appShellReady(appRoot);

/** 骨架：公共层、探针、状态页、业务路由、报名站和统一错误处理。 */
const app = createApp({
  corsOrigin: config.corsOrigin,
  logLevel: config.logLevel,
  trustProxy: runtime.trustProxy,
  statusPageEnabled: runtime.statusPageEnabled,
  pingEnabled: runtime.pingEnabled,
  healthEnabled: runtime.healthEnabled,
  serviceVersion: packageJson.version,
  hstsMaxAge: runtime.hstsMaxAge,
  forceHttps: runtime.forceHttps,
  joinRoot: runtime.webEnabled && joinReady ? joinRoot : undefined,
  appRoot: appReady ? appRoot : undefined,
  publicBaseUrl: runtime.publicBaseUrl,
});

/**
 * 起一个 Node 服务跑给定的 `fetch`（`Hono.fetch`）。
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
  if (runtime.webEnabled && !joinReady) {
    console.error(joinSiteMissingMessage(joinRoot));
    process.exit(1);
  }
  if (runtime.isProduction && !appReady) {
    console.warn(
      `应用页面产物缺失：没有找到 ${appRoot} 里的 index.html。已安装的客户端继续用包内页面，热更新暂时不可用。`,
    );
  }

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
    console.log(
      runtime.webEnabled ? '报名站：已按 ENABLE_WEB 打开' : '报名站：已关闭（生产默认；需要时设 ENABLE_WEB=true）',
    );
    console.log(runtime.healthEnabled ? '健康检查：已按 ENABLE_HEALTH 打开' : '健康检查：已关闭（生产默认）');
    try {
      const weak = await demoAccountsUsingExamplePassword(pool);
      if (weak.length > 0) {
        console.error(`生产环境拒绝启动：示例账号仍使用示例密码（${weak.join('、')}）。请删除这些账号。`);
        process.exit(1);
      }
      const admin = adminIdentity(config.env);
      const outcome = await ensureProductionAdmin(pool, admin);
      console.log(
        outcome === 'created' ? `已创建管理员 ${admin.username}` : `管理员 ${admin.username} 已存在，未改动密码`,
      );
    } catch (error: unknown) {
      if (isDatabaseUnavailable(error)) {
        console.warn('数据库暂时不可用，跳过管理员账号检查；服务仍会启动');
      } else {
        const message = error instanceof Error ? error.message : '管理员账号检查失败';
        console.error(`生产环境拒绝启动：${message}`);
        process.exit(1);
      }
    }
  }

  const server = listen(PORT, undefined, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    if (runtime.webEnabled) {
      console.log(`报名站：http://localhost:${PORT}/`);
      if (runtime.publicBaseUrl) console.log(`对外报名站：${runtime.publicBaseUrl}/`);
    }
    if (runtime.statusPageEnabled) console.log(`状态页：http://localhost:${PORT}/status`);
    if (runtime.pingEnabled) console.log(`连通性检查：http://localhost:${PORT}/ping`);
    if (runtime.healthEnabled) console.log(`健康检查：http://localhost:${PORT}/health`);
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

export { app, listen, start };
