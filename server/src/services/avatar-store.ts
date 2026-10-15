/**
 * 头像文件：校验字节、落盘、按库存 URL 删除、以及安全地解析可分发的路径。
 *
 * 文件名是 128 位随机串，调用方不能指定。只认 jpg / png / webp 这三种能由裁剪画布导出的格式。
 * 删除只处理本服务写出的 `/media/avatars/<文件>`，设备侧的旧地址在这里是空操作。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UploadConfig } from '../config/upload.js';

export const AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;
export type AvatarExtension = 'jpg' | 'png' | 'webp';

/** 长边超过这个值就拒绝：头像裁剪导出是 512，4096 足够挡住解压炸弹。 */
export const MAX_AVATAR_EDGE = 4096;

const FILE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const STORED_URL = /\/media\/avatars\/([a-f0-9]{32}\.(?:jpg|png|webp))$/;

export interface InspectedAvatar {
  extension: AvatarExtension;
  width: number;
  height: number;
}

export type AvatarInspect = { ok: true; image: InspectedAvatar } | { ok: false; reason: 'unknown' | 'too-large' };

export interface CappedRead {
  ok: boolean;
  bytes: Buffer;
}

const MIME: Record<AvatarExtension, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** 扩展名对应的响应类型。未知扩展名不会出现在已通过校验的文件上。 */
export function avatarContentType(extension: string): string {
  if (extension === 'png') return MIME.png;
  if (extension === 'webp') return MIME.webp;
  return MIME.jpg;
}

/** `jpeg` 与 `jpg` 是同一种文件。 */
export function formatAllowed(extension: AvatarExtension, formats: readonly string[]): boolean {
  const allowed = new Set(formats.map((item) => item.toLowerCase().replace(/^\./, '')));
  if (extension === 'jpg') return allowed.has('jpg') || allowed.has('jpeg');
  return allowed.has(extension);
}

/**
 * 识别图片并读出像素尺寸。
 *
 * 不信任客户端声明的 Content-Type：只看文件头。认不出、尺寸为 0 或长边超限都返回 null，
 * 由路由统一说「无法识别的图片」或「图片尺寸过大」。
 */
export function inspectAvatar(bytes: Buffer): AvatarInspect {
  const jpeg = jpegSize(bytes);
  const png = jpeg ? null : pngSize(bytes);
  const webp = jpeg || png ? null : webpSize(bytes);
  const found = jpeg
    ? { extension: 'jpg' as const, ...jpeg }
    : png
      ? { extension: 'png' as const, ...png }
      : webp
        ? { extension: 'webp' as const, ...webp }
        : null;
  if (!found || found.width < 1 || found.height < 1) return { ok: false, reason: 'unknown' };
  if (found.width > MAX_AVATAR_EDGE || found.height > MAX_AVATAR_EDGE) return { ok: false, reason: 'too-large' };
  return { ok: true, image: found };
}

/**
 * 按上限读取请求体。
 *
 * 声明长度已经超限时不读正文。没有 Content-Length 时读到上限的下一个字节就停，
 * 避免一个没有长度头的大请求把进程内存吃满。
 */
export async function readCappedBytes(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  declaredLength?: number,
): Promise<CappedRead> {
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    return { ok: false, bytes: Buffer.alloc(0) };
  }
  if (!stream) return { ok: true, bytes: Buffer.alloc(0) };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, bytes: Buffer.alloc(0) };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

/** 写入一张新头像，返回对外路径用的文件名（不含目录）。 */
export async function writeAvatarFile(
  bytes: Buffer,
  extension: AvatarExtension,
  config: UploadConfig,
): Promise<string> {
  const fileName = `${randomBytes(16).toString('hex')}.${extension}`;
  const directory = path.join(config.dir, 'avatars');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), bytes);
  return fileName;
}

/** 库存里的访问地址。没配 `MEDIA_BASE_URL` 时是站内相对路径。 */
export function storedAvatarUrl(fileName: string, config: UploadConfig): string {
  const pathname = `/media/avatars/${fileName}`;
  return config.mediaBaseUrl ? `${config.mediaBaseUrl}${pathname}` : pathname;
}

/**
 * 从库存 URL 取出文件名。
 *
 * 只接受本服务发出的路径。设备私有目录、外链和带 `..` 的字符串都返回 null，调用方不得据此删文件。
 */
export function avatarFileFromStoredUrl(url: string): string | null {
  const text = url.trim();
  if (!text) return null;
  let pathname = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      pathname = new URL(text).pathname;
    } catch {
      return null;
    }
  }
  return STORED_URL.exec(pathname)?.[1] ?? null;
}

/** 把 URL 对应的头像文件删掉。不是本服务的地址、或文件已经不在，都不当成失败。 */
export async function deleteStoredAvatar(url: string, config: UploadConfig): Promise<void> {
  const fileName = avatarFileFromStoredUrl(url);
  if (!fileName) return;
  const target = resolveAvatarFile(fileName, config);
  if (!target) return;
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') console.error('删除旧头像失败');
  });
}

/** 解析可读取的头像文件。名字不合法或逃出 `avatars/` 时返回 null。 */
export function resolveAvatarFile(fileName: string, config: UploadConfig): string | null {
  if (!FILE_NAME.test(fileName)) return null;
  const root = path.resolve(config.dir, 'avatars');
  const target = path.resolve(root, fileName);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

/** 读出一张已落盘的头像。文件不存在时返回 null。 */
export async function readAvatarFile(fileName: string, config: UploadConfig): Promise<Buffer | null> {
  const target = resolveAvatarFile(fileName, config);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (!bytes.includes(Buffer.from([0xff, 0xd9]))) return null;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  if (!bytes.subarray(bytes.length - iend.length).equals(iend)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webpSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const fourcc = bytes.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const first = bytes[21] ?? 0;
    const second = bytes[22] ?? 0;
    const third = bytes[23] ?? 0;
    const fourth = bytes[24] ?? 0;
    return {
      width: 1 + (((second & 0x3f) << 8) | first),
      height: 1 + (((fourth & 0x0f) << 10) | (third << 2) | ((second & 0xc0) >> 6)),
    };
  }
  return null;
}
