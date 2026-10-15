/**
 * 上传目录里的文件清单。
 *
 * 头像在 `avatars/`，展会封面和简介媒体在 `files/`。文件名都是服务端生成的随机串，
 * 调用方给的路径不能用来读或删。
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { UploadConfig } from '../config/upload.js';

export type UploadBucket = 'avatars' | 'files';

export interface UploadFile {
  bucket: UploadBucket;
  name: string;
  bytes: number;
  mtimeMs: number;
}

const NAMES: Record<UploadBucket, RegExp> = {
  avatars: /^[a-f0-9]{32}\.(jpg|png|webp)$/,
  files: /^[a-f0-9]{32}\.(jpg|png|webp|mp4|mov|webm)$/,
};

export function uploadFileKey(bucket: UploadBucket, name: string): string {
  return `${bucket}/${name}`;
}

/** 只接受本目录下的单层合法文件名。 */
export function resolveUploadFile(bucket: UploadBucket, name: string, config: UploadConfig): string | null {
  if (!NAMES[bucket].test(name)) return null;
  const root = path.resolve(config.dir, bucket);
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

export async function listUploadFiles(config: UploadConfig): Promise<UploadFile[]> {
  const files: UploadFile[] = [];
  for (const bucket of ['avatars', 'files'] as const) {
    const directory = path.join(config.dir, bucket);
    let names: string[] = [];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const name of names) {
      if (!NAMES[bucket].test(name)) continue;
      const target = resolveUploadFile(bucket, name, config);
      if (!target) continue;
      const info = await stat(target);
      if (!info.isFile()) continue;
      files.push({ bucket, name, bytes: info.size, mtimeMs: info.mtimeMs });
    }
  }
  return files;
}

/** 文件已经不在时不当成失败。 */
export async function deleteUploadFile(bucket: UploadBucket, name: string, config: UploadConfig): Promise<void> {
  const target = resolveUploadFile(bucket, name, config);
  if (!target) return;
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') console.error('删除上传文件失败');
  });
}
