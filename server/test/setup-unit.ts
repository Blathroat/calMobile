/**
 * 单测环境：在加载任何 src 模块之前注入密钥。
 * 认证中间件按 JWT 密钥验签，不再要求各测试文件在 import 之前自己写 process.env。
 *
 * 这里只负责设变量：ESM 下没有 CJS 的 `tsx/cjs/api` 注册表可挂，
 * .ts 的加载由 vitest 的 `execArgv: ['--import', 'tsx']` 统一负责。
 */
vi.stubEnv('JWT_SECRET', 'test-access-secret-012345678901234567890');
vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh-secret-012345678901234567890');
