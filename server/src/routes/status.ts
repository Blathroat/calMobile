/**
 * status：后端与数据库的健康报告。
 *
 * 同一个路由器挂两次，共用这份探测逻辑：
 * - `GET /api/v1/status` → 机器读的 JSON：`ok` 为真给 200，否则 503（探活脚本按状态码判断）；
 * - `GET /status`        → 人读的 HTML（见 `src/status-page.ts`）：永远 200，
 *   数据库挂了也必须打得开并把失败原因写在页面上。
 *
 * 三条自我约束：
 * 1. **不抛异常**：数据库挂了要给 `ok:false` + 错误原文，而不是 500 —— 探针自己炸了就没法排查；
 * 2. **不编数据**：每一项都来自真实测量（SQL、进程信息、环境变量），自检项失败必须指得到出处；
 * 3. **不固化清单**：`endpoints` 直接遍历 `routes/registry.ts` 的路由注册表
 *    （与 `src/test/api.test.ts` 的 `backendRoutes()` 同一套走法），新增路由不会漏登记。
 */

import express from 'express';
import type { Request, Response, NextFunction, Router } from 'express';
import { pool } from '../config/pool.js';
import { STEPS } from '../config/migrate.js';
import * as databaseConfig from '../config/database.js';
import { loadProcessConfig } from '../config/env.js';
import { MIN_SECRET_LENGTH, PLACEHOLDER_SECRET } from '../config/auth.js';
import { mailConfig, describeMailConfig } from '../config/mail.js';
import { renderStatusPage } from '../status-page.js';
import { routes } from './registry.js';
import packageJson from '../../package.json' with { type: 'json' };

const router = express.Router();

/** 服务标识与 `/ping` 保持一致。 */
const SERVICE_NAME = 'calmobile-server';
const SERVICE_VERSION = packageJson.version;

/** 数据量卡片统计的表，固定白名单（表名直接拼进 SQL，不接受外部输入）。 */
const COUNT_TABLES = ['users', 'exhibitions', 'registrations', 'exhibition_fields', 'app_settings'];

/** 自检项的通用超时（毫秒）：探测不能把状态页拖住。 */
const PROBE_TIMEOUT_MS = 4000;

interface PoolSnapshot {
  total: number;
  idle: number;
  waiting: number;
}

interface DatabaseStatus {
  connected: boolean;
  latencyMs: number | null;
  version: string;
  database: string;
  host: string;
  pool: PoolSnapshot;
  error?: string;
}

interface AppliedMigration {
  id: unknown;
  appliedAt: string;
}

interface MigrationStatus {
  applied: AppliedMigration[];
  pending: string[];
  error?: string;
}

interface CheckItem {
  name: string;
  status: 'ok' | 'fail';
  detail: string;
  ms: number;
}

interface ServiceStatus {
  name: string;
  version: string;
  node: string;
  uptimeSec: number;
  startedAt: string;
  timeZone: string;
  now: string;
}

interface Endpoint {
  method: string;
  path: string;
}

/** express 的 `stack` 是内部结构，`@types/express` 没导出它（`IRoute` 也不带 `methods`）。 */
interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** `router.stack`：只读一条路由的 path 与其方法表（见 `routeInventory`）。 */
function routerLayers(router: Router): RouteLayer[] {
  return (router as unknown as { stack?: RouteLayer[] }).stack || [];
}

interface Report {
  ok: boolean;
  service: ServiceStatus;
  database: DatabaseStatus;
  migrations: MigrationStatus;
  data: Record<string, number | null>;
  endpoints: Endpoint[];
  checks: CheckItem[];
}

interface CheckInput {
  database: DatabaseStatus;
  databaseMs: number;
  migrations: MigrationStatus;
  migrationsMs: number;
  counts: Record<string, number | null>;
  countsMs: number;
}

type ProbeRow = { [column: string]: unknown };

function safeMessage(error: unknown): string {
  if (!error) {
    return '未知错误';
  }
  return String((error as { message?: unknown }).message || error);
}

/** 高精度计时，结果保留两位小数。 */
function elapsedMs(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
}

/** 连接池现状（`pg` 的 Pool 自带 totalCount / idleCount / waitingCount）。 */
function poolStats(): PoolSnapshot {
  return {
    total: Number(pool.totalCount) || 0,
    idle: Number(pool.idleCount) || 0,
    waiting: Number(pool.waitingCount) || 0,
  };
}

/** 服务时区：`Intl` 拿不到时退回 UTC，保证 `now` 永远能格式化。 */
function serviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * 探测专用查询：超时**销毁这条连接**，而不是只放弃 promise。
 *
 * `pool.query()` 只在查询 settle 时才把连接还给池；数据库「能握手但不回结果」时，
 * 单靠 `Promise.race` 会让卡住的连接一直占着池（20 条之后连业务接口都拿不到连接，
 * 状态页就成了故障放大器）。因此这里显式 `connect()`，超时用 `release(true)` 销毁连接。
 */
function probeQuery(label: string, text: string, params?: unknown[]): Promise<import('pg').QueryResult<ProbeRow>> {
  return new Promise((resolve, reject) => {
    // 拿不到连接（池满 / 建连超时）由 pool 自己的 connectionTimeoutMillis 兜底。
    pool.connect().then((client) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        client.release(true); // 销毁：这条连接已经不可信，不能还给池
        reject(new Error(`${label}超时（${PROBE_TIMEOUT_MS} ms 没有响应）`));
      }, PROBE_TIMEOUT_MS);
      client.query<ProbeRow>(text, params).then(
        (result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          client.release();
          resolve(result);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          client.release();
          reject(error);
        },
      );
    }, reject);
  });
}

/** 各表行数；数据库不可用时直接给 null，而不是逐表各等一次超时。 */
function emptyCounts(): Record<string, number | null> {
  const counts: Record<string, number | null> = {};
  for (const table of COUNT_TABLES) {
    counts[table] = null;
  }
  return counts;
}

/**
 * 数据库探测：两条真查询（`select version()` + `select 1`），失败时把错误原文带出去。
 *
 * 返回 `{ info, ms }`：`info.latencyMs` 只在连通时才有（真实往返时间），
 * `ms` 是这次探测本身花掉的时间（失败时也算，自检项要显示「等了多久才失败」）。
 *
 * 连接地址连上时用服务端自报的（`inet_server_addr()`），连不上时用配置里的目标地址 ——
 * 排查时要知道刚才连的是哪儿。
 */
async function probeDatabase(): Promise<{ info: DatabaseStatus; ms: number }> {
  const startedAt = process.hrtime.bigint();
  const info: DatabaseStatus = {
    connected: false,
    latencyMs: null,
    version: '',
    database: '',
    host: '',
    pool: poolStats(),
  };
  try {
    const result = await probeQuery(
      '数据库查询',
      `
            SELECT version() AS version,
                   current_database() AS database,
                   coalesce(host(inet_server_addr()), 'local') AS host,
                   coalesce(inet_server_port(), 0) AS port
        `,
    );
    // 第二条查询确认连接真的能来回，而不是只握了个手。
    await probeQuery('数据库查询', 'SELECT 1 AS ping');
    const row = result.rows[0]!;
    info.connected = true;
    info.latencyMs = elapsedMs(startedAt);
    info.version = String(row.version || '');
    info.database = String(row.database || '');
    info.host = row.port ? `${row.host}:${row.port}` : String(row.host || '');
  } catch (error: unknown) {
    info.error = safeMessage(error);
    info.host = `${databaseConfig.host}:${databaseConfig.port}`;
  }
  // 连接池计数放在探测之后读：正好反映这次探测留下的连接状况。
  info.pool = poolStats();
  return { info, ms: elapsedMs(startedAt) };
}

/**
 * 迁移探测：拿 `schema_migrations` 与 `STEPS` 对比。
 * 表不存在（数据库刚建、还没跑过迁移）时视为「全部未应用」，而不是抛错。
 */
async function probeMigrations(database: DatabaseStatus): Promise<{ report: MigrationStatus; ms: number }> {
  const all = STEPS.map((step) => step.id);
  if (!database.connected) {
    return {
      report: { applied: [], pending: all, error: `数据库不可用：${database.error || '未连接'}` },
      ms: 0,
    };
  }
  const startedAt = process.hrtime.bigint();
  try {
    const result = await probeQuery('迁移查询', 'SELECT id, applied_at FROM schema_migrations ORDER BY applied_at, id');
    const appliedIds = new Set(result.rows.map((row) => row.id));
    return {
      report: {
        applied: result.rows.map((row) => ({
          id: row.id,
          appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
        })),
        pending: all.filter((id) => !appliedIds.has(id)),
      },
      ms: elapsedMs(startedAt),
    };
  } catch (error: unknown) {
    // 表还不存在时错误是 `relation "schema_migrations" does not exist`，正好说明一步都没跑。
    return {
      report: { applied: [], pending: all, error: safeMessage(error) },
      ms: elapsedMs(startedAt),
    };
  }
}

/** 逐表取行数；某张表读不到时那一项给 null，不影响其它表。 */
async function probeCounts(database: DatabaseStatus): Promise<{ counts: Record<string, number | null>; ms: number }> {
  const counts = emptyCounts();
  if (!database.connected) {
    return { counts, ms: 0 };
  }
  const startedAt = process.hrtime.bigint();
  for (const table of COUNT_TABLES) {
    try {
      const result = await probeQuery('行数统计', `SELECT count(*)::int AS total FROM ${table}`);
      counts[table] = Number(result.rows[0]!.total);
    } catch {
      counts[table] = null;
    }
  }
  return { counts, ms: elapsedMs(startedAt) };
}

/**
 * 接口清单：遍历路由注册表 `routes/registry.ts`，把每个 router 的 `stack` 拼上挂载前缀，
 * 与 `src/test/api.test.ts` 的 `backendRoutes()` 完全同源，因此清单不会和真实路由漂移。
 *
 * 注册表是独立模块，所以这里能直接静态 import：从前要靠「延迟 require 入口」绕开的
 * 循环依赖（入口要装载状态路由，状态路由又要读入口的路由表）已经不存在。
 */
function routeInventory(): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const [prefix, mountedRouter] of Object.entries(routes)) {
    const base = `/api/v1${prefix ? `/${prefix}` : ''}`;
    for (const layer of routerLayers(mountedRouter)) {
      if (!layer.route) {
        continue;
      }
      const full = `${base}${layer.route.path === '/' ? '' : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({ method: method.toUpperCase(), path: full });
      }
    }
  }
  return endpoints.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

/**
 * 自检项：每一条都必须来自真实测量。
 *
 * `probe` 返回一句说明文字，抛错即算失败；`ms` 显式传入时复用前面那次真实探测的耗时
 * （例如「数据库连通」用整次探测的时间），这样页面上的耗时不是凭空写的。
 */
async function runChecks({
  database,
  databaseMs,
  migrations,
  migrationsMs,
  counts,
  countsMs,
}: CheckInput): Promise<CheckItem[]> {
  const checks: CheckItem[] = [];

  const run = async (name: string, probe: () => string | Promise<string>, ms?: number | null): Promise<void> => {
    const startedAt = process.hrtime.bigint();
    // 探测已经量过一次的，用那次结果；没有量到的（null / undefined / NaN）就用本段自己的耗时。
    const measured = ms === null || ms === undefined || !Number.isFinite(Number(ms)) ? null : Number(ms);
    try {
      const detail = await probe();
      checks.push({ name, status: 'ok', detail, ms: measured === null ? elapsedMs(startedAt) : measured });
    } catch (error: unknown) {
      checks.push({
        name,
        status: 'fail',
        detail: safeMessage(error),
        ms: measured === null ? elapsedMs(startedAt) : measured,
      });
    }
  };

  // 进程配置在入口处解析过一次（`loadProcessConfig` 缺密钥时就炸），这里只读它的结果。
  const processAuth = loadProcessConfig().auth;

  await run('认证密钥', () => {
    // 两个密钥都要存在、够长、且不是占位值 —— 这些在解析配置时就校验过了。
    return `JWT_SECRET / JWT_REFRESH_SECRET 均已配置（≥ ${MIN_SECRET_LENGTH} 字符，access ${processAuth.accessExpiresIn} / refresh ${processAuth.refreshExpiresIn}）`;
  });

  await run('JWT 密钥不是占位值', () => {
    const placeholders = [
      PLACEHOLDER_SECRET.test(processAuth.accessSecret) ? 'JWT_SECRET' : '',
      PLACEHOLDER_SECRET.test(processAuth.refreshSecret) ? 'JWT_REFRESH_SECRET' : '',
    ].filter(Boolean);
    if (placeholders.length > 0) {
      throw new Error(`${placeholders.join(' / ')} 还是 your_ / replace-with / change-me 之类的占位值`);
    }
    return '两个密钥都不是模板里的占位值';
  });

  /**
   * 邮件通道：验证码靠它出去，配错了用户就卡在注册页 —— 所以要在状态页上一眼看到。
   *
   * 这里**不做实时 SMTP 握手**（`transporter.verify()`）：那会让状态页的可用性取决于
   * 邮件服务商，而且多数中继对 verify 有频率限制。改成「配置是否完整」+
   * 「最近 24 小时的发信失败数」（读 `mail_log`），既真实又不会把状态页拖住。
   */
  await run('邮件通道', async () => {
    const mail = describeMailConfig(mailConfig);
    if (!mail.configured) {
      throw new Error(mail.problems.join('；'));
    }
    const where =
      mail.transport === 'smtp'
        ? `SMTP ${mail.smtpHost}:${mail.smtpPort}${mail.smtpSecure ? '（隐式 TLS）' : ''}` +
          `${mail.smtpAuth ? ' + 认证' : ''}，发件人 ${mail.fromAddress}`
        : `${mail.transport}（${mail.transport === 'console' ? '邮件只写日志，未真正发送' : '仅测试用'}）`;

    if (!database.connected) {
      return `${where}；数据库不可用，这次统计不了发信失败`;
    }
    let failed = 0;
    try {
      const result = await probeQuery(
        '发信统计',
        `
                SELECT count(*)::int AS total FROM mail_log
                 WHERE status = 'failed' AND created_at > now() - interval '24 hours'
            `,
      );
      failed = Number(result.rows[0]!.total);
    } catch (error: unknown) {
      throw new Error(`${where}；mail_log 读不到（迁移 0004 没跑？）：${safeMessage(error)}`);
    }
    if (failed > 0) {
      throw new Error(`${where}；最近 24 小时有 ${failed} 封发送失败，明细见 mail_log`);
    }
    return `${where}；最近 24 小时无发送失败`;
  });

  await run(
    '数据库连通',
    () => {
      if (!database.connected) {
        throw new Error(database.error || '数据库没有应答');
      }
      const version = (String(database.version || '').split(' on ')[0] || '').trim();
      return `${version || 'PostgreSQL'} 应答正常，往返 ${database.latencyMs} ms`;
    },
    databaseMs,
  );

  await run(
    '迁移无遗漏',
    () => {
      if (migrations.error) {
        throw new Error(migrations.error);
      }
      if (migrations.pending.length > 0) {
        throw new Error(`还有 ${migrations.pending.length} 项未应用：${migrations.pending.join('、')}`);
      }
      return `${migrations.applied.length} 项迁移全部已应用`;
    },
    migrationsMs,
  );

  await run('至少一个可登录账号', async () => {
    if (!database.connected) {
      throw new Error(`数据库不可用，统计不了账号：${database.error || '未连接'}`);
    }
    const result = await probeQuery('账号统计', "SELECT count(*)::int AS total FROM users WHERE status = 'active'");
    const total = Number(result.rows[0]!.total);
    if (total < 1) {
      throw new Error("没有 status='active' 的账号，谁都登录不了");
    }
    return `status='active' 的账号 ${total} 个`;
  });

  await run(
    '至少一场展会',
    () => {
      const total = counts.exhibitions;
      if (total === null || total === undefined) {
        throw new Error(`数据库不可用，统计不了展会：${database.error || '未连接'}`);
      }
      if (total < 1) {
        throw new Error('一场展会都没有，前端列表会是空的');
      }
      return `展会 ${total} 场`;
    },
    countsMs,
  );

  return checks;
}

function serviceBlock(): ServiceStatus {
  const now = new Date();
  const uptimeSec = Math.round(process.uptime());
  return {
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    node: process.version,
    uptimeSec,
    startedAt: new Date(now.getTime() - uptimeSec * 1000).toISOString(),
    timeZone: serviceTimeZone(),
    now: now.toISOString(),
  };
}

/**
 * 组装报告。`ok` 只表达「服务活着 + 数据库答得上」——迁移与自检的问题在 `checks` 里逐项说明，
 * 不混进状态码，否则探活脚本分不清「数据库没了」和「只是有一步迁移没跑」。
 */
async function buildReport(): Promise<Report> {
  const service = serviceBlock();
  const { info: database, ms: databaseMs } = await probeDatabase();
  const { counts, ms: countsMs } = await probeCounts(database);
  const migrations = await probeMigrations(database);
  const checks = await runChecks({
    database,
    databaseMs,
    migrations: migrations.report,
    migrationsMs: migrations.ms,
    counts,
    countsMs,
  });

  let endpoints: Endpoint[] = [];
  try {
    endpoints = routeInventory();
  } catch (error: unknown) {
    // 清单读不到不该让整份报告失败，但要在日志里留下痕迹。
    console.error('接口清单读取失败：', error);
  }

  return {
    ok: database.connected,
    service,
    database,
    migrations: migrations.report,
    data: counts,
    endpoints,
    checks,
  };
}

/**
 * 同一时刻只跑一次探测：多个标签页、探活脚本与 HTML 页面并发时共用同一份结果。
 *
 * 这里**不做 TTL 缓存**（每个请求拿到的都是刚测出来的数据），只是把「同时发生的
 * 多次探测」合并成一次，避免并发请求把库和连接池一起打满。
 */
let inFlightReport: Promise<Report> | null = null;

function reportOnce(): Promise<Report> {
  if (!inFlightReport) {
    inFlightReport = buildReport().finally(() => {
      inFlightReport = null;
    });
  }
  return inFlightReport;
}

/** 最后的兜底：连探测本身都炸了，也要给出一份结构完整的报告，页面才渲染得出来。 */
function fallbackReport(error: unknown): Report {
  const message = safeMessage(error);
  return {
    ok: false,
    service: serviceBlock(),
    database: {
      connected: false,
      latencyMs: null,
      version: '',
      database: '',
      host: '',
      pool: poolStats(),
      error: message,
    },
    migrations: { applied: [], pending: STEPS.map((step) => step.id), error: message },
    data: emptyCounts(),
    endpoints: [],
    checks: [{ name: '健康报告', status: 'fail', detail: message, ms: 0 }],
  };
}

/**
 * 状态页渲染失败的兜底：宁可给一页纯文本，也不要让唯一的排查入口变成 500。
 */
function fallbackHtml(error: unknown): string {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>状态页渲染失败</title></head>' +
    '<body style="font:16px/1.6 system-ui,sans-serif;padding:24px">' +
    '<h1>状态页渲染失败</h1><p>后端进程还活着，但状态页自身的模板出错了。</p>' +
    `<pre style="white-space:pre-wrap">${String(safeMessage(error)).replace(/[<>&]/g, '')}</pre>` +
    '<p><a href="/api/v1/status">查看 JSON 报告</a></p></body></html>'
  );
}

// 状态数据永远要新鲜：探活脚本和页面都不能拿到缓存的旧结果（并发合并见 reportOnce）。
router.use((req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * `GET /api/v1/status` → JSON（200 / 503）；`GET /status` → HTML（200）。
 * 用 `req.baseUrl` 区分两个挂载点，避免把探测逻辑写两遍。
 */
router.get('/', async (req: Request, res: Response) => {
  let report: Report;
  try {
    report = await reportOnce();
  } catch (error: unknown) {
    console.error('健康报告生成失败：', error);
    report = fallbackReport(error);
  }

  if (req.baseUrl === '/status') {
    try {
      res.type('html').send(renderStatusPage(report));
    } catch (error: unknown) {
      console.error('状态页渲染失败：', error);
      res.type('html').send(fallbackHtml(error));
    }
    return;
  }
  res.status(report.ok ? 200 : 503).json(report);
});

export default router;
