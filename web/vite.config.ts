import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
// 这两份脚本的类型来自 JSDoc，靠 tsconfig 的 allowJs 读进来。
import { pageBundleCheckPlugin } from './check-page-bundle.mjs';
import { pwaAssetsPlugin, pwaHtmlCopyPlugin, readCopy } from './pwa-build.mjs';
import { writeReleaseManifest } from './release-manifest.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

// 与 Gradle 读同一份脚本，避免在这里再解析一遍 .env。
const clientTarget = JSON.parse(
  execFileSync('node', ['scripts/client-target.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  }),
) as { apiBase: string; versionCode: number; versionName: string };

// 开发服务器只把 /api、/media 代理到后端；构建产物里不写这个地址。
const devApiOrigin = new URL(clientTarget.apiBase).origin;

const pwaCopy = readCopy();
const pwaEnv: Record<string, string> = {};

/**
 * 安装元信息按构建模式读 `web/.env*` 里的 `PWA_*`。
 *
 * 这份配置必须保持对象形式：`vitest.config.ts` 用 `mergeConfig` 合并它，而
 * `mergeConfig` 不接受回调形式的配置，所以拿 `mode` 只能放在插件的 `config`
 * 钩子里——它跑在所有构建钩子之前，填好的 `pwaEnv` 后续插件都能读到。
 */
function pwaEnvironment(): Plugin {
  return {
    name: 'calmobile-pwa-env',
    config(_config, { mode }) {
      Object.assign(pwaEnv, loadEnv(mode, root, ''));
      return {
        define: {
          // 空串表示没有覆盖，页面标题回落到 zh.json 的 app.documentTitle。
          __PWA_APP_NAME_OVERRIDE__: JSON.stringify(pwaEnv.PWA_APP_NAME ?? ''),
        },
      };
    },
  };
}

function releaseManifest(): Plugin {
  return {
    name: 'calmobile-release-manifest',
    apply: 'build',
    closeBundle() {
      writeReleaseManifest(fileURLToPath(new URL('./dist', import.meta.url)));
    },
  };
}

export default defineConfig({
  // 正式包把页面挂在站点的 /app/，WebView 再拦截到本机快照。前缀必须一致。
  base: '/app/',
  define: {
    // 应用版本来自与 Gradle 同一份构建目标（scripts/client-target.mjs）。
    // 页面用它判断「有没有新版本」，与 APK 的 versionName 保持一致。
    __APP_VERSION__: JSON.stringify(clientTarget.versionName),
    __APP_VERSION_CODE__: JSON.stringify(clientTarget.versionCode),
  },
  server: {
    // 页面包固定用相对 `/api/v1`；只有开发服务器需要把请求转给后端。
    // 生产由同一个服务端托管页面与 API，不需要代理，页面包也不含域名。
    proxy: {
      '/api': { target: devApiOrigin, changeOrigin: true },
      '/media': { target: devApiOrigin, changeOrigin: true },
    },
  },
  plugins: [
    vue(),
    pwaHtmlCopyPlugin({ copy: pwaCopy, env: pwaEnv, includePwa: true }),
    pwaAssetsPlugin({ distDir: fileURLToPath(new URL('./dist', import.meta.url)), env: pwaEnv, copy: pwaCopy }),
    releaseManifest(),
    // `writeBundle` 覆盖 watch 每次重建，`closeBundle` 再检查 pwaAssets 最后写出的文件。
    pageBundleCheckPlugin({ distDir: fileURLToPath(new URL('./dist', import.meta.url)) }),
    // 只提供 config 钩子（读 PWA_* 并注入 __PWA_APP_NAME_OVERRIDE__），没有构建钩子，
    // 放在末尾不影响上面四个插件的执行顺序。
    pwaEnvironment(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@domain/answer-document': fileURLToPath(new URL('../server/src/domain/answer-document.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
