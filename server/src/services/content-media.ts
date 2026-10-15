/**
 * 展会封面和简介里的图片、视频：校验字节、落盘、按库存 URL 读出。
 *
 * 文件名是 128 位随机串。图片只认文件头，视频只认 webm 头或 MP4/MOV 的 ftyp。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UploadConfig } from '../config/upload.js';
import { formatAllowed, inspectAvatar } from './avatar-store.js';
import { resolveUploadFile, type UploadBucket } from './upload-files.js';

export type ContentKind = 'image' | 'video';

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function contentContentType(extension: string): string {
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'mp4' || extension === 'mov' || extension === 'webm')
    return VIDEO_MIME[extension] ?? 'application/octet-stream';
  return 'image/jpeg';
}

/** 视频文件头。认不出就拒绝，避免把任意字节存成 mp4。 */
export function sniffVideo(bytes: Buffer): 'webm' | 'mp4' | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'webm';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  return null;
}

export type ContentInspect =
  | { ok: true; extension: string }
  | { ok: false; reason: 'unknown' | 'too-large' | 'format' };

/**
 * 按种类识别文件，并对照服务器允许的后缀。
 *
 * 图片沿用头像的文件头检查。视频不看客户端声明的 Content-Type。
 */
export function inspectContent(bytes: Buffer, kind: ContentKind, formats: readonly string[]): ContentInspect {
  if (kind === 'image') {
    const image = inspectAvatar(bytes);
    if (!image.ok) return image;
    if (!formatAllowed(image.image.extension, formats)) return { ok: false, reason: 'format' };
    return { ok: true, extension: image.image.extension };
  }
  const sniffed = sniffVideo(bytes);
  if (!sniffed) return { ok: false, reason: 'unknown' };
  const extension =
    sniffed === 'webm' ? 'webm' : formats.map((item) => item.toLowerCase()).includes('mp4') ? 'mp4' : 'mov';
  if (!formats.map((item) => item.toLowerCase()).includes(extension)) return { ok: false, reason: 'format' };
  return { ok: true, extension };
}

export async function writeContentFile(bytes: Buffer, extension: string, config: UploadConfig): Promise<string> {
  const fileName = `${randomBytes(16).toString('hex')}.${extension}`;
  const directory = path.join(config.dir, 'files');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), bytes);
  return fileName;
}

export function storedContentUrl(fileName: string, config: UploadConfig): string {
  const pathname = `/media/files/${fileName}`;
  return config.mediaBaseUrl ? `${config.mediaBaseUrl}${pathname}` : pathname;
}

export async function readContentFile(fileName: string, config: UploadConfig): Promise<Buffer | null> {
  const target = resolveUploadFile('files', fileName, config);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function bucketOfKey(key: string): { bucket: UploadBucket; name: string } | null {
  const match = /^(avatars|files)\/([a-f0-9]{32}\.(?:jpg|png|webp|mp4|mov|webm))$/.exec(key);
  if (!match?.[1] || !match[2]) return null;
  return { bucket: match[1] as UploadBucket, name: match[2] };
}
