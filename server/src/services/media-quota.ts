/**
 * 存储额度的纯计算：谁先删、满了拒不拒绝，都不碰磁盘和数据库。
 *
 * 没被引用的文件先让路。仍然放不下时，才按策略决定是继续删最早的文件，还是拒绝这次上传。
 */

export type WhenFull = 'reject' | 'evict-oldest';

export interface EvictionFile {
  id: string;
  bytes: number;
  mtimeMs: number;
  /** 当前没有任何资料指向它。 */
  orphan: boolean;
}

/** `ok: false` 时 `evict` 只含为腾位置而删的无引用文件，仍被引用的文件不动。 */
export type EvictionPlan = { ok: boolean; evict: string[] };

/** 未写入正文的新文件先留一小时，避免编辑到一半被清掉。 */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const STORED_MEDIA = /\/media\/(avatars|files)\/([a-f0-9]{32}\.(?:jpg|png|webp|mp4|mov|webm))/gi;

export function normalizeWhenFull(value: unknown, fallback: WhenFull): WhenFull {
  return value === 'evict-oldest' || value === 'reject' ? value : fallback;
}

/** 从一段文字里取出本服务发出的媒体地址。外链和设备私有路径不算。 */
export function storedMediaUrls(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(STORED_MEDIA)) {
    const url = match[0];
    if (url && !found.includes(url)) found.push(url);
  }
  return found;
}

/** `avatars/<文件>` 或 `files/<文件>`。认不出就不是本服务的文件。 */
export function storedMediaKey(url: string): string | null {
  const match = /\/media\/(avatars|files)\/([a-f0-9]{32}\.(?:jpg|png|webp|mp4|mov|webm))$/i.exec(url.trim());
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}/${match[2].toLowerCase()}`;
}

/**
 * 从正文里摘掉这些地址。
 *
 * 只动图片和视频标记，周围的文字留下。地址按路径匹配，相对路径和带域名的写法都算同一份文件。
 */
export function stripStoredMedia(text: string, keys: readonly string[]): string {
  let next = text;
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const url = `/media/${escaped}`;
    next = next.replace(new RegExp(`!\\[[^\\]]*\\]\\([^)]*${url}[^)]*\\)`, 'g'), '');
    next = next.replace(new RegExp(`<video\\b[^>]*\\bsrc=["'][^"']*${url}[^"']*["'][^>]*>\\s*</video>`, 'gi'), '');
    next = next.replace(new RegExp(`<img\\b[^>]*\\bsrc=["'][^"']*${url}[^"']*["'][^>]*>`, 'gi'), '');
  }
  return next;
}

/**
 * 决定这次上传要先删哪些文件。
 *
 * 先删没人引用的，再按策略处理仍被引用的最早文件。删光了还放不下，就拒绝。
 */
export function planEviction(input: {
  used: number;
  incoming: number;
  limit: number;
  whenFull: WhenFull;
  files: EvictionFile[];
}): EvictionPlan {
  const files = [...input.files].sort((left, right) => left.mtimeMs - right.mtimeMs || left.id.localeCompare(right.id));
  const evict: string[] = [];
  let used = input.used;
  const needsRoom = () => used + input.incoming > input.limit;
  for (const file of files) {
    if (!needsRoom()) break;
    if (!file.orphan) continue;
    evict.push(file.id);
    used -= file.bytes;
  }
  if (needsRoom() && input.whenFull !== 'evict-oldest') return { ok: false, evict };
  for (const file of files) {
    if (!needsRoom()) break;
    if (evict.includes(file.id)) continue;
    evict.push(file.id);
    used -= file.bytes;
  }
  if (needsRoom()) return { ok: false, evict };
  return { ok: true, evict };
}
