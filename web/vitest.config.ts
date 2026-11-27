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
      // 页面级用例要挂载整页、等取数与动画帧，并行跑或慢机器上偶发超过 5s 默认值。
      // 这里统一放宽，用例里不要再单独写超时（`vi.setConfig` / 第三个参数）。
      testTimeout: 15_000,
      hookTimeout: 30_000,
    },
  }),
);
