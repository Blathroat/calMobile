/**
 * `/status` 的数据边界与单文件页面组装器。
 *
 * 页面源码位于 `server/status-page/`，构建时内联到 `status-page-assets.ts`。
 * 这里保留运行时唯一的动态工作：白名单清洗状态报告并注入 INITIAL。
 */

import {
  STATUS_PAGE_CLIENT_SCRIPT,
  STATUS_PAGE_FALLBACK,
  STATUS_PAGE_STYLES,
  STATUS_PAGE_TEMPLATE,
} from './status-page-assets.js';

type UnknownNode = Record<string, unknown>;

export interface StatusReport {
  ok?: unknown;
  service?: UnknownNode;
  database?: UnknownNode;
  migrations?: UnknownNode;
  data?: UnknownNode;
  checks?: unknown[];
  endpoints?: unknown[];
}

const COUNT_FIELDS = [
  ['users', '用户'],
  ['exhibitions', '展会'],
  ['registrations', '报名'],
  ['exhibition_fields', '收集项'],
  ['app_settings', '服务器设置'],
] as const;

const DATABASE_ERROR_MESSAGE = '数据库暂时不可用，请查看服务端日志';
const MIGRATION_ERROR_MESSAGE = '迁移状态暂时不可用，请查看服务端日志';
const CHECK_ERROR_MESSAGE = '检查失败，请查看服务端日志';

function node(value: unknown): UnknownNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownNode) : {};
}

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function finiteNumber(value: unknown, fallback: number | null = null): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sensitiveError(value: unknown): boolean {
  const message = text(value);
  return /econn|postgres|postgresql|\b(?:select|insert|update|delete|alter|drop|create)\b|\bsql\b|sqlstate|stack trace|\b(?:error|typeerror|syntaxerror):|\bat [^\n]+:\d+/i.test(
    message,
  );
}

function publicCheckDetail(value: unknown, status: 'ok' | 'fail'): string {
  const message = text(value, status === 'ok' ? '通过' : CHECK_ERROR_MESSAGE);
  return !message || sensitiveError(message) ? CHECK_ERROR_MESSAGE : message;
}

/** 只复制状态页允许展示的字段，避免未知错误、SQL 或堆栈进入 INITIAL。 */
function sanitizeReport(input: unknown): StatusReport {
  const source = node(input);
  const service = node(source.service);
  const database = node(source.database);
  const migrations = node(source.migrations);
  const data = node(source.data);
  const checks = Array.isArray(source.checks)
    ? source.checks.map((value) => {
        const item = node(value);
        const status = item.status === 'ok' ? 'ok' : 'fail';
        return {
          name: text(item.name, '自检项'),
          status,
          detail: publicCheckDetail(item.detail, status),
          ms: finiteNumber(item.ms, 0) ?? 0,
        };
      })
    : [];
  const endpoints = Array.isArray(source.endpoints)
    ? source.endpoints.map((value) => {
        const item = node(value);
        return { method: text(item.method), path: text(item.path) };
      })
    : [];

  return {
    ok: Boolean(source.ok),
    service: {
      name: text(service.name, 'calmobile-server'),
      version: text(service.version, '-'),
      node: text(service.node, '—'),
      uptimeSec: finiteNumber(service.uptimeSec, 0) ?? 0,
      startedAt: text(service.startedAt),
      timeZone: text(service.timeZone, 'UTC'),
      now: text(service.now),
    },
    database: {
      connected: Boolean(database.connected),
      latencyMs: finiteNumber(database.latencyMs),
      version: text(database.version),
      database: text(database.database),
      host: text(database.host),
      pool: {
        total: finiteNumber(node(database.pool).total),
        idle: finiteNumber(node(database.pool).idle),
        waiting: finiteNumber(node(database.pool).waiting),
      },
      ...(database.error ? { error: DATABASE_ERROR_MESSAGE } : {}),
    },
    migrations: {
      applied: Array.isArray(migrations.applied)
        ? migrations.applied.map((value) => {
            const item = node(value);
            return { id: text(item.id), appliedAt: text(item.appliedAt) };
          })
        : [],
      pending: Array.isArray(migrations.pending) ? migrations.pending.map((value) => text(value)) : [],
      ...(migrations.error ? { error: MIGRATION_ERROR_MESSAGE } : {}),
    },
    data: Object.fromEntries(COUNT_FIELDS.map(([key]) => [key, finiteNumber(data[key])])),
    checks,
    endpoints,
  };
}

function initialJson(report: unknown): string {
  return JSON.stringify(sanitizeReport(report)).replace(/[<\u2028\u2029]/g, (character) => {
    const code = character.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

function countFields(): string {
  return COUNT_FIELDS.map(
    ([key, label]) => `<div><dt>${label}</dt><dd class="mono" data-count="${key}">—</dd></div>`,
  ).join('');
}

/** 输出一个自包含 HTML 文件；首屏数据由客户端从 INITIAL 读取。 */
export function renderStatusPage(report: StatusReport | unknown): string {
  return STATUS_PAGE_TEMPLATE.replace('__STYLES__', () => STATUS_PAGE_STYLES)
    .replace('__COUNT_FIELDS__', () => countFields())
    .replace('__CLIENT_SCRIPT__', () => STATUS_PAGE_CLIENT_SCRIPT)
    .replace('__INITIAL__', () => initialJson(report));
}

/** 页面模板自身出错时的固定兜底，不把异常原文写回客户端。 */
export function renderStatusFallbackPage(): string {
  return STATUS_PAGE_FALLBACK.replace('__STYLES__', () => STATUS_PAGE_STYLES);
}
