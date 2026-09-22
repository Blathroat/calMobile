import { defineConfig } from 'vitest/config';

/**
 * 双 project：unit 不碰数据库，contract 连真实 PostgreSQL。
 * 「要不要数据库」写在这里，脚本只负责选 project。
 *
 * 契约测试在 `src/test/` 下（见 ADR 0001「目录结构」），与 unit 单测同处 src 但分开 project：
 * unit 项目用 exclude 把它排除，contract 项目只收 src/test 下的用例。
 */
export default defineConfig({
  test: {
    pool: 'forks',
    exclude: ['dist/**', 'node_modules/**'],
    server: {
      deps: {
        inline: [/src[\\/]/],
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.js', 'src/**/*.test.ts'],
          exclude: ['dist/**', 'node_modules/**', 'src/test/**'],
          environment: 'node',
          globals: true,
          execArgv: ['--import', 'tsx'],
          setupFiles: ['./test/setup-unit.js'],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['src/test/**/*.test.ts'],
          environment: 'node',
          globals: true,
          execArgv: ['--import', 'tsx'],
          setupFiles: ['./test/setup-contract.js'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
