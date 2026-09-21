/**
 * 把进程环境一次性解析成配置对象。
 *
 * 纯函数：`parseEnv(env, argv)` 只看传入的对象，不读、不改 `process.env`。
 * 启动入口把 `process.env` 与 `process.argv` 喂进来一次，其余模块从返回值取值。
 *
 * 密钥校验（非空、≥32 字符、禁占位符）与 `config/auth.js` 相同：缺 key 在解析时就失败。
 */

const { resolveRuntime } = require('./runtime');
const { resolveAuthConfig } = require('./auth');
const { resolveDatabaseConfig } = require('./database');
const { resolveMailConfig } = require('./mail');

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {{port: number, logLevel: string, corsOrigin: string}}
 */
function resolveProcessSettings(env = {}) {
  return {
    port: Number(env.PORT) || 3000,
    logLevel: env.LOG_LEVEL || 'info',
    corsOrigin: env.CORS_ORIGIN || '*',
  };
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env 形如 `process.env`。
 * @param {string[]} [argv] 形如 `process.argv`（含 node 与脚本路径，函数自己 slice）。
 */
function parseEnv(env = {}, argv = []) {
  const runtime = resolveRuntime(argv, env);
  const auth = resolveAuthConfig(env);
  const settings = resolveProcessSettings(env);
  return {
    env,
    runtime,
    auth,
    mail: resolveMailConfig(env),
    database: resolveDatabaseConfig(env),
    totpSecretKey: auth.totpSecretKey,
    port: settings.port,
    logLevel: settings.logLevel,
    corsOrigin: settings.corsOrigin,
  };
}

let processConfig;

/** 进程启动时解析一次；单测请调用 `parseEnv` 并自己注入环境。 */
function loadProcessConfig() {
  if (!processConfig) {
    processConfig = parseEnv(process.env, process.argv);
  }
  return processConfig;
}

module.exports = {
  parseEnv,
  loadProcessConfig,
  resolveProcessSettings,
};
