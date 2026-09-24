/**
 * status：后端与数据库的健康报告。
 *
 * 同一份报告逻辑服务两个 Hono 路径：
 * - `GET /api/v1/status` → 机器读的 JSON：`ok` 为真给 200，否则 503（探活脚本按状态码判断）；
 * - `GET /status`        → 人读的 HTML（见 `src/status-page.ts`）：永远 200，
 *   数据库挂了也必须打得开并显示通用失败提示。
 *
 * 三条自我约束：
 * 1. **不抛异常**：数据库挂了要给 `ok:false` + 通用错误提示，而不是 500 —— 探针自己炸了就没法排查；
 * 2. **不编数据**：每一项都来自真实测量（SQL、进程信息、环境变量），自检项失败必须指得到出处；
 * 3. **不固化清单**：`endpoints` 直接读取 Hono 应用的真实注册表
 *    （与 `src/test/api.test.ts` 的 `backendRoutes()` 同一套来源），新增路由不会漏登记。
 */

import { pool } from '../config/pool.js';
import { STEPS } from '../config/migrate.js';
import { loadProcessConfig } from '../config/env.js';
import { MIN_SECRET_LENGTH, PLACEHOLDER_SECRET } from '../config/auth.js';
import { mailConfig, describeMailConfig } from '../config/mail.js';
import packageJson from '../../package.json' with { type: 'json' };

/** 服务标识与 `/ping` 保持一致。 */
const SERVICE_NAME = 'calmobile-server';
const SERVICE_VERSION = packageJson.version;

/** 数据量卡片统计的表，固定白名单（表名直接拼进 SQL，不接受外部输入）。 */
const COUNT_TABLES = ['users', 'exhibitions', 'registrations', 'exhibition_fields', 'app_settings'];

/** 自检项的通用超时（毫秒）：探测不能把状态页拖住。 */
const PROBE_TIMEOUT_MS = 4000;

/** 紧邻的状态请求共用一份报告，避免多个标签页同时打满连接池。 */
const STATUS_REPORT_TTL_MS = 1500;

/** 对外状态响应不携带 pg、SQL 或堆栈原文；详细原因只写服务端日志。 */
const DATABASE_ERROR_MESSAGE = '数据库暂时不可用，请查看服务端日志';
const MIGRATION_ERROR_MESSAGE = '迁移状态暂时不可用，请查看服务端日志';
const CHECK_ERROR_MESSAGE = '检查失败，请查看服务端日志';

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

interface RegisteredRoute {
  method: string;
  path: string;
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

/** 自检主动发现的业务问题可以展示；未知异常一律改成通用提示。 */
class PublicCheckFailure extends Error {}

function checkFailure(message: string): PublicCheckFailure {
  return new PublicCheckFailure(message);
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
 * 数据库探测：两条真查询（`select version()` + `select 1`），失败时记录原始错误，
 * 对外只返回通用提示。
 *
 * 返回 `{ info, ms }`：`info.latencyMs` 只在连通时才有（真实往返时间），
 * `ms` 是这次探测本身花掉的时间（失败时也算，自检项要显示「等了多久才失败」）。
 *
 * 连接成功时用服务端自报的（`inet_server_addr()`）；连接失败时不回传配置里的目标地址，
 * 避免状态页泄露内网 host:port。
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
    console.error('数据库探测失败：', error);
    info.error = DATABASE_ERROR_MESSAGE;
    // 连接失败时不把配置里的内网 host:port 回传给状态页。
    info.host = '';
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
      report: { applied: [], pending: all, error: DATABASE_ERROR_MESSAGE },
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
    console.error('迁移探测失败：', error);
    return {
      report: { applied: [], pending: all, error: MIGRATION_ERROR_MESSAGE },
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

/** 接口清单直接从 Hono 实际注册表读取，契约测试也使用同一份注册表。 */
function routeInventory(routes: readonly RegisteredRoute[]): Endpoint[] {
  const endpoints = routes
    .filter(
      ({ method, path }) =>
        method !== 'ALL' && path.startsWith('/api/v1/') && path !== '/api/v1/ping' && path !== '/api/v1/status',
    )
    .map(({ method, path }) => ({ method, path }));
  const unique = new Map(endpoints.map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint]));
  return [...unique.values()].sort((a, b) =>
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
      if (!(error instanceof PublicCheckFailure)) {
        console.error(`状态检查失败（${name}）：`, error);
      }
      checks.push({
        name,
        status: 'fail',
        detail: error instanceof PublicCheckFailure ? error.message : CHECK_ERROR_MESSAGE,
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
      throw checkFailure(`${placeholders.join(' / ')} 还是 your_ / replace-with / change-me 之类的占位值`);
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
      throw checkFailure(mail.problems.join('；'));
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
      console.error('发信失败统计读取失败：', error);
      throw checkFailure(`${where}；最近 24 小时的发信失败统计暂时不可用`);
    }
    if (failed > 0) {
      throw checkFailure(`${where}；最近 24 小时有 ${failed} 封发送失败，明细见 mail_log`);
    }
    return `${where}；最近 24 小时无发送失败`;
  });

  await run(
    '数据库连通',
    () => {
      if (!database.connected) {
        throw checkFailure(DATABASE_ERROR_MESSAGE);
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
        throw checkFailure(migrations.error);
      }
      if (migrations.pending.length > 0) {
        throw checkFailure(`还有 ${migrations.pending.length} 项未应用：${migrations.pending.join('、')}`);
      }
      return `${migrations.applied.length} 项迁移全部已应用`;
    },
    migrationsMs,
  );

  await run('至少一个可登录账号', async () => {
    if (!database.connected) {
      throw checkFailure(DATABASE_ERROR_MESSAGE);
    }
    const result = await probeQuery('账号统计', "SELECT count(*)::int AS total FROM users WHERE status = 'active'");
    const total = Number(result.rows[0]!.total);
    if (total < 1) {
      throw checkFailure("没有 status='active' 的账号，谁都登录不了");
    }
    return `status='active' 的账号 ${total} 个`;
  });

  await run(
    '至少一场展会',
    () => {
      const total = counts.exhibitions;
      if (total === null || total === undefined) {
        throw checkFailure(DATABASE_ERROR_MESSAGE);
      }
      if (total < 1) {
        throw checkFailure('一场展会都没有，前端列表会是空的');
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
async function buildReport(routes: readonly RegisteredRoute[]): Promise<Report> {
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
    endpoints = routeInventory(routes);
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
 * 紧邻请求再复用一份 1.5 秒报告，避免页面每 5 秒刷新时被多个客户端同时触发重复查询。
 */
let inFlightReport: Promise<Report> | null = null;
let cachedReport: { report: Report; expiresAt: number } | null = null;

function reportOnce(routes: readonly RegisteredRoute[]): Promise<Report> {
  const now = Date.now();
  if (cachedReport && cachedReport.expiresAt > now) {
    return Promise.resolve(cachedReport.report);
  }
  if (!inFlightReport) {
    inFlightReport = buildReport(routes)
      .then((report) => {
        cachedReport = { report, expiresAt: Date.now() + STATUS_REPORT_TTL_MS };
        return report;
      })
      .finally(() => {
        inFlightReport = null;
      });
  }
  return inFlightReport;
}

/** 状态页 HTML 与 JSON 共用同一份报告生成逻辑。 */
export async function readStatusReport(routes: readonly RegisteredRoute[]): Promise<Report> {
  try {
    return await reportOnce(routes);
  } catch (error: unknown) {
    console.error('健康报告生成失败：', error);
    return fallbackReport();
  }
}

/** 最后的兜底：连探测本身都炸了，也要给出一份结构完整的报告，页面才渲染得出来。 */
function fallbackReport(): Report {
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
      error: DATABASE_ERROR_MESSAGE,
    },
    migrations: { applied: [], pending: STEPS.map((step) => step.id), error: MIGRATION_ERROR_MESSAGE },
    data: emptyCounts(),
    endpoints: [],
    checks: [{ name: '健康报告', status: 'fail', detail: CHECK_ERROR_MESSAGE, ms: 0 }],
  };
}
