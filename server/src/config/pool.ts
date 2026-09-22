/**
 * 数据库连接池
 * 管理 PostgreSQL 连接
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import * as databaseConfig from './database.js';
import { resolveProcessSettings } from './env.js';

const logLevel = resolveProcessSettings(process.env).logLevel;

// 创建连接池
export const pool = new Pool({
  host: databaseConfig.host,
  port: Number(databaseConfig.port),
  database: databaseConfig.database,
  user: databaseConfig.user,
  password: databaseConfig.password,
  ssl: databaseConfig.ssl,
  max: 20, // 最大连接数
  idleTimeoutMillis: 30000, // 空闲连接超时时间
  connectionTimeoutMillis: 2000, // 建连（含握手）超时时间
  // 单条 SQL 的服务端上限：慢查询、锁等待不能长期占着连接（pg 通过启动参数下发）。
  // 注意它管不了「服务端整个卡住」——那种情况由 routes/status.js 的探测超时销毁连接兜底。
  statement_timeout: 10000,
});

// 连接池事件监听
pool.on('connect', () => {
  console.log('数据库连接池：新连接已建立');
});

pool.on('error', (err) => {
  console.error('数据库连接池错误：', err);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 执行查询
 * @param text SQL 查询语句
 * @param params 查询参数
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    // 逐条 SQL 只在 LOG_LEVEL=debug 时打印：默认级别下每个请求都刷一整条语句太吵。
    if (logLevel === 'debug') {
      console.log('执行查询', { text, duration: Date.now() - start, rows: result.rowCount });
    }
    return result;
  } catch (error: unknown) {
    console.error('查询错误：', { text, error: errorMessage(error) });
    throw error;
  }
}

/**
 * 事务外壳：回调拿到 client，抛错自动回滚。
 *
 * `BEGIN` / `COMMIT` / `ROLLBACK` 与连接归还都在这里，调用方只写业务语句：
 * 手写这一套时漏掉 `release()` 会把连接池占满，正是要避免的写法。
 * @param run 事务体
 * @returns 事务体的返回值
 */
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 关闭连接池
 */
export async function close(): Promise<void> {
  await pool.end();
  console.log('数据库连接池已关闭');
}
