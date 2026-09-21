/**
 * 数据库连接池
 * 管理 PostgreSQL 连接
 */

const { Pool } = require('pg');
const config = require('./database');

// 创建连接池
const pool = new Pool({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.user,
  password: config.password,
  ssl: config.ssl,
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

/**
 * 执行查询
 * @param {string} text - SQL 查询语句
 * @param {Array} params - 查询参数
 * @returns {Promise<Object>} 查询结果
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    // 逐条 SQL 只在 LOG_LEVEL=debug 时打印：默认级别下每个请求都刷一整条语句太吵。
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('执行查询', { text, duration: Date.now() - start, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('查询错误：', { text, error: error.message });
    throw error;
  }
}

/**
 * 获取客户端连接（用于事务）
 * @returns {Promise<Object>} 数据库客户端
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * 关闭连接池
 */
async function close() {
  await pool.end();
  console.log('数据库连接池已关闭');
}

module.exports = {
  query,
  getClient,
  close,
  pool,
};
