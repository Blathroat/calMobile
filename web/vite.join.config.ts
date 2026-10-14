import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

// 必须在 Vite 读取环境之前写上：报名站构建据此切路径、导航和接口基址。
// App 的 `vite.config.ts` 不设置它，两份产物互不影响。
process.env.VITE_SURFACE = 'join';

const root = fileURLToPath(new URL('.', import.meta.url));
const stringsFile = fileURLToPath(new URL('../app/src/main/res/values/strings_frontend.xml', import.meta.url));

/** 报名站没有 Android 注入。构建时把同一份文案表写进页面，`t()` 才能读到中文。 */
function joinStrings(): Plugin {
  return {
    name: 'join-strings',
    transformIndexHtml(html) {
      const xml = readFileSync(stringsFile, 'utf8');
      const table: Record<string, string> = {};
      for (const match of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
        table[match[1]] = match[2]
          .replace(/\\'/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      }
      const script = `<script>window.CalMobileStrings=${JSON.stringify(table)};</script>`;
      return html.replace('</head>', `${script}\n  </head>`);
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  plugins: [vue(), joinStrings()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
