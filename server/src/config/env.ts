/**
 * 把进程环境一次性解析成配置对象。
 *
 * 纯函数：`parseEnv(env, argv)` 只看传入的对象，不读、不改 `process.env`。
 * 启动入口把 `process.env` 与 `process.argv` 喂进来一次，其余模块从返回值取值。
 *
 * 密钥校验（非空、≥32 字符、禁占位符）与 `config/auth.ts` 相同：缺 key 在解析时就失败。
 */

import { resolveRuntime, type Runtime } from './runtime';
import auth = require('./auth');
import { resolveDatabaseConfig, type DatabaseConfig } from './database';
import { resolveMailConfig, type MailConfig } from './mail';

export type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface ProcessSettings {
  port: number;
  logLevel: string;
  corsOrigin: string;
}

export interface ProcessConfig {
  env: EnvLike;
  runtime: Runtime;
  auth: ReturnType<typeof auth.resolveAuthConfig>;
  mail: MailConfig;
  database: DatabaseConfig;
  totpSecretKey: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
}

/**
 * @param env
 */
export function resolveProcessSettings(env: EnvLike = {}): ProcessSettings {
  return {
    port: Number(env.PORT) || 3000,
    logLevel: env.LOG_LEVEL || 'info',
    corsOrigin: env.CORS_ORIGIN || '*',
  };
}

/**
 * @param env 形如 `process.env`。
 * @param argv 形如 `process.argv`（含 node 与脚本路径，函数自己 slice）。
 */
export function parseEnv(env: EnvLike = {}, argv: string[] = []): ProcessConfig {
  const runtime = resolveRuntime(argv, env);
  const resolvedAuth = auth.resolveAuthConfig(env);
  const settings = resolveProcessSettings(env);
  return {
    env,
    runtime,
    auth: resolvedAuth,
    mail: resolveMailConfig(env),
    database: resolveDatabaseConfig(env),
    totpSecretKey: resolvedAuth.totpSecretKey,
    port: settings.port,
    logLevel: settings.logLevel,
    corsOrigin: settings.corsOrigin,
  };
}

let processConfig: ProcessConfig | undefined;

/** 进程启动时解析一次；单测请调用 `parseEnv` 并自己注入环境。 */
export function loadProcessConfig(): ProcessConfig {
  if (!processConfig) {
    processConfig = parseEnv(process.env, process.argv);
  }
  return processConfig;
}
