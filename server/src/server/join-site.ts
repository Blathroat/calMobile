/**
 * 浏览器报名站：和 API 同一个进程、同一个端口。
 *
 * 静态文件来自 `web/dist-join`（`join.html` 是入口）。`/api`、`/media` 和探针不归这里管。
 * 配了 `PUBLIC_BASE_URL` 时，报名站页面的 Host 必须和这个域名一致，否则 308 过去。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TrustProxy } from '../config/runtime.js';
import { normalizeBaseUrl } from '../config/runtime.js';

const RESERVED_PREFIXES = ['/api', '/media', '/status', '/ping', '/health', '/app'];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

export const JOIN_SHELL = 'join.html';

/** `server/src/server` 往上三级是仓库根。 */
export function defaultJoinRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../../web/dist-join', import.meta.url)));
}

export function joinSiteReady(root: string): boolean {
  return existsSync(path.join(root, JOIN_SHELL));
}

export function joinSiteMissingMessage(root: string): string {
  return `报名站产物缺失：没有找到 ${path.join(root, JOIN_SHELL)}。请先执行 pnpm --dir server build；开发用 pnpm --dir server dev，会自动构建。`;
}

/** API、媒体和探针继续走原路由，不参与域名跳转，也不回报名站页面。 */
export function isJoinPagePath(pathname: string): boolean {
  return !RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * 反代打开了 `TRUST_PROXY` 时用 `X-Forwarded-Host` 的第一段，否则只用 `Host`。
 */
export function requestHost(input: { host: string; forwardedHost: string; trustProxy: TrustProxy }): string {
  if (input.trustProxy !== false) {
    const forwarded = input.forwardedHost.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return input.host.trim();
}

function hostsMatch(requestHost: string, target: URL): boolean {
  const host = requestHost.toLowerCase().replace(/\.$/, '');
  const hostname = target.hostname.toLowerCase();
  const withPort = target.host.toLowerCase();
  if (host === withPort || host === hostname) return true;
  const defaultPort = target.protocol === 'https:' ? '443' : '80';
  return !target.port && host === `${hostname}:${defaultPort}`;
}

/**
 * 页面 Host 和 `PUBLIC_BASE_URL` 不一致时返回跳转地址。没配域名、或已经在该域名上，返回 null。
 */
export function canonicalRedirect(input: {
  requestHost: string;
  publicBaseUrl: string;
  pathAndQuery: string;
}): string | null {
  const base = normalizeBaseUrl(input.publicBaseUrl);
  if (!base) return null;
  let target: URL;
  try {
    target = new URL(base);
  } catch {
    return null;
  }
  if (hostsMatch(input.requestHost, target)) return null;
  const pathAndQuery = input.pathAndQuery.startsWith('/') ? input.pathAndQuery : `/${input.pathAndQuery}`;
  return `${base}${pathAndQuery}`;
}

export interface JoinFile {
  body: Buffer;
  type: string;
  cache: string;
}

export type JoinLookup = { kind: 'file'; file: JoinFile } | { kind: 'missing' };

/** 有对应文件就返回文件；报名站路由回退到 `join.html`；跳出目录或以 `/assets/` 开头却找不到的，404。 */
export function lookupJoinFile(root: string, pathname: string): JoinLookup {
  const rootResolved = path.resolve(root);
  let decoded = '/';
  try {
    decoded = decodeURIComponent(pathname || '/');
  } catch {
    return { kind: 'missing' };
  }
  if (decoded.includes('\0')) return { kind: 'missing' };
  const relative = decoded.replace(/^\/+/, '');
  if (relative) {
    const full = path.resolve(rootResolved, relative);
    const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
    if (full !== rootResolved && !full.startsWith(prefix)) return { kind: 'missing' };
    if (existsSync(full) && statSync(full).isFile()) {
      return { kind: 'file', file: readJoin(full, relative.startsWith('assets/')) };
    }
  }
  if (relative.startsWith('assets/')) return { kind: 'missing' };
  const shell = path.join(rootResolved, JOIN_SHELL);
  if (!existsSync(shell)) return { kind: 'missing' };
  return { kind: 'file', file: readJoin(shell, false) };
}

function readJoin(file: string, hashed: boolean): JoinFile {
  const extension = path.extname(file).toLowerCase();
  return {
    body: readFileSync(file),
    type: CONTENT_TYPES[extension] || 'application/octet-stream',
    cache: hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
}
