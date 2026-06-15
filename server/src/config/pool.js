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
  connectionTimeoutMillis: 2000 // 连接超时时间
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
    const duration = Date.now() - start;
    console.log('执行查询', { text, duration, rows: result.rowCount });
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
  pool
};
