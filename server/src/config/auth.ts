/**
 * 认证配置的解析：纯函数，用例直接喂环境对象。
 *
 * 进程级的那份值由 `config/env.ts` 统一解析（`loadProcessConfig()`），
 * 这里**不反向依赖它** —— 所以 `env.ts → auth.ts` 是一条单向边，模块图里没有环。
 * 要读「当前进程实际在用的密钥」的调用方，自己去 `loadProcessConfig().auth` 取。
 */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export const PLACEHOLDER_SECRET = /^(your_|replace-with|change-me)/i;
export const MIN_SECRET_LENGTH = 32;

export interface AuthConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
  totpSecretKey: string;
}

/**
 * 读一个密钥：必须存在、不少于 32 个字符、且不能是模板里的占位值。
 */
function readSecret(env: EnvLike, name: string): string {
  const value = env[name];
  if (!value || value.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRET.test(value)) {
    throw new Error(`${name} must be a non-placeholder secret of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return value;
}

/**
 * 解析认证相关配置。纯函数：用例与 `parseEnv` 直接喂环境对象。
 *
 * @param env 形如 `process.env`。
 */
export function resolveAuthConfig(env: EnvLike = {}): AuthConfig {
  const accessSecret = readSecret(env, 'JWT_SECRET');
  const refreshSecret = readSecret(env, 'JWT_REFRESH_SECRET');
  return {
    accessSecret,
    refreshSecret,
    accessExpiresIn: env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN || '7d',
    totpSecretKey: String(env.TOTP_SECRET_KEY || '').trim() || refreshSecret,
  };
}
