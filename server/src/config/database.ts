/**
 * 数据库连接配置。
 *
 * 连接参数一律来自环境变量；**SSL 由 `DB_SSL` 决定，默认关闭**：
 * 生产环境里同机 Docker 的 PostgreSQL 通常不带 TLS（按 NODE_ENV 硬开 SSL 会让部署后
 * 第一件事就是连不上库），而托管数据库一般要求 TLS —— 这件事必须由部署的人声明，
 * 不能由环境推断。远端的库没开 SSL 时，生产启动自检会给出警告。
 *
 * 未知的 `NODE_ENV`（例如有人写 staging）回退到 development 配置，而不是让
 * 导出变成 undefined —— 那样会在建连接池时报一句看不懂的错。
 */

import { bool } from './runtime';

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const KNOWN_ENVS = ['development', 'test', 'production'] as const;

export interface DatabaseConfig {
  host: string;
  port: string | number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: false };
}

/**
 * 解析数据库连接配置。纯函数：用例与 `parseEnv` 直接喂环境对象。
 *
 * @param env 形如 `process.env`。
 */
export function resolveDatabaseConfig(env: EnvLike = {}): DatabaseConfig {
  const nodeEnv = String(env.NODE_ENV || 'development');
  const known = (KNOWN_ENVS as readonly string[]).includes(nodeEnv) ? nodeEnv : 'development';
  return {
    host: env.DB_HOST || 'localhost',
    port: env.DB_PORT || 5432,
    database: env.DB_NAME || (known === 'test' ? 'calmobile_test' : 'calmobile_dev'),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    ssl: bool(env.DB_SSL) ? { rejectUnauthorized: false } : false,
  };
}

const databaseConfig = resolveDatabaseConfig(process.env);

export const host = databaseConfig.host;
export const port = databaseConfig.port;
export const database = databaseConfig.database;
export const user = databaseConfig.user;
export const password = databaseConfig.password;
export const ssl = databaseConfig.ssl;
