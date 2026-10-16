import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      // jsdom 的创建是这份用例集的主要开销：一个 worker 复用一个环境，
      // 而不是每个用例文件重建一次。
      pool: 'vmThreads',
    },
  }),
);
