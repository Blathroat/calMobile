import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
// 这份脚本的类型来自 JSDoc，靠 tsconfig 的 allowJs 读进来。
import { writeReleaseManifest } from './release-manifest.mjs';

// 与 Gradle 读同一份脚本，避免在这里再解析一遍 .env。
const clientTarget = JSON.parse(
  execFileSync('node', ['scripts/client-target.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  }),
) as { apiBase: string; versionCode: number; versionName: string };

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
    'import.meta.env.VITE_API_BASE': JSON.stringify(clientTarget.apiBase),
    // 应用版本来自与 Gradle 同一份构建目标（scripts/client-target.mjs）。
    // 页面用它判断「有没有新版本」，与 APK 的 versionName 保持一致。
    __APP_VERSION__: JSON.stringify(clientTarget.versionName),
    __APP_VERSION_CODE__: JSON.stringify(clientTarget.versionCode),
  },
  plugins: [vue(), releaseManifest()],
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
