/**
 * 上传目录的占用、清理和腾挪。
 *
 * 没人引用、或文件已经不在的图片和视频会删掉。刚上传、还没写进正文的文件留一小时。
 * 存储满了以后，按设置先清无引用文件；仍满则清最早的，或直接拒绝新上传。
 */

import { query } from '../config/pool.js';
import { resolveUploadConfig } from '../config/upload.js';
import { badRequest } from '../domain/errors.js';
import { readServerSettings } from '../domain/settings.js';
import {
  ORPHAN_GRACE_MS,
  planEviction,
  storedMediaKey,
  storedMediaUrls,
  stripStoredMedia,
  type WhenFull,
} from './media-quota.js';
import { bucketOfKey } from './content-media.js';
import { deleteUploadFile, listUploadFiles, uploadFileKey, type UploadFile } from './upload-files.js';

interface TextRow {
  description: string;
  image_uri: string;
}

interface AvatarRow {
  avatar: string;
}

interface CoverRow {
  value: { defaultCover?: unknown } | null;
}

export interface StorageReport {
  usedBytes: number;
  limitBytes: number;
  whenFull: WhenFull;
  fileCount: number;
}

/** 库里仍指向这些文件的地址。键是 `avatars/<文件>` 或 `files/<文件>`。 */
async function referencedKeys(): Promise<Set<string>> {
  const [exhibitions, avatars, cover] = await Promise.all([
    query<TextRow>('SELECT description, image_uri FROM exhibitions'),
    query<AvatarRow>("SELECT avatar FROM users WHERE avatar <> ''"),
    query<CoverRow>("SELECT value FROM app_settings WHERE key = 'cover'"),
  ]);
  const keys = new Set<string>();
  const take = (text: string) => {
    const whole = storedMediaKey(text);
    if (whole) keys.add(whole);
    for (const url of storedMediaUrls(text)) {
      const key = storedMediaKey(url);
      if (key) keys.add(key);
    }
  };
  for (const row of exhibitions.rows) {
    take(row.description || '');
    take(row.image_uri || '');
  }
  for (const row of avatars.rows) take(row.avatar || '');
  const defaultCover = cover.rows[0]?.value?.defaultCover;
  if (typeof defaultCover === 'string') take(defaultCover);
  return keys;
}

function withoutKeys(text: string, keys: readonly string[]): string {
  const keySet = new Set(keys);
  const whole = storedMediaKey(text.trim());
  if (whole && keySet.has(whole)) return '';
  return stripStoredMedia(text, keys);
}

/** 把已经打不开的地址从展会简介、封面、头像和缺省封面里拿掉。 */
async function stripMissing(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const exhibitions = await query<TextRow & { id: string }>('SELECT id, description, image_uri FROM exhibitions');
  for (const row of exhibitions.rows) {
    const description = withoutKeys(row.description || '', keys);
    const imageUri = withoutKeys(row.image_uri || '', keys);
    if (description === (row.description || '') && imageUri === (row.image_uri || '')) continue;
    await query('UPDATE exhibitions SET description = $2, image_uri = $3, updated_at = now() WHERE id = $1', [
      row.id,
      description,
      imageUri,
    ]);
  }
  const avatars = await query<AvatarRow & { id: string }>("SELECT id, avatar FROM users WHERE avatar <> ''");
  for (const row of avatars.rows) {
    const avatar = withoutKeys(row.avatar || '', keys);
    if (avatar === row.avatar) continue;
    await query('UPDATE users SET avatar = $2, updated_at = now() WHERE id = $1', [row.id, avatar]);
  }
  const cover = await query<CoverRow>("SELECT value FROM app_settings WHERE key = 'cover'");
  const value = cover.rows[0]?.value;
  const current = typeof value?.defaultCover === 'string' ? value.defaultCover : '';
  const nextCover = withoutKeys(current, keys);
  if (nextCover !== current && value && typeof value === 'object') {
    await query(`UPDATE app_settings SET value = $2, updated_at = now() WHERE key = 'cover'`, [
      'cover',
      JSON.stringify({ ...value, defaultCover: nextCover }),
    ]);
  }
}

/**
 * 删掉没人引用、且已超过宽限的文件；正文里指向缺失文件的地址一并摘掉。
 */
export async function sweepMedia(now = Date.now()): Promise<void> {
  const config = resolveUploadConfig();
  const files = await listUploadFiles(config);
  const present = new Set(files.map((file) => uploadFileKey(file.bucket, file.name)));
  const referenced = await referencedKeys();
  const missing = [...referenced].filter((key) => !present.has(key));
  await stripMissing(missing);
  const stillReferenced = missing.length > 0 ? await referencedKeys() : referenced;
  for (const file of files) {
    const key = uploadFileKey(file.bucket, file.name);
    if (stillReferenced.has(key)) continue;
    if (now - file.mtimeMs < ORPHAN_GRACE_MS) continue;
    await deleteUploadFile(file.bucket, file.name, config);
  }
}

/**
 * 这些文字里出现过、但库里已经不再引用的文件立刻删除。
 *
 * 给「刚从简介或封面里拿掉」用。宽限只保护还没写进库的新上传。
 */
export async function forgetTexts(texts: readonly string[]): Promise<void> {
  const keys = new Set<string>();
  for (const text of texts) {
    const whole = storedMediaKey(text);
    if (whole) keys.add(whole);
    for (const url of storedMediaUrls(text)) {
      const key = storedMediaKey(url);
      if (key) keys.add(key);
    }
  }
  if (keys.size === 0) return;
  const referenced = await referencedKeys();
  const config = resolveUploadConfig();
  for (const key of keys) {
    if (referenced.has(key)) continue;
    const parsed = bucketOfKey(key);
    if (!parsed) continue;
    await deleteUploadFile(parsed.bucket, parsed.name, config);
  }
}

/** 展会保存或删除之后：旧正文里不再被引用的文件马上清掉，再做一轮常规清理。 */
export async function releaseExhibitionMedia(previous: {
  description?: string | null;
  image_uri?: string | null;
}): Promise<void> {
  try {
    await forgetTexts([previous.description || '', previous.image_uri || '']);
    await sweepMedia();
  } catch {
    console.error('清理未引用媒体失败');
  }
}

/** 为新文件腾位置。文件本身大于总上限，或放不下且策略是拒绝时，抛出业务错误。 */
export async function ensureRoom(incomingBytes: number): Promise<void> {
  await sweepMedia();
  const settings = await readServerSettings();
  const limit = settings.upload.storageMb * 1024 * 1024;
  // 新文件比整个上限还大时，删旧文件也放不下，所以一份都不删。
  if (incomingBytes > limit) throw badRequest('存储空间已满，已停止新上传');
  const config = resolveUploadConfig();
  const files = await listUploadFiles(config);
  const referenced = await referencedKeys();
  const used = files.reduce((sum, file) => sum + file.bytes, 0);
  const plan = planEviction({
    used,
    incoming: incomingBytes,
    limit,
    whenFull: settings.upload.whenFull,
    files: files.map((file) => ({
      id: uploadFileKey(file.bucket, file.name),
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
      orphan: !referenced.has(uploadFileKey(file.bucket, file.name)),
    })),
  });
  if (plan.evict.length > 0) {
    for (const key of plan.evict) {
      const parsed = bucketOfKey(key);
      if (parsed) await deleteUploadFile(parsed.bucket, parsed.name, config);
    }
    await stripMissing(plan.evict);
  }
  if (!plan.ok) throw badRequest('存储空间已满，已停止新上传');
}

/** 管理员看到的占用。先清一轮，条上的数字不把过期垃圾算进去。 */
export async function storageReport(): Promise<StorageReport> {
  await sweepMedia();
  const settings = await readServerSettings();
  const files = await listUploadFiles(resolveUploadConfig());
  return reportFrom(files, settings.upload.storageMb, settings.upload.whenFull);
}

function reportFrom(files: UploadFile[], storageMb: number, whenFull: WhenFull): StorageReport {
  return {
    usedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    limitBytes: storageMb * 1024 * 1024,
    whenFull,
    fileCount: files.length,
  };
}
