const PLACEHOLDER_SECRET = /^(your_|replace-with|change-me)/i;
const MIN_SECRET_LENGTH = 32;

/**
 * 读一个密钥：必须存在、不少于 32 个字符、且不能是模板里的占位值。
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 */
function readSecret(env, name) {
  const value = env[name];
  if (!value || value.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRET.test(value)) {
    throw new Error(`${name} must be a non-placeholder secret of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return value;
}

/**
 * 解析认证相关配置。纯函数：用例直接喂环境对象。
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env 形如 `process.env`。
 */
function resolveAuthConfig(env = {}) {
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

function processAuth() {
  return require('./env').loadProcessConfig().auth;
}

module.exports = {
  resolveAuthConfig,
  PLACEHOLDER_SECRET,
  MIN_SECRET_LENGTH,
  get accessSecret() {
    return processAuth().accessSecret;
  },
  get refreshSecret() {
    return processAuth().refreshSecret;
  },
  get accessExpiresIn() {
    return processAuth().accessExpiresIn;
  },
  get refreshExpiresIn() {
    return processAuth().refreshExpiresIn;
  },
  get totpSecretKey() {
    return processAuth().totpSecretKey;
  },
};
