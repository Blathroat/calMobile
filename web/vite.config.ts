import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { writeReleaseManifest } from './release-manifest.mjs';

// 与 Gradle 读同一份脚本，避免在这里再解析一遍 .env。
const clientTarget = JSON.parse(
  execFileSync('node', ['scripts/client-target.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  }),
) as { apiBase: string };

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
