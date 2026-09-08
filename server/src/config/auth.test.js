const assert = require('node:assert/strict');

function loadAuthConfig(environment) {
  const originalEnvironment = process.env;
  jest.resetModules();
  process.env = { ...originalEnvironment, ...environment };
  try {
    return require('./auth');
  } finally {
    process.env = originalEnvironment;
  }
}

test('rejects missing JWT secrets', () => {
  assert.throws(
    () => loadAuthConfig({ JWT_SECRET: '', JWT_REFRESH_SECRET: '' }),
    /JWT_SECRET must be a non-placeholder secret/
  );
});

test('rejects placeholder JWT secrets', () => {
  assert.throws(
    () => loadAuthConfig({
      JWT_SECRET: 'replace-with-a-random-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'replace-with-a-random-refresh-secret-at-least-32-characters'
    }),
    /JWT_SECRET must be a non-placeholder secret/
  );
});

test('accepts distinct non-placeholder JWT secrets', () => {
  const config = loadAuthConfig({
    JWT_SECRET: 'test-access-secret-012345678901234567890',
    JWT_REFRESH_SECRET: 'test-refresh-secret-012345678901234567890'
  });

  assert.equal(config.accessSecret, 'test-access-secret-012345678901234567890');
  assert.equal(config.refreshSecret, 'test-refresh-secret-012345678901234567890');
});
