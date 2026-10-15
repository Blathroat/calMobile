import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 必须在 Vite 读取环境之前写上：报名站构建据此切路径、导航和接口基址。
// App 的 `vite.config.ts` 不设置它，两份产物互不影响。
process.env.VITE_SURFACE = 'join';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@domain/answer-document': fileURLToPath(new URL('../server/src/domain/answer-document.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-join',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./join.html', import.meta.url)),
    },
  },
});
