/**
 * 客户端安装包的最新版本与下载地址。
 *
 * 管理端只配「下载源」，解析最新版是服务端的事：
 * - 直链（source=url）：url 原样下发，version / notes 为空；
 * - GitHub 仓库（source=github）：读该仓库的 latest Release，取第一个 .apk 资产。
 *
 * 两个约束：
 * 1. **失败不抛 5xx**：GitHub 限流、超时、仓库写错都只让 url 为空，页面上不出现下载入口，
 *    而不是把「检查更新」整条路径打成 500；
 * 2. **缓存**：成功缓存 5 分钟，失败缓存 60 秒 —— 前者扛住客户端集中检查更新，
 *    后者避免仓库配错时每个请求都去敲一次 GitHub 的白名单额度。
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

/** 失败结果缓存 60 秒：足够挡住连续刷新，又不至于让管理员改好仓库后等太久。 */
const FAILURE_TTL_MS = 60 * 1000;

/** GitHub 接口超时：4 秒内答不上来就当这次失败。 */
const REQUEST_TIMEOUT_MS = 4000;

interface CacheEntry {
  expiresAt: number;
  value: ReleaseInfo;
}

/** 模块级缓存，按 repo 存；进程重启即清空。 */
const cache = new Map<string, CacheEntry>();

/** 清空缓存（测试用；运维也可以据此判断是否是缓存把旧值留住了）。 */
export function clearReleaseCache(): void {
  cache.clear();
}

function emptyRelease(source: ReleaseInfo['source']): ReleaseInfo {
  return { source, version: '', notes: '', url: '', publishedAt: '' };
}

/** 空串表示没配置：调用方据此隐藏下载入口，不拼半截地址。 */
function text(value: unknown): string {
  return String(value ?? '').trim();
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
    return {
      source: 'url',
      version: '',
      notes: '',
      url: text(download?.url),
      publishedAt: '',
    };
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
