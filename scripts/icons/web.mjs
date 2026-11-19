/**
 * 站点 / PWA 图标：把源图生成到构建目录。
 *
 * 产物是 `<dist>/favicon.ico`（16/32/48 三个 PNG 条目）与 `<dist>/icons/*.png`，
 * 由 `web/pwa-build.mjs` 在 `pnpm --dir web build` 时调用，服务端运行时的品牌层
 * 也按同一套尺寸生成实例图标。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBuildEnv } from '../env-file.mjs';
import { loadIconConfig } from './config.mjs';
import { encodeIco, encodePng, hexColor, renderIcon } from './png.mjs';

/**
 * 生成站点与 PWA 图标到构建目录。
 * @param {string} distDir `web/dist`
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: string, background: string }}
 */
export function buildWebIcons(distDir, env = loadBuildEnv()) {
  const config = loadIconConfig(env);
  const transparent = String(env.APP_ICON_TRANSPARENT ?? '') === '1';
  const background = transparent ? null : config.background;
  const iconsDir = path.join(distDir, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  const png = (size, options = {}) => encodePng(renderIcon(config.image, size, { ...options, background }));
  writeFileSync(path.join(iconsDir, 'icon-192.png'), png(192));
  writeFileSync(path.join(iconsDir, 'icon-512.png'), png(512));
  writeFileSync(path.join(iconsDir, 'icon-1024.png'), png(1024));
  writeFileSync(path.join(iconsDir, 'maskable-512.png'), png(512, { scale: 0.8 }));
  writeFileSync(path.join(iconsDir, 'apple-touch-icon-180.png'), png(180));
  writeFileSync(path.join(iconsDir, 'favicon-32.png'), png(32));
  writeFileSync(path.join(distDir, 'favicon.ico'), encodeIco([16, 32, 48].map((size) => ({ size, png: png(size) }))));
  return { source: config.source, background: transparent ? 'transparent' : hexColor(config.background) };
}
