/**
 * 从一个方形 PNG 源图生成站点、PWA 和 Android 用的全部图标。
 *
 * 源图是可选项：`APP_ICON` 指向仓库内或绝对路径的 PNG；不配时用
 * `web/public/icons/icon-1024.png`。`APP_ICON_BACKGROUND` 是可选的十六进制底色，
 * 用于 PWA maskable、Apple 主屏幕、Android 自适应图标和圆角图标留白；不配时用
 * 默认强调色 `#41707e`。`APP_ICON_TRANSPARENT=1` 时不铺底色，并且 Android
 * 不生成 adaptive 图标（启动器可能把透明背景渲染成黑底）。
 *
 * 实现拆在 `scripts/icons/`：
 * - png.mjs：PNG 编解码、颜色解析、缩放渲染与 ICO 组装（纯函数，只用 zlib）；
 * - config.mjs：仓库根、默认源图 / 底色与 `loadIconConfig`；
 * - web.mjs：站点 / PWA 图标；
 * - android.mjs：Gradle 用的 Android 启动图标。
 *
 * 本文件保留原来的公开 API（`web/pwa-build.mjs`、服务端运行时品牌层、Gradle 与
 * `scripts/build-icons.test.mjs` 都从这里 import），命令行按 `--target` 动态加载对应模块。
 *
 * 产物分两处：
 * - 站点 / PWA：`web/dist/icons/*.png`（含 1024）与 `web/dist/favicon.ico`，构建后由服务端托管；
 *   `web/public/icons/` 里保留默认图标，开发服务器仍能直接打开。
 * - Android：`app/build/generated/icons/res/`，由 Gradle 的 `buildIcons` 任务生成，
 *   再作为额外的资源目录参与打包。透明模式不生成 `mipmap-anydpi-v26`。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuildEnv } from './env-file.mjs';
import { ROOT } from './icons/config.mjs';

export { DEFAULT_BACKGROUND, DEFAULT_ICON, ROOT, loadIconConfig } from './icons/config.mjs';
export { buildAndroidIcons } from './icons/android.mjs';
export { buildWebIcons } from './icons/web.mjs';
export { decodePng, encodeIco, encodePng, parseHexColor, renderIcon } from './icons/png.mjs';

/**
 * @param {string[]} argv
 */
async function main(argv) {
  let target = 'all';
  let out = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      target = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--out') {
      out = argv[index + 1] ?? '';
      index += 1;
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  if (!['web', 'android', 'all'].includes(target)) throw new Error(`--target 必须是 web / android / all：${target}`);
  if (target === 'all' && out) throw new Error('--target all 不能和 --out 一起用：站点图标和 Android 资源的目录不同');
  const env = loadBuildEnv();
  if (target === 'web' || target === 'all') {
    const { buildWebIcons } = await import('./icons/web.mjs');
    const result = buildWebIcons(out || path.join(ROOT, 'web', 'dist'), env);
    process.stdout.write(`站点 / PWA 图标已生成：${result.background}（${result.source}）\n`);
  }
  if (target === 'android' || target === 'all') {
    const { buildAndroidIcons } = await import('./icons/android.mjs');
    const result = buildAndroidIcons(out || path.join(ROOT, 'app', 'build', 'generated', 'icons', 'res'), env);
    process.stdout.write(`Android 图标已生成：${result.background}（${result.source}）\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
