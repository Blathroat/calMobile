/**
 * 实例专属页面层：把构建期生成的 `web/dist` / `web/dist-join` 复制一份，按运行时
 * 品牌配置改标题、manifest、图标与 Service Worker，并重算 `release.json`。
 *
 * 为什么在服务启动时做，而不是请求时拼：
 * - Android 热更新按 `release.json` 的 sha256 校验每个文件，改了文件就必须改清单；
 * - 复制一份完整页面壳（约 2 MB）比每次请求改 HTML 更简单，也保证 `/app/` 下所有
 *   文件是一个一致快照；
 * - 没有品牌配置时直接返回静态目录，零额外开销，主实例行为不变。
 *
 * 生成结果是临时目录；进程退出时清理。配置错误会回退到原静态目录并返回 warning，
 * 不让 API 因为一个标题或图标起不来。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientBranding, type BrandingConfig, type ClientBranding } from '../config/branding.js';

export interface RuntimeWebResult {
  /** 实际用于托管 `/app/` 的目录；没有生成品牌层时就是传入的静态目录。 */
  root: string;
  /** 是否生成了运行时副本。 */
  applied: boolean;
  warnings: string[];
}

export interface RuntimeJoinResult {
  /** 实际用于托管报名站的目录。 */
  root: string;
  applied: boolean;
  warnings: string[];
}

const trackedDirs = new Set<string>();
let cleanupRegistered = false;

/** 运行时包根：源码下是仓库根，npm 包里是包根。相对路径都按它解析。 */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function resolveRuntimePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(PACKAGE_ROOT, value);
}

function trackRuntimeDir(dir: string): void {
  trackedDirs.add(dir);
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once('exit', cleanupRuntimeDirs);
}

/** 删除当前进程创建的所有运行时目录；测试与进程退出时使用。 */
export function cleanupRuntimeDirs(): void {
  for (const dir of trackedDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响进程退出。
    }
  }
  trackedDirs.clear();
}

function createRuntimeDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `calmobile-${prefix}-`));
  trackRuntimeDir(dir);
  return dir;
}

/** 临时目录不可写时不应让 API 起不来：返回 null，由调用方回退静态页面。 */
function createRuntimeDirOrFallback(prefix: string): string | null {
  try {
    return createRuntimeDir(prefix);
  } catch {
    return null;
  }
}

function discardRuntimeDir(dir: string): void {
  trackedDirs.delete(dir);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响回退；临时目录由系统回收。
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 生成应用页面层。
 *
 * @param input.baseRoot 静态页面目录（`web/dist` 或运行时包里的 app-shell 副本）
 * @param input.branding 解析后的品牌配置
 */
export function prepareRuntimeWeb(input: { baseRoot: string; branding: BrandingConfig }): RuntimeWebResult {
  const warnings = [...input.branding.warnings];
  if (!input.branding.appActive) return { root: input.baseRoot, applied: false, warnings };
  if (!existsSync(path.join(input.baseRoot, 'index.html'))) {
    return { root: input.baseRoot, applied: false, warnings: [...warnings, '页面产物缺失，跳过运行时品牌层'] };
  }

  const root = createRuntimeDirOrFallback('web');
  if (!root) {
    return { root: input.baseRoot, applied: false, warnings: [...warnings, '无法创建临时页面目录，跳过运行时品牌层'] };
  }
  try {
    cpSync(input.baseRoot, root, { recursive: true });
  } catch (error: unknown) {
    discardRuntimeDir(root);
    return {
      root: input.baseRoot,
      applied: false,
      warnings: [...warnings, `复制页面产物失败，回退静态页面：${messageOf(error)}`],
    };
  }

  /** 单个品牌项失败时只回退这一项，保留其它已经生成的内容。 */
  const step = (label: string, apply: () => string[], restore: () => void): void => {
    try {
      warnings.push(...apply());
    } catch (error: unknown) {
      warnings.push(`${label}失败，保留构建期默认值：${messageOf(error)}`);
      try {
        restore();
      } catch {
        // 回退单文件失败时，下面的 release.json 重算仍会覆盖当前内容；不阻断服务。
      }
    }
  };

  if (input.branding.indexActive) {
    step(
      '页面标题/meta',
      () => transformIndex(root, input.branding),
      () => copyFromBase(input.baseRoot, root, 'index.html'),
    );
  }
  if (input.branding.manifestActive) {
    step(
      'PWA manifest',
      () => {
        transformManifest(root, input.branding);
        return [];
      },
      () => copyFromBase(input.baseRoot, root, 'manifest.webmanifest'),
    );
  }
  if (input.branding.icon || input.branding.iconDir) {
    step(
      'PWA 图标',
      () => {
        installIcons(root, input.branding);
        return [];
      },
      () => restoreIcons(input.baseRoot, root),
    );
  }
  step(
    'Service Worker 缓存名',
    () => {
      rewriteServiceWorkerCache(root);
      return [];
    },
    () => copyFromBase(input.baseRoot, root, 'sw.js'),
  );

  try {
    writeReleaseManifest(root);
    return { root, applied: true, warnings };
  } catch (error: unknown) {
    discardRuntimeDir(root);
    return {
      root: input.baseRoot,
      applied: false,
      warnings: [...warnings, `release.json 生成失败，回退静态页面：${messageOf(error)}`],
    };
  }
}

/**
 * 生成报名站页面层。只处理标题；`join.html` 不参与 Android 热更新，改动风险最低。
 */
export function prepareRuntimeJoin(input: { baseRoot: string; branding: BrandingConfig }): RuntimeJoinResult {
  const warnings = [...input.branding.warnings];
  if (!input.branding.joinActive) return { root: input.baseRoot, applied: false, warnings };
  if (!existsSync(path.join(input.baseRoot, 'join.html'))) {
    return { root: input.baseRoot, applied: false, warnings: [...warnings, '报名站产物缺失，跳过运行时标题'] };
  }

  const root = createRuntimeDirOrFallback('join');
  if (!root) {
    return { root: input.baseRoot, applied: false, warnings: [...warnings, '无法创建临时页面目录，跳过运行时标题'] };
  }
  try {
    cpSync(input.baseRoot, root, { recursive: true });
    transformJoin(root, input.branding);
    return { root, applied: true, warnings };
  } catch (error: unknown) {
    discardRuntimeDir(root);
    return {
      root: input.baseRoot,
      applied: false,
      warnings: [...warnings, `报名站运行时标题生成失败，回退静态页面：${messageOf(error)}`],
    };
  }
}

function copyFromBase(baseRoot: string, root: string, relative: string): void {
  const source = path.join(baseRoot, relative);
  if (existsSync(source)) copyFileSync(source, path.join(root, relative));
}

function restoreIcons(baseRoot: string, root: string): void {
  const source = path.join(baseRoot, 'icons');
  const target = path.join(root, 'icons');
  rmSync(target, { recursive: true, force: true });
  if (existsSync(source)) cpSync(source, target, { recursive: true });
  copyFromBase(baseRoot, root, 'favicon.ico');
}

function transformIndex(root: string, branding: BrandingConfig): string[] {
  const file = path.join(root, 'index.html');
  let html = readFileSync(file, 'utf8');
  const warnings: string[] = [];
  const title = branding.appTitle || branding.appName;
  if (title) html = replaceTitle(html, title);
  if (branding.description) {
    const result = replaceMeta(html, 'description', branding.description);
    html = result.html;
    if (!result.matched) warnings.push('页面缺少 meta description，首屏描述不会替换');
  }
  if (branding.shortName) {
    const result = replaceMeta(html, 'apple-mobile-web-app-title', branding.shortName);
    html = result.html;
    if (!result.matched) warnings.push('页面缺少 apple-mobile-web-app-title，iOS 首屏名称不会替换');
  }
  if (branding.themeColor) {
    const result = replaceThemeColor(html, 'light', branding.themeColor);
    html = result.html;
    if (!result.matched) warnings.push('页面缺少浅色 theme-color，首屏主题色不会替换');
  }
  if (branding.themeColorDark) {
    const result = replaceThemeColor(html, 'dark', branding.themeColorDark);
    html = result.html;
    if (!result.matched) warnings.push('页面缺少深色 theme-color，首屏主题色不会替换');
  }
  html = injectBrandingScript(html, branding);
  writeFileSync(file, html);
  return warnings;
}

function transformJoin(root: string, branding: BrandingConfig): void {
  const file = path.join(root, 'join.html');
  let html = readFileSync(file, 'utf8');
  if (!branding.joinTitle) throw new Error('报名站标题为空');
  html = replaceTitle(html, branding.joinTitle);
  html = injectBrandingScript(html, branding);
  writeFileSync(file, html);
}

function transformManifest(root: string, branding: BrandingConfig): void {
  const file = path.join(root, 'manifest.webmanifest');
  if (!existsSync(file)) throw new Error('缺少 manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (branding.appName) manifest.name = branding.appName;
  if (branding.shortName) manifest.short_name = branding.shortName;
  if (branding.description) manifest.description = branding.description;
  if (branding.lang) manifest.lang = branding.lang;
  if (branding.themeColor) manifest.theme_color = branding.themeColor;
  if (branding.backgroundColor) manifest.background_color = branding.backgroundColor;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function installIcons(root: string, branding: BrandingConfig): void {
  if (branding.iconDir) {
    installIconDirectory(root, branding.iconDir);
    return;
  }
  generateIcons(root, branding);
}

function installIconDirectory(root: string, iconDir: string): void {
  const source = resolveRuntimePath(iconDir);
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`PWA_ICON_DIR 不存在：${source}`);
  const sourceIcons = path.join(source, 'icons');
  if (existsSync(sourceIcons) && statSync(sourceIcons).isDirectory()) {
    copyTree(sourceIcons, path.join(root, 'icons'));
  }
  const favicon = path.join(source, 'favicon.ico');
  if (existsSync(favicon)) copyFileSync(favicon, path.join(root, 'favicon.ico'));

  for (const required of [
    'favicon.ico',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-1024.png',
    'icons/maskable-512.png',
    'icons/favicon-32.png',
    'icons/apple-touch-icon-180.png',
  ]) {
    if (!existsSync(path.join(root, required))) throw new Error(`PWA_ICON_DIR 缺少 ${required}`);
  }
}

function copyTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
      continue;
    }
    if (entry.isFile()) copyFileSync(from, to);
  }
}

function generateIcons(root: string, branding: BrandingConfig): void {
  const script = path.resolve(fileURLToPath(new URL('../../../scripts/build-icons.mjs', import.meta.url)));
  if (!existsSync(script)) throw new Error(`缺少图标生成脚本：${script}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ICON: resolveRuntimePath(branding.icon),
    // 运行时品牌配置是权威来源：不要被旧 server/.env 里的构建期值重新覆盖。
    APP_ICON_BACKGROUND: branding.iconBackground || '#41707e',
    APP_ICON_TRANSPARENT: branding.iconTransparent ? '1' : '0',
  };
  execFileSync(process.execPath, [script, '--target', 'web', '--out', root], {
    env,
    stdio: 'pipe',
  });
  for (const required of [
    'favicon.ico',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-1024.png',
    'icons/maskable-512.png',
    'icons/favicon-32.png',
    'icons/apple-touch-icon-180.png',
  ]) {
    if (!existsSync(path.join(root, required))) throw new Error(`图标生成后缺少 ${required}`);
  }
}

/** 页面标题与 PWA 名称、PWA 图标一致：`/app/` 下固定文件每次都要能看到新版本。 */
function replaceTitle(html: string, title: string): string {
  const pattern = /<title>[\s\S]*?<\/title>/i;
  if (!pattern.test(html)) throw new Error('页面缺少 <title>');
  return html.replace(pattern, () => `<title>${escapeHtml(title)}</title>`);
}

function replaceMeta(html: string, name: string, value: string): { html: string; matched: boolean } {
  const pattern = new RegExp(`(<meta\\s+name="${escapeRegExp(name)}"\\s+content=")[^"]*(")`, 'i');
  if (!pattern.test(html)) return { html, matched: false };
  return {
    html: html.replace(
      pattern,
      (_match: string, prefix: string, suffix: string) => `${prefix}${escapeHtml(value)}${suffix}`,
    ),
    matched: true,
  };
}

function replaceThemeColor(html: string, scheme: 'light' | 'dark', value: string): { html: string; matched: boolean } {
  const pattern = new RegExp(
    `(<meta\\s+name="theme-color"\\s+content=")[^"]*("\\s+media="[^"]*prefers-color-scheme:\\s*${scheme}[^"]*")`,
    'i',
  );
  if (!pattern.test(html)) return { html, matched: false };
  return {
    html: html.replace(
      pattern,
      (_match: string, prefix: string, suffix: string) => `${prefix}${escapeHtml(value)}${suffix}`,
    ),
    matched: true,
  };
}

function injectBrandingScript(html: string, branding: BrandingConfig): string {
  const payload = clientBranding(branding);
  if (Object.keys(payload).length === 0) return html;
  const script = `<script>window.__CALMOBILE_BRANDING__ = ${jsonForScript(payload)};</script>`;
  if (html.includes('__CALMOBILE_BRANDING__')) return html;
  if (!html.includes('</head>')) throw new Error('页面缺少 </head>');
  return html.replace('</head>', () => `${script}</head>`);
}

function jsonForScript(value: ClientBranding): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Service Worker 的缓存名在构建时按静态清单算；运行时改了标题/图标后必须换一个，
 * 否则已安装 PWA 断网回退会拿到旧外壳。缓存名只取决于页面文件内容，不影响预缓存列表。
 */
function rewriteServiceWorkerCache(root: string): void {
  const file = path.join(root, 'sw.js');
  if (!existsSync(file)) return;
  const files = snapshotFiles(root, ['release.json', 'sw.js']);
  const version = digestFiles(files);
  const source = readFileSync(file, 'utf8');
  const pattern = /const\s+CACHE_NAME\s*=\s*(['"])calmobile-app-[^'"]*\1\s*;/;
  if (!pattern.test(source)) throw new Error('sw.js 中未找到 CACHE_NAME，无法重置离线缓存');
  const next = source.replace(
    pattern,
    (_match: string, quote: string) => `const CACHE_NAME = ${quote}calmobile-app-${version}${quote};`,
  );
  writeFileSync(file, next);
}

/** 重算热更新清单：路径与 `web/release-manifest.mjs` 保持一致，但覆盖运行时改过的文件。 */
function writeReleaseManifest(root: string): void {
  const files = snapshotFiles(root, ['release.json']);
  const id = digestFiles(files);
  writeFileSync(path.join(root, 'release.json'), `${JSON.stringify({ id, files })}\n`);
}

interface ReleaseFile {
  path: string;
  sha256: string;
}

function snapshotFiles(root: string, exclude: string[]): ReleaseFile[] {
  const excluded = new Set(exclude);
  const files: ReleaseFile[] = [];
  walk(root, root, files, excluded);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return files;
}

function walk(root: string, dir: string, files: ReleaseFile[], excluded: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (excluded.has(relative)) continue;
    if (entry.isDirectory()) {
      walk(root, full, files, excluded);
      continue;
    }
    if (!entry.isFile()) continue;
    const sha256 = createHash('sha256').update(readFileSync(full)).digest('hex');
    files.push({ path: relative, sha256 });
  }
}

function digestFiles(files: ReleaseFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}
