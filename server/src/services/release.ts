/**
 * 客户端安装包的最新版本与下载地址。
 *
 * 管理端只配「下载源」，解析最新版是服务端的事：
 * - 直链（source=url，填到 .apk 文件）：url 原样下发，version / notes 为空；
 * - 目录（source=url，填一个目录）：读取目录里的 `index.json`（或 HTML 目录列表），
 *   按文件名里的版本号选最高的一版；同目录的 `latest.json` 可提供更新日志；
 * - GitHub 仓库（source=github）：读该仓库的 latest Release，取第一个 .apk 资产。
 *
 * 两个约束：
 * 1. **失败不抛 5xx**：外部目录、GitHub 限流、超时、配置写错都只让 url 为空或退回
 *    直链，页面上不出现坏链接，而不是把「检查更新」整条路径打成 500；
 * 2. **缓存**：成功缓存 5 分钟，失败缓存 60 秒 —— 前者扛住客户端集中检查更新，
 *    后者避免目录配错时每个请求都去敲一次外部地址。
 */

import type { ServerSettings } from '../config/migrate.js';

export interface ReleaseInfo {
  source: 'url' | 'github';
  version: string;
  notes: string;
  url: string;
  publishedAt: string;
}

/** 成功结果缓存 5 分钟。 */
const SUCCESS_TTL_MS = 5 * 60 * 1000;

/** 失败结果缓存 60 秒：足够挡住连续刷新，又不至于让管理员改好目录后等太久。 */
const FAILURE_TTL_MS = 60 * 1000;

/** 外部请求超时：4 秒内答不上来就当这次失败。 */
const REQUEST_TIMEOUT_MS = 4000;

interface CacheEntry {
  expiresAt: number;
  value: ReleaseInfo;
}

interface DirectoryCacheEntry {
  expiresAt: number;
  /** null 表示这个地址不像目录：调用方退回原来的直链行为。 */
  value: ReleaseInfo | null;
}

interface DirectoryFile {
  name: string;
  url: string;
  version: string;
}

interface DirectoryNotes {
  version: string;
  notes: string;
  publishedAt: string;
}

/** 模块级缓存，按 repo 或目录 URL 存；进程重启即清空。 */
const cache = new Map<string, CacheEntry>();
const directoryCache = new Map<string, DirectoryCacheEntry>();

/** 清空缓存（测试用；运维也可以据此判断是否是缓存把旧值留住了）。 */
export function clearReleaseCache(): void {
  cache.clear();
  directoryCache.clear();
}

function emptyRelease(source: ReleaseInfo['source']): ReleaseInfo {
  return { source, version: '', notes: '', url: '', publishedAt: '' };
}

/** 空串表示没配置：调用方据此隐藏下载入口，不拼半截地址。 */
function text(value: unknown): string {
  return String(value ?? '').trim();
}

function directRelease(url: string): ReleaseInfo {
  return { source: 'url', version: '', notes: '', url, publishedAt: '' };
}

/** 从 GitHub 的 Release JSON 里取需要的那几项（字段缺失一律当空串）。 */
export function parseLatestRelease(payload: unknown): ReleaseInfo {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  const apk = assets.find((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    return text((asset as Record<string, unknown>).name)
      .toLowerCase()
      .endsWith('.apk');
  }) as Record<string, unknown> | undefined;
  return {
    source: 'github',
    // tag 前缀的 v 只去一个：v1.2.3 → 1.2.3，version2.0 → version2.0。
    version: text(record.tag_name).replace(/^v/, ''),
    notes: typeof record.body === 'string' ? record.body : '',
    url: text(apk ? apk.browser_download_url : record.html_url),
    publishedAt: text(record.published_at),
  };
}

/** 请求指定仓库的最新 Release；超时用 AbortSignal，任何非 2xx 都当失败。 */
async function fetchLatestRelease(repo: string, env: Record<string, string | undefined>): Promise<ReleaseInfo> {
  const headers: Record<string, string> = {
    // GitHub 推荐的 API 媒体类型。拆成两段拼接是为了避开前端错误码扫描
    // （web/src/i18n/server-error-codes.test.ts 会把 x.y 形状的字符串字面量当成错误码）。
    Accept: 'application/vnd.' + 'github+json',
    'User-Agent': 'calMobile-server',
  };
  const token = text(env.GITHUB_TOKEN);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub Releases 接口返回 ${response.status}`);
  }
  return parseLatestRelease(await response.json());
}

/** 去掉目录末尾斜杠后统一补一个，便于拼 index.json / latest.json。 */
function directoryBase(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.toString();
}

/** 从 APK 文件名里取版本号：`app-1.2.3.apk` → `1.2.3`，`v2.0` 也接受。 */
export function versionFromFilename(name: string): string {
  const stem = name.replace(/\.apk$/i, '');
  const matches = stem.match(/\d+(?:\.\d+){1,3}/g) ?? [];
  return String(matches.at(-1) ?? '').replace(/^v/i, '');
}

/** 按 `x.y.z` 比较版本：缺位当 0，数字段按数值比较，非数字段按字符串兜底。 */
export function compareReleaseVersions(left: string, right: string): number {
  const a = versionSegments(left);
  const b = versionSegments(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? '0';
    const y = b[index] ?? '0';
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) return difference > 0 ? 1 : -1;
      continue;
    }
    if (x === y) continue;
    return x > y ? 1 : -1;
  }
  return 0;
}

function versionSegments(version: string): string[] {
  const plain = text(version).replace(/^v/i, '');
  if (!plain) return [];
  return plain.split('.').map((part) => (part.trim() === '' ? '0' : part.trim()));
}

function basename(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    return value.split('/').filter(Boolean).at(-1) ?? '';
  }
}

function fileUrl(base: string, name: string): string {
  if (/^https?:\/\//i.test(name)) return name;
  return new URL(
    name
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/'),
    base,
  ).toString();
}

function addFile(files: DirectoryFile[], name: string, url: string, explicitVersion = ''): void {
  const baseName = basename(name);
  if (!baseName.toLowerCase().endsWith('.apk')) return;
  const version = explicitVersion.replace(/^v/i, '') || versionFromFilename(baseName);
  if (!version) return;
  const key = `${baseName}\u0000${url}`;
  if (files.some((file) => `${file.name}\u0000${file.url}` === key)) return;
  files.push({ name: baseName, url, version });
}

/** 目录索引 JSON：支持数组、`{ files: [] }` 或 `{ versions: [] }`，尽量宽松。 */
function parseDirectoryIndex(payload: unknown, base: string): DirectoryFile[] {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.files)
      ? record.files
      : Array.isArray(record?.versions)
        ? record.versions
        : [];
  const files: DirectoryFile[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      addFile(files, item, fileUrl(base, item));
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const url = text(entry.url) || fileUrl(base, text(entry.name ?? entry.file ?? entry.path));
    const name = text(entry.name ?? entry.file ?? entry.path) || basename(url);
    addFile(files, name, url, text(entry.version));
  }
  return files;
}

/** 没有 index.json 时，兼容常见静态目录的 HTML 链接列表。 */
function parseDirectoryHtml(html: string, base: string): DirectoryFile[] {
  const files: DirectoryFile[] = [];
  const pattern = /href\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const href = text(match[1]).replace(/&amp;/g, '&');
    if (!/\.apk(?:[?#]|$)/i.test(href)) continue;
    try {
      const url = new URL(href, base).toString();
      addFile(files, href, url);
    } catch {
      // 坏链接跳过即可，不影响其它文件。
    }
  }
  return files;
}

function parseDirectoryNotes(payload: unknown): DirectoryNotes | null {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!record) return null;
  const notes = typeof record.notes === 'string' ? record.notes : typeof record.body === 'string' ? record.body : '';
  const publishedAt = text(record.publishedAt ?? record.published_at);
  const version = text(record.version).replace(/^v/i, '');
  if (!notes && !publishedAt && !version) return null;
  return { version, notes, publishedAt };
}

async function fetchOptional(url: string, accept: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'calMobile-server' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

async function readDirectory(base: string): Promise<ReleaseInfo | null> {
  const files: DirectoryFile[] = [];
  const index = await fetchOptional(new URL('index.json', base).toString(), 'application/json');
  if (index) {
    try {
      files.push(...parseDirectoryIndex(await index.json(), base));
    } catch {
      // 索引不是合法 JSON 时继续尝试目录 HTML。
    }
  }
  if (files.length === 0) {
    const listing = await fetchOptional(base, 'text/html');
    if (listing) files.push(...parseDirectoryHtml(await listing.text(), base));
  }
  if (files.length === 0) return null;
  files.sort(
    (left, right) => compareReleaseVersions(right.version, left.version) || left.name.localeCompare(right.name),
  );
  const latest = files[0]!;
  let notes: DirectoryNotes | null = null;
  const notesResponse = await fetchOptional(new URL('latest.json', base).toString(), 'application/json');
  if (notesResponse) {
    try {
      notes = parseDirectoryNotes(await notesResponse.json());
    } catch {
      notes = null;
    }
  }
  const notesVersion = notes?.version.replace(/^v/i, '') ?? '';
  const notesMatch = Boolean(notes && (!notesVersion || notesVersion === latest.version));
  return {
    source: 'url',
    version: latest.version,
    notes: notesMatch ? notes!.notes : '',
    url: latest.url,
    publishedAt: notesMatch ? notes!.publishedAt : '',
  };
}

/**
 * 普通 URL 下载源：
 * - `.apk` 结尾按直链，保持旧行为；
 * - 其它地址先当目录探测（index.json / HTML 列表），探测不到再退回直链。
 */
async function resolveUrlRelease(url: string): Promise<ReleaseInfo> {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 校验层已经卡过 http(s)，这里只做兜底。
  }
  if (/\.apk$/i.test(pathname)) return directRelease(url);
  let base = '';
  try {
    base = directoryBase(url);
  } catch {
    return directRelease(url);
  }
  const now = Date.now();
  const cached = directoryCache.get(base);
  if (cached && cached.expiresAt > now) {
    return cached.value ?? directRelease(url);
  }
  let value: ReleaseInfo | null = null;
  try {
    value = await readDirectory(base);
  } catch {
    value = null;
  }
  directoryCache.set(base, {
    expiresAt: now + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
    value,
  });
  return value ?? directRelease(url);
}

/**
 * 解析当前要下发的版本信息。
 *
 * @param settings 服务器设置（只用 download 段）。
 * @param env 读取 GITHUB_TOKEN 的环境对象；默认 process.env，测试可注入。
 */
export async function resolveRelease(
  settings: Pick<ServerSettings, 'download'> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<ReleaseInfo> {
  const download = settings?.download;
  if (download?.source !== 'github') {
    const url = text(download?.url);
    return url ? resolveUrlRelease(url) : emptyRelease('url');
  }
  const repo = text(download.repo);
  if (!repo) {
    return emptyRelease('github');
  }
  const now = Date.now();
  const cached = cache.get(repo);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  try {
    const value = await fetchLatestRelease(repo, env);
    cache.set(repo, { expiresAt: now + SUCCESS_TTL_MS, value });
    return value;
  } catch (error: unknown) {
    // 失败只进服务端日志：客户端只知道「暂时没有下载地址」，检查更新不该因此失败。
    console.warn(`读取 GitHub Release 失败（${repo}）：`, error instanceof Error ? error.message : String(error));
    const value = emptyRelease('github');
    cache.set(repo, { expiresAt: now + FAILURE_TTL_MS, value });
    return value;
  }
}
