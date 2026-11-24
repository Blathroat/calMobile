/**
 * 图标生成用的源图与底色配置。
 *
 * `APP_ICON` 指向仓库内或绝对路径的 PNG；不配时用 `web/public/icons/icon-1024.png`。
 * `APP_ICON_BACKGROUND` 是可选的十六进制底色，用于 PWA maskable、Apple 主屏幕
 * （仅非透明模式）、Android 自适应图标和圆角图标留白；不配时用默认强调色 `#41707e`。
 * 透明模式下 Apple 主屏幕图标有透明像素时改用黑 / 白底（见 web.mjs 的 appleTouchIcon）。
 * 构建期从 `server/.env` 与进程环境读取（见 scripts/env-file.mjs），运行时由服务端注入同名变量。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuildEnv } from '../env-file.mjs';
import { decodePng, parseHexColor } from './png.mjs';

/** 仓库根目录：脚本在 `scripts/icons/` 下，往上跳两级。 */
export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** 没配置 `APP_ICON` 时使用的设计源图。 */
export const DEFAULT_ICON = 'web/public/icons/icon-1024.png';

/** 没配置 `APP_ICON_BACKGROUND` 时使用的底色，与页面默认强调色一致。 */
export const DEFAULT_BACKGROUND = '#41707e';

/**
 * 读取源图与环境配置。
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: string, background: { r: number, g: number, b: number }, image: { width: number, height: number, data: Uint8Array } }}
 */
export function loadIconConfig(env = loadBuildEnv()) {
  const configured = String(env.APP_ICON ?? '').trim();
  const source = configured || DEFAULT_ICON;
  const absolute = path.isAbsolute(source) ? source : path.resolve(ROOT, source);
  if (!existsSync(absolute)) throw new Error(`APP_ICON 文件不存在：${absolute}`);
  const background = parseHexColor(env.APP_ICON_BACKGROUND || DEFAULT_BACKGROUND);
  return { source: absolute, background, image: decodePng(readFileSync(absolute)) };
}
