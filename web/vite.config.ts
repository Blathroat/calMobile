import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 与 Gradle 读同一份脚本，避免在这里再解析一遍 .env。
const clientTarget = JSON.parse(
  execFileSync('node', ['scripts/client-target.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  }),
) as { apiBase: string };

export default defineConfig({
  // Android WebView 只从 /assets/web/ 提供打包资源，必须让 Vite 生成同一前缀。
  base: '/assets/web/',
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(clientTarget.apiBase),
  },
  plugins: [vue()],
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
