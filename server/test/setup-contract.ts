/**
 * 契约测试环境：在加载 src 之前注入。
 * database / mail 都是加载时读环境变量。
 *
 * 这里只负责设变量：ESM 下没有 CJS 的 `tsx/cjs/api` 注册表可挂，
 * .ts 的加载由 vitest 的 `execArgv: ['--import', 'tsx']` 统一负责。
 */
import { contractDatabaseFor } from '../src/test/contract-template.js';
vi.stubEnv('NODE_ENV', 'test');
// 每个测试文件一份自己的库（见 src/test/contract-template.ts）：文件之间不共享数据，可以并行跑。
vi.stubEnv('DB_NAME', contractDatabaseFor(expect.getState().testPath));
vi.stubEnv('LOG_LEVEL', 'quiet');
vi.stubEnv('MAIL_TRANSPORT', 'memory');
vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET || 'calmobile-test-access-secret-32-characters');
vi.stubEnv('TOTP_SECRET_KEY', process.env.TOTP_SECRET_KEY || 'calmobile-test-totp-secret-32-characters');
// 骨架的 CORS 断言要固定来源：本机 .env 里的 CORS_ORIGIN 只影响开发机，
// 契约测试不该依赖它（否则 CI 上默认 `*`，断言就全红了）。
vi.stubEnv('CORS_ORIGIN', 'https://appassets.androidplatform.net');
