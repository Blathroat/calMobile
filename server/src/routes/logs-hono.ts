import { Hono } from 'hono';
import { requireAdmin } from '../domain/permissions.js';
import { readServerSettings } from '../domain/settings.js';
import { jsonResponse } from '../http/respond.js';
import { LOG_LEVELS, logsStats, readLogs } from '../services/logs.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';

/**
 * 管理后台「最近日志」读取接口。
 *
 * 只读、仅管理员：日志里可能带操作路径、操作人与 IP，不对普通账号开放。
 * 查询参数：`limit`（默认 100，最大 500）、`level`（info / warn / error）、
 * `query`（对消息、分类、操作人、路径做子串匹配）。
 */
const app = new Hono<HonoEnv>();
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

app.get('/', authenticateHono, async (c) => {
  requireAdmin({ user: userOf(c) });
  const limitRaw = Number(c.req.query('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;
  const levelRaw = String(c.req.query('level') || '').trim();
  const level = LOG_LEVELS.includes(levelRaw as (typeof LOG_LEVELS)[number]) ? levelRaw : undefined;
  const keyword = String(c.req.query('query') || c.req.query('q') || '')
    .trim()
    .slice(0, 100);
  const settings = await readServerSettings();
  const [logs, stats] = await Promise.all([readLogs({ limit, level, query: keyword || undefined }), logsStats()]);
  return jsonResponse(c, {
    logs,
    stats: {
      storageMb: settings.logs.storageMb,
      limitBytes: settings.logs.storageMb * 1024 * 1024,
      usedBytes: stats.usedBytes,
      entryCount: stats.entryCount,
    },
  });
});

export function createLogsRoutes() {
  return app;
}
export const LOGS_ENDPOINTS: readonly [string, string][] = [['GET', '/']];
