/**
 * 操作日志：写入、按大小上限清理、读取与请求埋点。
 *
 * 设计取舍：
 * - **只记录「谁对什么做了什么」这类审计信息**：变更类接口（POST/PUT/DELETE）、失败请求
 *   （4xx/5xx）以及登录/两步验证结果。读接口成功不记，避免把日志表变成访问流水。
 * - **不记请求体**：登录、改密码等会带敏感数据；只留方法、路径、状态码、耗时、操作人与 IP。
 * - **失败不影响业务**：写日志是旁路，任何异常都只写服务端控制台，绝不让正常请求 500。
 * - **大小上限**：写入时算好 `size_bytes`；超过 `app_settings.logs.storageMb` 时删最早的，
 *   清理节流到每 30 秒一次，管理员把上限调小时再立刻清一次（见 `settings-hono`）。
 */

import { Buffer } from 'node:buffer';
import type { Context, MiddlewareHandler } from 'hono';
import { query } from '../config/pool.js';
import { DEFAULT_SETTINGS } from '../config/migrate.js';
import { normalizeLogs } from '../domain/settings.js';
import type { TrustProxy } from '../config/runtime.js';
import { clientIp, ensureTrustProxy } from '../http/client-ip.js';
import type { AuthedUser } from '../middleware/auth.js';
import type { NodeEnv } from '../server/node-middleware.js';
import type { HonoEnv } from '../routes/hono-utils.js';

export type LogLevel = 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error'];

export interface LogEntry {
  id: string;
  level: LogLevel;
  category: string;
  message: string;
  actorId: string;
  actorName: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string;
  createdAt: string;
}

interface LogRow {
  id: string | number;
  level: string;
  category: string;
  message: string;
  actor_id: string | null;
  actor_name: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  duration_ms: number | null;
  ip: string | null;
  created_at: Date | string;
}

export interface WriteLogInput {
  level: LogLevel;
  category: string;
  message: string;
  actorId?: string;
  actorName?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  ip?: string;
}

/** 每行除可见字段外的固定开销（id、时间戳、JSONB 包装等），用于大小估算。 */
const ROW_OVERHEAD_BYTES = 64;
/** 清理节流：正常写入每 30 秒最多检查一次上限。 */
const PRUNE_INTERVAL_MS = 30_000;
let lastPruneAt = 0;

function textSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function logSize(input: WriteLogInput): number {
  return (
    textSize(input.level) +
    textSize(input.category) +
    textSize(input.message) +
    textSize(input.actorName ?? '') +
    textSize(input.method ?? '') +
    textSize(input.path ?? '') +
    textSize(input.ip ?? '') +
    ROW_OVERHEAD_BYTES
  );
}

/** 写一条日志；失败只打控制台，不影响正在处理的请求。 */
export async function writeLog(input: WriteLogInput): Promise<void> {
  try {
    await query(
      `INSERT INTO app_logs
          (level, category, message, actor_id, actor_name, method, path, status, duration_ms, ip, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.level,
        input.category.slice(0, 60),
        input.message.slice(0, 500),
        input.actorId ?? '',
        (input.actorName ?? '').slice(0, 80),
        (input.method ?? '').slice(0, 10),
        (input.path ?? '').slice(0, 300),
        Math.trunc(input.status ?? 0),
        Math.max(0, Math.trunc(input.durationMs ?? 0)),
        (input.ip ?? '').slice(0, 80),
        logSize(input),
      ],
    );
    void maybePruneLogs();
  } catch (error: unknown) {
    console.error('写操作日志失败：', error instanceof Error ? error.message : String(error));
  }
}

/** 从 `app_settings.logs` 读上限；读不到或非法时退回默认 64 MB。 */
async function readLogLimitBytes(): Promise<number> {
  try {
    const result = await query<{ value: unknown }>(`SELECT value FROM app_settings WHERE key = 'logs'`);
    return normalizeLogs(result.rows[0]?.value).storageMb * 1024 * 1024;
  } catch {
    return DEFAULT_SETTINGS.logs.storageMb * 1024 * 1024;
  }
}

/**
 * 超过上限时删掉最早的日志。
 *
 * `SUM(size_bytes) OVER (ORDER BY created_at DESC, id DESC)` 从最新往回累加，
 * 累计值超过上限的那些行就是「最旧的、该丢的」。一行 SQL 完成，不反复查库。
 */
export async function pruneLogs(): Promise<void> {
  try {
    const limitBytes = await readLogLimitBytes();
    await query(
      `WITH ordered AS (
         SELECT id, SUM(size_bytes) OVER (ORDER BY created_at DESC, id DESC) AS running
           FROM app_logs
       )
       DELETE FROM app_logs WHERE id IN (SELECT id FROM ordered WHERE running > $1)`,
      [limitBytes],
    );
  } catch (error: unknown) {
    console.error('清理操作日志失败：', error instanceof Error ? error.message : String(error));
  }
}

/** 写入后触发清理（节流）：日志表很大时也不让每个请求都跑一遍累计查询。 */
export async function maybePruneLogs(force = false): Promise<void> {
  if (!force && Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = Date.now();
  await pruneLogs();
}

/** 当前日志占用与条数：管理设置卡片与日志页顶部的统计。 */
export async function logsStats(): Promise<{ usedBytes: number; entryCount: number }> {
  const result = await query<{ used: string | number | null; count: string | number | null }>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS used, COUNT(*) AS count FROM app_logs`,
  );
  return {
    usedBytes: Number(result.rows[0]?.used ?? 0),
    entryCount: Number(result.rows[0]?.count ?? 0),
  };
}

/** 转义 ILIKE 的通配符：用户输入里的 % 和 _ 按字面匹配。 */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** 按条件读最近日志：按时间倒序，最多 `limit` 条。 */
export async function readLogs(options: { limit: number; level?: string; query?: string }): Promise<LogEntry[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.level) {
    params.push(options.level);
    clauses.push(`level = $${params.length}`);
  }
  if (options.query) {
    params.push(likePattern(options.query));
    clauses.push(
      `(message ILIKE $${params.length} ESCAPE '\\' OR category ILIKE $${params.length} ESCAPE '\\' OR actor_name ILIKE $${params.length} ESCAPE '\\' OR path ILIKE $${params.length} ESCAPE '\\')`,
    );
  }
  params.push(options.limit);
  const result = await query<LogRow>(
    `SELECT id, level, category, message, actor_id, actor_name, method, path, status, duration_ms, ip, created_at
       FROM app_logs
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    level: LOG_LEVELS.includes(row.level as LogLevel) ? (row.level as LogLevel) : 'info',
    category: row.category || '',
    message: row.message || '',
    actorId: row.actor_id || '',
    actorName: row.actor_name || '',
    method: row.method || '',
    path: row.path || '',
    status: Number(row.status) || 0,
    durationMs: Number(row.duration_ms) || 0,
    ip: row.ip || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
  }));
}

/** 登录类路径 → 动作名，用于把「登录成功 / 失败」写成人能读的一句。 */
function authAction(path: string): string {
  if (path.includes('/passkey/verify')) return '通行密钥登录';
  if (path.includes('/login/verify')) return '登录验证';
  if (path.includes('/login')) return '登录';
  if (path.includes('/register/verify')) return '注册验证';
  if (path.includes('/register')) return '注册';
  if (path.includes('/password/reset')) return '重置密码';
  if (path.includes('/password/forgot')) return '找回密码';
  return '认证';
}

/** 哪些路径不写日志：静默续期、日志接口本身、启动数据与探针。 */
function skipsLogging(path: string): boolean {
  return (
    path === '/api/v1/auth/refresh' ||
    path === '/api/v1/logs' ||
    path === '/api/v1/ping' ||
    path === '/api/v1/status' ||
    path === '/api/v1/bootstrap' ||
    path === '/api/v1/app/release'
  );
}

/**
 * 请求埋点：响应完成后异步写一条日志。
 *
 * 记录范围：
 * - 变更类请求（非 GET/HEAD/OPTIONS）→ `info`；
 * - 4xx → `warn`，5xx → `error`（GET 也记，因为这意味着页面在报错）；
 * - 登录/注册这类认证接口无论成功失败都记（成功记结果，失败记 `ok:false` 的原因）。
 */
export function apiRequestLog(options: { trustProxy: TrustProxy }): MiddlewareHandler<HonoEnv> {
  const trustProxy = ensureTrustProxy(options.trustProxy);
  return async (c: Context<HonoEnv>, next) => {
    const startedAt = Date.now();
    await next();
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith('/api/v1/') || skipsLogging(path)) return;
    const status = c.res?.status ?? 0;
    const authPath = path.startsWith('/api/v1/auth/');
    const mutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    // 读接口成功不记，避免日志表变成访问流水。
    if (!mutation && !authPath && status < 400) return;

    const user = c.get('user') as AuthedUser | undefined;
    const incoming = (c.env as NodeEnv | undefined)?.incoming;
    const ip = clientIp(
      { remoteAddress: incoming?.socket?.remoteAddress, forwardedFor: c.req.header('x-forwarded-for') },
      trustProxy,
    );
    const category = path.split('/')[3] || 'api';
    let level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    let message = `${method} ${path} → ${status}（${Date.now() - startedAt}ms）`;

    if (authPath && status < 400) {
      try {
        const body = (await c.res.clone().json()) as { ok?: boolean; error?: string };
        const action = authAction(path);
        if (body?.ok === false) {
          level = 'warn';
          message = `${action}失败：${String(body.error || '未知原因')}`;
        } else if (path.includes('/login') || path.includes('/register') || path.includes('/password/')) {
          message = `${action}成功`;
        }
      } catch {
        /* 响应不是 JSON 或已被消费：保留通用描述 */
      }
    }

    void writeLog({
      level,
      category,
      message,
      actorId: user?.userId ?? '',
      actorName: user?.nickname || user?.username || '访客',
      method,
      path,
      status,
      durationMs: Date.now() - startedAt,
      ip,
    });
  };
}
