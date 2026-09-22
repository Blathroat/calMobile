/**
 * 契约测试环境：在加载 src 之前注入。
 * database / mail 都是加载时读环境变量。
 *
 * 这里只负责设变量：ESM 下没有 CJS 的 `tsx/cjs/api` 注册表可挂，
 * .ts 的加载由 vitest 的 `execArgv: ['--import', 'tsx']` 统一负责。
 */
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('DB_NAME', process.env.TEST_DB_NAME || 'calmobile_test');
vi.stubEnv('LOG_LEVEL', 'quiet');
vi.stubEnv('MAIL_TRANSPORT', 'memory');
vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET || 'calmobile-test-access-secret-32-characters');
vi.stubEnv('JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET || 'calmobile-test-refresh-secret-32-chars');
// 骨架的 CORS 断言要固定来源：本机 .env 里的 CORS_ORIGIN 只影响开发机，
// 契约测试不该依赖它（否则 CI 上默认 `*`，断言就全红了）。
vi.stubEnv('CORS_ORIGIN', 'https://appassets.androidplatform.net');
