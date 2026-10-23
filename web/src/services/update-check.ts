/**
 * 应用更新：版本比较、提示判断与本机偏好。
 *
 * 服务端 `GET /app/release` 已经按管理端配置解析好下载源：
 * - `github`：`version` / `notes` 来自最新 Release，版本比本机构建新才提示；
 * - `url`：直链没有版本号，只要有地址就可以下载。
 * 两者都要求 `url` 非空，空串表示管理员还没配。
 *
 * 本机偏好都吞掉读写异常（隐私模式或配额满不影响主流程）：
 * - `calmobile.autoUpdate`：自动检查开关，未设置时按关闭处理；
 * - `calmobile.lastUpdateCheck`：上次检查的时间戳，六小时内不重复自动检查；
 * - `calmobile.promptedUpdate`：自动提示过的标记（GitHub 用版本号，直链用地址）。
 */
import type { ReleaseInfo } from '@/api/types';

export const AUTO_UPDATE_KEY = 'calmobile.autoUpdate';
export const LAST_CHECK_KEY = 'calmobile.lastUpdateCheck';
export const PROMPTED_KEY = 'calmobile.promptedUpdate';

/** 自动检查的最小间隔：六小时内不重复。 */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 判断提示只需要这几项；整份 `ReleaseInfo` 或测试构造的对象都可以传进来。 */
export type ReleaseLike = Pick<ReleaseInfo, 'source' | 'version' | 'url'>;

/** 本机存储；拿不到时返回 null，读写都走 `read` / `write` 吞异常。 */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string {
  try {
    return storage()?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // 隐私模式或配额满：偏好记不住，不影响本次操作。
  }
}

/** 构建期注入的版本号；没有注入时返回空串。 */
export function currentVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__.trim() : '';
}

/**
 * 按 `x.y.z` 比较版本：缺位当 0，数字段按数值比；
 * 带 `v` 前缀时先去掉，非数字段按字符串兜底。
 */
export function compareVersions(left: string, right: string): number {
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

/** 拆版本段：去掉 `v` 前缀与空白，空段当 0。 */
function versionSegments(version: string): string[] {
  const plain = String(version ?? '')
    .trim()
    .replace(/^v/i, '');
  if (!plain) return [];
  return plain.split('.').map((part) => {
    const text = part.trim();
    return text === '' ? '0' : text;
  });
}

/** 是否有值得提示的更新：下载地址非空，GitHub 源还要求版本比本机构建新。 */
export function shouldPrompt(release: ReleaseLike): boolean {
  const url = String(release?.url ?? '').trim();
  if (!url) return false;
  // 直链没有版本号：只要管理员配了地址就能下载，不跟本机构建比较。
  if (release?.source !== 'github') return true;
  const version = String(release.version ?? '').trim();
  if (!version) return false;
  return compareVersions(version, currentVersion()) > 0;
}

/** 自动检查开关；未设置时按关闭处理，用户主动打开后才在后台检查。 */
export function autoUpdateEnabled(): boolean {
  return read(AUTO_UPDATE_KEY) === '1';
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  write(AUTO_UPDATE_KEY, enabled ? '1' : '0');
}

/** 上次检查的时间戳；0 表示还没检查过。 */
export function lastUpdateCheck(): number {
  const value = Number(read(LAST_CHECK_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function markUpdateChecked(at = Date.now()): void {
  write(LAST_CHECK_KEY, String(at));
}

/** 自动提示过的标记：GitHub 用版本号，直链用下载地址。 */
export function promptedUpdate(): string {
  return read(PROMPTED_KEY);
}

export function markUpdatePrompted(marker: string): void {
  const text = String(marker ?? '').trim();
  if (!text) return;
  write(PROMPTED_KEY, text);
}

/**
 * 自动提示的去重标记：GitHub 用版本号（更高版本出现时能再提示一次），
 * 直链没有版本号，用地址（换了下载地址就重新提示）。
 */
export function updateMarker(release: ReleaseLike): string {
  const version = String(release?.version ?? '').trim();
  return version || String(release?.url ?? '').trim();
}

/** 开关打开，且距上次检查超过六小时（从没检查过也算）。 */
export function shouldAutoCheck(): boolean {
  if (!autoUpdateEnabled()) return false;
  const checked = lastUpdateCheck();
  if (checked <= 0) return true;
  return Date.now() - checked >= AUTO_CHECK_INTERVAL_MS;
}
