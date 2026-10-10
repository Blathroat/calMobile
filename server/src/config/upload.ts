/**
 * 头像上传的进程配置。
 *
 * 纯函数：调用方把环境对象传进来。不传时读当前 `process.env`，因此测试可以在请求前改目录，
 * 不必重启进程。三个名字与 `docs/operations.md` 一致。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 与 `upload.avatarSizeMb` 的上限对齐：再大的传输硬顶也没有意义。 */
export const UPLOAD_HARD_CAP_MB = 20;

const DEFAULT_DIR = fileURLToPath(new URL('../../data/uploads', import.meta.url));

export interface UploadConfig {
  /** 落盘根目录。头像文件在其下的 `avatars/`。 */
  dir: string;
  /** 对外绝对前缀。空字符串表示库存相对路径 `/media/avatars/...`。 */
  mediaBaseUrl: string;
  /** 单文件传输硬顶（MB），实际头像上限再与 `avatarSizeMb` 取较小值。 */
  maxMb: number;
}

/**
 * @param env 形如 `process.env`。
 */
export function resolveUploadConfig(env: EnvLike = process.env): UploadConfig {
  const configured = String(env.UPLOAD_DIR || '').trim();
  const rawBase = String(env.MEDIA_BASE_URL || '').trim().replace(/\/+$/, '');
  const max = Number(env.UPLOAD_MAX_MB);
  return {
    dir: configured ? path.resolve(configured) : DEFAULT_DIR,
    mediaBaseUrl: /^https?:\/\/[^/]+$/i.test(rawBase) ? rawBase : '',
    maxMb: Number.isFinite(max) && max >= 1 ? Math.min(max, UPLOAD_HARD_CAP_MB) : UPLOAD_HARD_CAP_MB,
  };
}
