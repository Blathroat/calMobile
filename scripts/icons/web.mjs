/**
 * 站点 / PWA 图标：把源图生成到构建目录。
 *
 * 产物是 `<dist>/favicon.ico`（16/32/48 三个 PNG 条目）与 `<dist>/icons/*.png`，
 * 由 `web/pwa-build.mjs` 在 `pnpm --dir web build` 时调用，服务端运行时的品牌层
 * 也按同一套尺寸生成实例图标。
 *
 * 透明底对 iOS 主屏幕图标不成立：Safari 会把透明像素画成黑底。因此这一枚在渲染出透明像素时
 * 会补一层不透明底——底色跟着图标的深浅走（偏深铺黑、偏浅铺白），与图标本身的色系一致，
 * 不用品牌底色，避免桌面上出现一块跟图标不搭的色板。其它站点 / PWA 图标仍按设置保留透明底。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBuildEnv } from '../env-file.mjs';
import { loadIconConfig } from './config.mjs';
import { encodeIco, encodePng, hasTransparency, hexColor, renderIcon, visibleLuminance } from './png.mjs';

/** 图标补底用的黑 / 白。偏深铺黑、偏浅铺白。 */
const DARK_PLATE = { r: 0, g: 0, b: 0 };
const LIGHT_PLATE = { r: 255, g: 255, b: 255 };
/** 可见像素的平均亮度高于它就算「浅色图标」（0–1）。 */
const LIGHT_ICON_THRESHOLD = 0.5;

/**
 * iOS 主屏幕图标（180×180）。
 *
 * 普通模式已经铺了 `APP_ICON_BACKGROUND`，源图也有透明像素时同样由它兜住，结果不透明，
 * 原样返回。透明模式下渲染出来的图标如果还有透明像素，就按图标深浅重渲染一层黑 / 白底：
 * 深色图标铺黑、浅色图标铺白（整张全透明这种异常源图按深色处理）。
 */
function appleTouchIcon(config, background) {
  const icon = renderIcon(config.image, 180, { background });
  if (!hasTransparency(icon)) return icon;
  const luminance = visibleLuminance(icon);
  const plate = luminance !== null && luminance >= LIGHT_ICON_THRESHOLD ? LIGHT_PLATE : DARK_PLATE;
  return renderIcon(config.image, 180, { background: plate });
}

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
  // iOS 主屏幕图标不能留透明像素：有就按图标深浅补黑 / 白底（见 appleTouchIcon）。
  writeFileSync(path.join(iconsDir, 'apple-touch-icon-180.png'), encodePng(appleTouchIcon(config, background)));
  writeFileSync(path.join(iconsDir, 'favicon-32.png'), png(32));
  writeFileSync(path.join(distDir, 'favicon.ico'), encodeIco([16, 32, 48].map((size) => ({ size, png: png(size) }))));
  return { source: config.source, background: transparent ? 'transparent' : hexColor(config.background) };
}
