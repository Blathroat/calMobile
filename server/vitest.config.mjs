import { defineConfig } from 'vitest/config';

/**
 * 双 project：unit 不碰数据库，contract 连真实 PostgreSQL。
 * 「要不要数据库」写在这里，脚本只负责选 project。
 */
export default defineConfig({
  test: {
    pool: 'forks',
    exclude: ['dist/**', 'node_modules/**'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.js'],
          environment: 'node',
          globals: true,
          setupFiles: ['./test/setup-unit.js'],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['test/api.test.js'],
          environment: 'node',
          globals: true,
          setupFiles: ['./test/setup-contract.js'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
