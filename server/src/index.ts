/**
 * 展会排期助手后端服务器
 *
 * 与客户端的约定见 server/README.md：
 * - 读取类接口直接返回数据本身（数组或对象）；
 * - 写入类接口返回应用层信封 `{ ok, error, ... }`，业务失败也是 200，页面按 `.ok` 判断；
 * - 认证 / 授权 / 服务器错误用 4xx / 5xx + `{ error }`，前端会当作异常处理；
 * - **数据库连不上/用不了**统一 503（`domain/errors.ts` 的 `isDatabaseUnavailable()`），
 *   不是 500 —— 这是「暂时不可用、可以重试」，也能避免把 pg 的错误原文回给调用方。
 */

// 运行环境必须在**任何**读取 NODE_ENV 的模块之前定下来（见 config/runtime.ts：
// pnpm start 走生产、pnpm dev 走开发，状态页与启动自检都按它决定）。
import * as runtime from './config/runtime.js';
import { loadProcessConfig } from './config/env.js';
import { isEntry } from './entry.js';

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { pool } from './config/pool.js';
import { productionProblems } from './config/production.js';
import { ApiError, isDatabaseUnavailable } from './domain/errors.js';
import packageJson from '../package.json' with { type: 'json' };
import { routes } from './routes/registry.js';
import statusRoutes from './routes/status.js';

const config = loadProcessConfig();
const app = express();
const PORT = config.port;
const LOG_LEVEL = config.logLevel;
const SERVICE_VERSION = packageJson.version;

// 不广播技术栈（一行成本的信息收敛）。
app.disable('x-powered-by');

// 反向代理后面必须显式声明：不设的话 `req.ip` 是代理地址，按 IP 的验证码限流会
// 退化成「全体用户共用一个 1 小时 20 条」的额度；反过来在直连场景开着它，
// 客户端就能伪造 X-Forwarded-For 绕过限流 —— 所以由部署的人用 TRUST_PROXY 声明。
if (runtime.trustProxy !== false) {
  app.set('trust proxy', runtime.trustProxy);
}

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: false,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志：LOG_LEVEL=quiet 可关掉，测试与联调时更清爽。
if (LOG_LEVEL !== 'quiet') {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
}

// ── 路由 ────────────────────────────────────────────────────────
// 路径与前端 `js/core/api.js` 的 api 域一一对应（见 README「前后端边界」）。
for (const [prefix, router] of Object.entries(routes)) {
  app.use(`/api/v1${prefix ? `/${prefix}` : ''}`, router);
}

// 状态页：人读的 HTML（/status）与机器读的 JSON（/api/v1/status）共用一份探测逻辑。
// 它**不进上面的 `routes` 动作表** —— 那张表是「前端动作 ↔ 后端路由」的对照，
// 状态接口没有对应的前端动作，登记进去会让覆盖断言失真。
//
// **生产环境默认关闭**：这两个接口会暴露迁移清单、各表行数、接口清单，失败时还带 pg 的
// 错误原文，属于运维排查入口而不是公开接口。需要时用 `ENABLE_STATUS_PAGE=true` 显式打开，
// 并由反向代理做来源限制（见 `docs/deployment.md` 的「上线部署清单与开销」）。
if (runtime.statusPageEnabled) {
  app.use('/api/v1/status', statusRoutes);
  app.use('/status', statusRoutes);
} else {
  const disabled = (_req: Request, res: Response) =>
    res.status(404).json({
      error: '状态页在生产环境已关闭（需要时设 ENABLE_STATUS_PAGE=true 再启动）',
    });
  app.get(['/status', '/api/v1/status'], disabled);
}

/**
 * 进程存活探针（**不代表数据库可用**）：只回答「HTTP 服务还在不在」。
 * 想连库一起看用 `/api/v1/status`（库挂时 503）。
 */
app.get(['/ping', '/api/v1/ping'], (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'calmobile-server', version: SERVICE_VERSION });
});

/** 与 /ping 同义的存活探针；数据库连通性看 /api/v1/status。 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// 404：路径不存在（不是「资源不存在」，那种情况由各路由给 404 + error）
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `路径 ${req.originalUrl} 不存在` });
});

/** body-parser 之类中间件的错误自带 4xx 状态码；这里给出对外文案，不回显原文。 */
const MIDDLEWARE_MESSAGES: Record<string, string> = {
  'entity.parse.failed': '请求体不是合法的 JSON',
  'entity.too.large': '请求体超过大小上限',
  'encoding.unsupported': '不支持的请求体编码',
  'request.aborted': '请求被中断',
};

interface RaisedError {
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

/** 错误 → HTTP 状态码：ApiError 自带 > 中间件自带的 4xx > 数据库不可用 503 > 500。 */
function statusFor(err: unknown): number {
  if (err instanceof ApiError) {
    return err.status;
  }
  const record = err as RaisedError;
  const declared = Number(record.status || record.statusCode);
  if (Number.isInteger(declared) && declared >= 400 && declared < 500) {
    return declared;
  }
  return isDatabaseUnavailable(err) ? 503 : 500;
}

/**
 * 错误 → 给客户端的文案。
 *
 * 只有 ApiError 的文案是写给用户看的；其余一律换成固定文案：
 * pg 的连接错误里有内网 host:port、解析错误里有请求体片段，都不该回给调用方
 * （排查用的原文与堆栈只进服务端日志）。
 */
function clientMessage(err: unknown, status: number): string {
  if (err instanceof ApiError) {
    return err.message || '请求失败';
  }
  const record = err as RaisedError;
  const message = record.type ? MIDDLEWARE_MESSAGES[record.type] : undefined;
  if (message) {
    return message;
  }
  if (status === 503) {
    return '数据库暂时不可用，请稍后重试';
  }
  return status < 500 ? '请求不合法' : '服务器内部错误';
}

// 统一错误处理：状态码按上面的优先级，正文只有 `{ error }`，堆栈始终只进日志。
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = statusFor(err);
  console.error(`请求失败（${status}）：`, err);
  res.status(status).json({ error: clientMessage(err, status) });
});

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

  try {
    const client = await pool.connect();
    client.release();
    console.log('数据库连接成功');
  } catch (error: unknown) {
    console.error(
      runtime.statusPageEnabled
        ? '数据库暂时不可用，服务仍会启动；打开 /status 查看原因：'
        : '数据库暂时不可用，服务仍会启动（生产环境状态页已关闭，请看日志）：',
      (error as { message?: string }).message,
    );
  }
  return app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    if (runtime.statusPageEnabled) {
      console.log(`状态页：http://localhost:${PORT}/status`);
    }
    console.log(`连通性检查：http://localhost:${PORT}/ping`);
    console.log(`健康检查：http://localhost:${PORT}/health`);
  });
}

async function shutdown(signal: string) {
  console.log(`收到 ${signal} 信号，正在关闭服务器...`);
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (isEntry(import.meta.url)) {
  start();
}

export { app, start, routes };
