import assert from 'node:assert/strict';
import { resolveAuthConfig } from './auth.js';

const ACCESS = 'test-access-secret-012345678901234567890';
const TOTP = 'test-totp-secret-012345678901234567890';

test('JWT_SECRET 与 TOTP_SECRET_KEY 都必须存在', () => {
  assert.throws(() => resolveAuthConfig({}), /JWT_SECRET 必须配置/);
  assert.throws(() => resolveAuthConfig({ JWT_SECRET: ACCESS }), /TOTP_SECRET_KEY 必须配置/);
});

test('拒绝占位值与短于 32 个字符的密钥，并指出变量名', () => {
  assert.throws(
    () =>
      resolveAuthConfig({ JWT_SECRET: ACCESS, TOTP_SECRET_KEY: 'replace-with-a-totp-secret-at-least-32-characters' }),
    /TOTP_SECRET_KEY 必须配置至少 32 个字符的非占位密钥/,
  );
  assert.throws(
    () => resolveAuthConfig({ JWT_SECRET: ACCESS, TOTP_SECRET_KEY: 'short' }),
    /TOTP_SECRET_KEY 必须配置至少 32 个字符的非占位密钥/,
  );
});

test('接受有效密钥；刷新令牌 TTL 使用新的变量名和默认值', () => {
  const defaults = resolveAuthConfig({ JWT_SECRET: ACCESS, TOTP_SECRET_KEY: TOTP });
  assert.equal(defaults.accessSecret, ACCESS);
  assert.equal(defaults.totpSecretKey, TOTP);
  assert.equal(defaults.refreshTokenTtl, '7d');
  assert.equal('refreshSecret' in defaults, false, '不再读取刷新令牌 JWT 密钥');

  const overridden = resolveAuthConfig({
    JWT_SECRET: ACCESS,
    TOTP_SECRET_KEY: TOTP,
    REFRESH_TOKEN_TTL: '14d',
  });
  assert.equal(overridden.refreshTokenTtl, '14d');
});
