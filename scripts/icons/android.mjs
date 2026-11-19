/**
 * Android 启动图标生成：把源图写进 Gradle 的额外资源目录。
 *
 * 由 Gradle 的 `buildIcons` 任务在 `preBuild` 时调用，产物是
 * `app/build/generated/icons/res/` 下的 legacy / round / adaptive foreground 资源，
 * 再作为额外资源目录参与打包，所以各密度 PNG 不用入库。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBuildEnv } from '../env-file.mjs';
import { loadIconConfig } from './config.mjs';
import { encodePng, hexColor, renderIcon } from './png.mjs';

/** Android 启动图标与自适应前景图的密度档位。 */
export const ANDROID_DENSITIES = [
  { name: 'mdpi', legacy: 48, foreground: 108 },
  { name: 'hdpi', legacy: 72, foreground: 162 },
  { name: 'xhdpi', legacy: 96, foreground: 216 },
  { name: 'xxhdpi', legacy: 144, foreground: 324 },
  { name: 'xxxhdpi', legacy: 192, foreground: 432 },
];

/**
 * 生成 Android 启动图标、圆角图标与自适应图标前景，写进 Gradle 的资源目录。
 * `APP_ICON_TRANSPARENT=1` 时不铺底色，也不生成 adaptive 图标。
 * @param {string} outDir `app/build/generated/icons/res`
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: string, background: string }}
 */
export function buildAndroidIcons(outDir, env = loadBuildEnv()) {
  const config = loadIconConfig(env);
  const transparent = String(env.APP_ICON_TRANSPARENT ?? '') === '1';
  const background = transparent ? null : config.background;
  rmSync(outDir, { recursive: true, force: true });
  const png = (size, options = {}) => encodePng(renderIcon(config.image, size, { ...options, background }));
  for (const density of ANDROID_DENSITIES) {
    const dir = path.join(outDir, `mipmap-${density.name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'ic_launcher.png'), png(density.legacy));
    writeFileSync(path.join(dir, 'ic_launcher_round.png'), png(density.legacy, { circle: true }));
    writeFileSync(
      path.join(dir, 'ic_launcher_foreground.png'),
      encodePng(renderIcon(config.image, density.foreground, { scale: 0.6 })),
    );
  }
  if (!transparent) {
    const adaptiveDir = path.join(outDir, 'mipmap-anydpi-v26');
    mkdirSync(adaptiveDir, { recursive: true });
    const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n`;
    writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), adaptive);
    writeFileSync(path.join(adaptiveDir, 'ic_launcher_round.xml'), adaptive);
    const valuesDir = path.join(outDir, 'values');
    mkdirSync(valuesDir, { recursive: true });
    writeFileSync(
      path.join(valuesDir, 'ic_launcher_background.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hexColor(config.background)}</color>\n</resources>\n`,
    );
  }
  return { source: config.source, background: transparent ? 'transparent' : hexColor(config.background) };
}
