/**
 * 数据库迁移运行器与命令行入口。
 *
 * 迁移按步骤编号记录在 `schema_migrations` 表里，只跑没跑过的步骤，
 * 因此可以反复执行（`pnpm db:migrate` 是幂等的），新增字段时往后追加一步即可，
 * 不要去改已经发布过的步骤。
 *
 * 拆分后的位置：
 * - `./default-settings.ts`：`ServerSettings`、`DEFAULT_SETTINGS`、`THEME_COLORS`；
 * - `./migrations/`：迁移步骤，按年代/主题分模块，`index.ts` 汇总成 `STEPS`；
 * - `./seed.ts`：开发库示例数据。
 *
 * 本文件只留运行器与入口判断，并把上面这些符号原样转出，原先从 `config/migrate.js`
 * 导入 `STEPS` / `DEFAULT_SETTINGS` / `ServerSettings` 的模块不用改。
 *
 * 约定：
 * - 状态一律存**英文代码**（pending / approved / review / optional …），
 *   中文标签只在 `src/domain/labels.ts` 里映射一次；
 * - 展会日期只存 `exhibition_date`，年 / 月 / 日由 SQL 派生，避免三者互相漂移；
 * - 报名记录不冗余展会标题、时间、地点，读取时 JOIN 展会表，避免展会改期后两边不一致。
 */

// 运行环境要先定下来：迁移脚本也要能对着生产库跑（`pnpm db:migrate:prod`），
// 而 pool 在 require 的那一刻就按 NODE_ENV 选好库了（见 config/runtime.ts）。
import * as runtime from './runtime.js';
import { pool } from './pool.js';
import type { PoolClient } from 'pg';
import * as dbConfig from './database.js';
import { isEntry } from '../entry.js';
import { STEPS } from './migrations/index.js';
import { THEME_COLORS } from './default-settings.js';
import { seed } from './seed.js';

// 兼容导出：拆分前这些符号都从本文件导出，调用方直接 import '../config/migrate.js'，
// 这里原样转出，domain/*、routes/status.ts、src/test/* 与契约测试都不用改。
export { STEPS, seed, THEME_COLORS };
export { DEFAULT_SETTINGS } from './default-settings.js';
export type { MigrationStep } from './migrations/types.js';
export type { ServerSettings } from './default-settings.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建迁移记录表，返回已应用的步骤 id。 */
async function appliedSteps(client: PoolClient): Promise<Set<string>> {
  await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id          TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
  const result = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
}

/** 执行未应用的迁移步骤；每一步各自一个事务，失败即回滚。 */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    const applied = await appliedSteps(client);
    const pending = STEPS.filter((step) => !applied.has(step.id));
    if (pending.length === 0) {
      console.log('数据库结构已是最新，没有需要执行的迁移');
      return;
    }
    for (const step of pending) {
      await client.query('BEGIN');
      try {
        // 带 params 的步骤按扩展协议发送（见 MigrationStep.params 的说明）。
        if (step.params) {
          await client.query(step.sql, [...step.params(THEME_COLORS)]);
        } else {
          await client.query(step.sql);
        }
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [step.id]);
        await client.query('COMMIT');
        console.log(`迁移完成：${step.id}`);
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        console.error(`迁移失败：${step.id}`, errorMessage(error));
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

// 只在直接执行本文件时跑迁移（`tsx src/config/migrate.ts` / `node dist/config/migrate.js`）；
// 被别的模块 import（`routes/status.ts` 读 STEPS、`domain/settings.ts` 读 DEFAULT_SETTINGS）时不动。
if (isEntry(import.meta.url)) {
  const command = process.argv[2];
  const run = command === 'seed' ? seed : command === 'migrate' ? migrate : null;
  if (!run) {
    console.log('用法：tsx src/config/migrate.ts [migrate|seed] [--production]');
    process.exit(1);
  }
  // 打印目标库：迁移是不可逆操作，别对着错的库跑完才发现。
  console.log(`[${runtime.nodeEnv}] 目标库 ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  run()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
