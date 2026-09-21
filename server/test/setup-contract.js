/**
 * 契约测试环境：在加载 src 之前注入。
 * database.js / mail.js 都是 require 时读环境变量。
 */
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('DB_NAME', process.env.TEST_DB_NAME || 'calmobile_test');
vi.stubEnv('LOG_LEVEL', 'quiet');
vi.stubEnv('MAIL_TRANSPORT', 'memory');
vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET || 'calmobile-test-access-secret-32-characters');
vi.stubEnv('JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET || 'calmobile-test-refresh-secret-32-chars');
