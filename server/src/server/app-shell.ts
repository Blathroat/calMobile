/**
 * 已安装客户端的页面包：和 API 同一个进程、同一个端口，挂在 `/app/`。
 *
 * 静态文件来自 `web/dist`（`index.html` 是入口，`release.json` 是热更新清单）。
 * 有产物就托管，不看报名站开关。`/api`、`/media`、探针和报名站路径不归这里。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

export const APP_SHELL = 'index.html';

/** `server/src/server` 往上三级是仓库根。部署后与 `server/dist` 同级的 `web/dist`。 */
export function defaultAppRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../../web/dist', import.meta.url)));
}

/**
 * 运行时包里额外带的一份页面壳，路径是 `server/dist/app-shell`。
 *
 * 生产环境可能由 systemd 在启动前清掉 `current/web/dist`（旧部署把它当缓存）。
 * 这份副本不叫 `web/dist`，不会被那条清理规则命中，服务端在 `web/dist` 缺失时
 * 用它继续提供 `/app/`、PWA 和 Android 热更新清单。报名站另有
 * `server/dist/app-shell-join` 副本，见 `join-site.ts`。
 */
export function defaultPackagedAppRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../../server/dist/app-shell', import.meta.url)));
}

export function appShellReady(root: string): boolean {
  return existsSync(path.join(root, APP_SHELL));
}

/**
 * 选择要托管的页面根：优先构建产物 `web/dist`，缺失时退到运行时包副本。
 * 纯函数，测试可以直接给两个临时目录。
 */
export function pickAppRoot(webRoot: string, packagedRoot: string): string {
  return appShellReady(webRoot) ? webRoot : packagedRoot;
}

export interface AppFile {
  body: Buffer;
  type: string;
  cache: string;
}

export type AppLookup = { kind: 'file'; file: AppFile } | { kind: 'missing' };

/**
 * `/app` 与 `/app/` 对应 `index.html`。其余路径必须有同名文件。
 * 缺的脚本不回退成页面，避免热更新把 HTML 当成模块。
 */
export function lookupAppFile(root: string, pathname: string): AppLookup {
  const relative = appRelativePath(pathname);
  if (relative === null) return { kind: 'missing' };
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, relative);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
  if (full !== rootResolved && !full.startsWith(prefix)) return { kind: 'missing' };
  if (!existsSync(full) || !statSync(full).isFile()) return { kind: 'missing' };
  const extension = path.extname(full).toLowerCase();
  return {
    kind: 'file',
    file: {
      body: readFileSync(full),
      type: CONTENT_TYPES[extension] || 'application/octet-stream',
      cache: appCacheControl(relative),
    },
  };
}

/** 解码后的站内路径。不是 `/app` 下的、或含穿越的，返回 null。 */
export function appRelativePath(pathname: string): string | null {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(pathname || '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded === '/app') return APP_SHELL;
  if (!decoded.startsWith('/app/')) return null;
  const rest = decoded.slice('/app/'.length);
  if (rest === '' || rest === APP_SHELL) return APP_SHELL;
  const parts = rest.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return rest;
}

/**
 * 入口、热更新清单、Service Worker、PWA 清单和图标都用固定文件名，每次都要能看到新版本；
 * 只有带哈希的 `assets/` 可以长期缓存。
 */
export function appCacheControl(relative: string): string {
  if (relative === APP_SHELL || relative === 'release.json') return 'no-cache';
  if (relative.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}
