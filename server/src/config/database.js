/**
 * 数据库连接配置。
 *
 * 连接参数一律来自环境变量；**SSL 由 `DB_SSL` 决定，默认关闭**：
 * 生产环境里同机 Docker 的 PostgreSQL 通常不带 TLS（按 NODE_ENV 硬开 SSL 会让部署后
 * 第一件事就是连不上库），而托管数据库一般要求 TLS —— 这件事必须由部署的人声明，
 * 不能由环境推断。远端的库没开 SSL 时，生产启动自检会给出警告。
 *
 * 未知的 `NODE_ENV`（例如有人写 staging）回退到 development 配置，而不是让
 * `module.exports` 变成 undefined —— 那样会在建连接池时报一句看不懂的错。
 */

require('dotenv').config();
const { bool } = require('./runtime');

const KNOWN_ENVS = ['development', 'test', 'production'];

function build(env) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || (env === 'test' ? 'calmobile_test' : 'calmobile_dev'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: bool(process.env.DB_SSL) ? { rejectUnauthorized: false } : false,
  };
}

const env = process.env.NODE_ENV || 'development';

module.exports = build(KNOWN_ENVS.includes(env) ? env : 'development');
