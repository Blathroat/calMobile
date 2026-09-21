/**
 * 环境变量解析的单元测试。
 *
 * `parseEnv(env, argv)` 是纯函数：用例直接喂环境对象，不必改 `process.env`
 * 再重新 require。密钥校验、dev/start 两种模式、邮件通道解析都从这里钉住。
 */

const assert = require('node:assert/strict');

const { parseEnv } = require('./env');
const { resolveMailConfig } = require('./mail');
const { resolveRuntime } = require('./runtime');

const ACCESS = 'test-access-secret-012345678901234567890';
const REFRESH = 'test-refresh-secret-012345678901234567890';

/** 一份能通过密钥门槛的环境，用例按需覆盖其中某一项。 */
function validEnv(override = {}) {
  return {
    JWT_SECRET: ACCESS,
    JWT_REFRESH_SECRET: REFRESH,
    ...override,
  };
}

const argv = (...args) => ['node', 'src/index.js', ...args];

test('注入的环境对象不会去读或改 process.env', () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'process-env-secret-012345678901234567890';
  try {
    const injected = 'injected-access-secret-0123456789012345';
    const config = parseEnv(validEnv({ JWT_SECRET: injected }));
    assert.equal(config.auth.accessSecret, injected);
    assert.equal(process.env.JWT_SECRET, 'process-env-secret-012345678901234567890');
  } finally {
    if (previous === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previous;
    }
  }
});

test('缺密钥、过短、占位值都会在解析时失败，文案与现在一致', () => {
  const message = /JWT_SECRET must be a non-placeholder secret of at least 32 characters/;
  assert.throws(() => parseEnv(validEnv({ JWT_SECRET: '' })), message);
  assert.throws(() => parseEnv(validEnv({ JWT_SECRET: 'short' })), message);
  assert.throws(
    () => parseEnv(validEnv({ JWT_SECRET: 'replace-with-a-random-access-secret-at-least-32-characters' })),
    message,
  );
  assert.throws(
    () => parseEnv(validEnv({ JWT_REFRESH_SECRET: 'change-me-refresh-secret-at-least-32-chars' })),
    /JWT_REFRESH_SECRET must be a non-placeholder secret of at least 32 characters/,
  );
});

test('合法的非占位密钥会被收下，过期时间有默认值也可覆盖', () => {
  const defaults = parseEnv(validEnv());
  assert.equal(defaults.auth.accessSecret, ACCESS);
  assert.equal(defaults.auth.refreshSecret, REFRESH);
  assert.equal(defaults.auth.accessExpiresIn, '15m');
  assert.equal(defaults.auth.refreshExpiresIn, '7d');

  const overridden = parseEnv(validEnv({ JWT_EXPIRES_IN: '30m', JWT_REFRESH_EXPIRES_IN: '14d' }));
  assert.equal(overridden.auth.accessExpiresIn, '30m');
  assert.equal(overridden.auth.refreshExpiresIn, '14d');
});

test('pnpm start 传 --production：进生产模式；pnpm dev 不带参数：留在开发模式', () => {
  const start = parseEnv(validEnv({ NODE_ENV: 'development' }), argv('--production'));
  assert.equal(start.runtime.nodeEnv, 'production');
  assert.equal(start.runtime.isProduction, true);

  const dev = parseEnv(validEnv({ NODE_ENV: 'development', npm_lifecycle_event: 'dev' }), argv());
  assert.equal(dev.runtime.nodeEnv, 'development');
  assert.equal(dev.runtime.isProduction, false);
  assert.equal(dev.runtime.startedBy, 'dev');
});

test('运行模式与 resolveRuntime 一致', () => {
  const env = validEnv({ NODE_ENV: 'development', TRUST_PROXY: '1' });
  const args = argv('--production');
  assert.deepEqual(parseEnv(env, args).runtime, resolveRuntime(args, env));
});

test('邮件通道解析结果与 resolveMailConfig 一致', () => {
  const development = validEnv({ NODE_ENV: 'development' });
  assert.deepEqual(parseEnv(development).mail, resolveMailConfig(development));
  assert.equal(parseEnv(development).mail.transport, 'console');

  const production = validEnv({ NODE_ENV: 'production' });
  assert.deepEqual(parseEnv(production).mail, resolveMailConfig(production));
  assert.equal(parseEnv(production).mail.transport, 'smtp');
});

test('TOTP 加密密钥优先 TOTP_SECRET_KEY，缺省借用 JWT_REFRESH_SECRET', () => {
  const dedicated = parseEnv(validEnv({ TOTP_SECRET_KEY: 'dedicated-totp-key' }));
  assert.equal(dedicated.totpSecretKey, 'dedicated-totp-key');

  const borrowed = parseEnv(validEnv());
  assert.equal(borrowed.totpSecretKey, REFRESH);

  const blank = parseEnv(validEnv({ TOTP_SECRET_KEY: '   ' }));
  assert.equal(blank.totpSecretKey, REFRESH, '空白专用密钥视作未配置');
});

test('端口、日志、CORS 有默认值，显式配置优先', () => {
  const defaults = parseEnv(validEnv());
  assert.equal(defaults.port, 3000);
  assert.equal(defaults.logLevel, 'info');
  assert.equal(defaults.corsOrigin, '*');

  const overridden = parseEnv(
    validEnv({
      PORT: '8080',
      LOG_LEVEL: 'debug',
      CORS_ORIGIN: 'https://appassets.androidplatform.net',
    }),
  );
  assert.equal(overridden.port, 8080);
  assert.equal(overridden.logLevel, 'debug');
  assert.equal(overridden.corsOrigin, 'https://appassets.androidplatform.net');
});

test('数据库配置从注入的环境取值，未知 NODE_ENV 回退到 development', () => {
  const config = parseEnv(
    validEnv({
      NODE_ENV: 'staging',
      DB_HOST: 'db.internal',
      DB_PORT: '6543',
      DB_NAME: 'calmobile_prod',
      DB_USER: 'app',
      DB_PASSWORD: 's3cret',
      DB_SSL: 'true',
    }),
  );
  assert.equal(config.database.host, 'db.internal');
  assert.equal(config.database.port, '6543');
  assert.equal(config.database.database, 'calmobile_prod');
  assert.equal(config.database.user, 'app');
  assert.equal(config.database.password, 's3cret');
  assert.deepEqual(config.database.ssl, { rejectUnauthorized: false });

  const testDb = parseEnv(validEnv({ NODE_ENV: 'test' }));
  assert.equal(testDb.database.database, 'calmobile_test');
});
