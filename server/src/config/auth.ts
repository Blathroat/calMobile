type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const PLACEHOLDER_SECRET = /^(your_|replace-with|change-me)/i;
const MIN_SECRET_LENGTH = 32;

interface AuthConfig {
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
 * 解析认证相关配置。纯函数：用例直接喂环境对象。
 *
 * @param env 形如 `process.env`。
 */
function resolveAuthConfig(env: EnvLike = {}): AuthConfig {
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

function processAuth(): AuthConfig {
  // 延迟加载，避免与 env.ts 的循环依赖在模块初始化时炸掉。
  const { loadProcessConfig } = require('./env') as typeof import('./env');
  return loadProcessConfig().auth;
}

const auth = {
  resolveAuthConfig,
  PLACEHOLDER_SECRET,
  MIN_SECRET_LENGTH,
  get accessSecret(): string {
    return processAuth().accessSecret;
  },
  get refreshSecret(): string {
    return processAuth().refreshSecret;
  },
  get accessExpiresIn(): string {
    return processAuth().accessExpiresIn;
  },
  get refreshExpiresIn(): string {
    return processAuth().refreshExpiresIn;
  },
  get totpSecretKey(): string {
    return processAuth().totpSecretKey;
  },
};

export = auth;
