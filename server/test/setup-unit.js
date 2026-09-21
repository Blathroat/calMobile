/**
 * 单测环境：在加载任何 src 模块之前注入密钥。
 * 认证中间件按 JWT 密钥验签，不再要求各测试文件在 require 之前自己写 process.env。
 */
const { register } = require('tsx/cjs/api');
register();

vi.stubEnv('JWT_SECRET', 'test-access-secret-012345678901234567890');
vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh-secret-012345678901234567890');
