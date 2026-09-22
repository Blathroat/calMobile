/**
 * 认证中间件的单元测试。
 *
 * 中间件不再自己写响应，而是 `next(new ApiError(...))` 交给 index.js 的统一错误处理，
 * 因此这里的断言看的是「抛给 next 的错误」而不是 response 对象。
 */

import assert from 'node:assert/strict';
import { query } from '../config/pool.js';
import { ApiError } from '../domain/errors.js';
import { authenticate, authorize, optionalAuth, tokenFrom, resolveUser, type AuthRequest } from './auth.js';
import jwt from 'jsonwebtoken';

vi.mock('../config/pool', () => ({
  query: vi.fn(),
}));

const USER_ROW = {
  id: 'user-1',
  username: 'demo',
  email: 'demo@example.com',
  nickname: 'Demo',
  role: 'admin',
  status: 'active',
};

const mockedQuery = vi.mocked(query);

type Middleware = (req: AuthRequest, res: object, next: (error?: unknown) => void) => unknown;

/** 跑一个中间件并返回 next 收到的错误（没有错误时返回 undefined）。 */
async function run(middleware: Middleware, req: AuthRequest) {
  let captured: unknown;
  await middleware(req, {}, (error) => {
    captured = error;
  });
  return captured as ApiError | undefined;
}

function tokenFor(
  payload: object,
  secret: string | undefined = process.env.JWT_SECRET,
  options: { expiresIn?: string } = {},
) {
  return jwt.sign(payload, secret || '', options);
}

test('tokenFrom 只认 Bearer 前缀', () => {
  assert.equal(tokenFrom({ headers: {} }), '');
  assert.equal(tokenFrom({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(tokenFrom({ headers: { authorization: 'Bearer abc' } }), 'abc');
});

test('authenticate 缺少令牌时给出 401', async () => {
  const error = await run(authenticate, { headers: {} });
  assert.equal(error?.status, 401);
  assert.ok(error?.message.includes('登录'), error?.message);
});

test('authenticate 令牌无效或过期时给出 401', async () => {
  const invalid = await run(authenticate, { headers: { authorization: 'Bearer nonsense' } });
  assert.equal(invalid?.status, 401);

  const expired = tokenFor({ userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
  const error = await run(authenticate, { headers: { authorization: `Bearer ${expired}` } });
  assert.equal(error?.status, 401);
});

test('authenticate 用其它密钥签发的令牌不通过', async () => {
  const foreign = tokenFor({ userId: 'user-1' }, 'another-secret-0123456789012345678901234');
  const error = await run(authenticate, { headers: { authorization: `Bearer ${foreign}` } });
  assert.equal(error?.status, 401);
});

test('authenticate 挂上用户与角色能力', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [USER_ROW] } as never);
  const req: AuthRequest = { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } };

  const error = await run(authenticate, req);

  assert.equal(error, undefined, '有效令牌不应报错');
  assert.equal(req.user?.userId, 'user-1');
  assert.equal(req.user?.username, 'demo');
  assert.equal(req.user?.role, 'admin');
  assert.deepEqual(req.user?.can, { register: true, profile: true, exhibitor: true, admin: true, limited: false });
});

test('authenticate 放行受限账号，但能力位按状态置灰', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [{ ...USER_ROW, role: 'user', status: 'limited' }] } as never);
  const req: AuthRequest = { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } };

  const error = await run(authenticate, req);

  assert.equal(error, undefined, '受限账号仍然能登录与浏览');
  assert.equal(req.user?.role, 'user');
  assert.equal(req.user?.status, 'limited');
  assert.deepEqual(req.user?.can, { register: false, profile: false, exhibitor: false, admin: false, limited: true });
});

test('authenticate 对已删除的用户给出 401', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [] } as never);
  const error = await run(authenticate, { headers: { authorization: `Bearer ${tokenFor({ userId: 'gone' })}` } });
  assert.equal(error?.status, 401);
});

test('authenticate 拒绝被封禁的账号', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'banned' }] } as never);
  const error = await run(authenticate, { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } });
  assert.equal(error?.status, 403);
  assert.ok(error?.message.includes('封禁'), error?.message);
});

test('authorize 按角色放行与拦截', async () => {
  const middleware = authorize(['admin']);

  const anonymous = await run(middleware, {});
  assert.equal(anonymous?.status, 401, '没有登录信息应当给 401');

  const forbidden = await run(middleware, { user: { role: 'user' } as AuthRequest['user'] });
  assert.equal(forbidden?.status, 403, '角色不符应当给 403');

  const allowed = await run(middleware, { user: { role: 'admin' } as AuthRequest['user'] });
  assert.equal(allowed, undefined, '角色符合应当放行');
});

test('optionalAuth 没有令牌时继续，不查库', async () => {
  mockedQuery.mockClear();
  const req: AuthRequest = {};
  const error = await run(optionalAuth, req);

  assert.equal(error, undefined);
  assert.equal(req.user, null, '访客应当是空的用户');
  assert.equal(mockedQuery.mock.calls.length, 0, '没有令牌不应该查数据库');
});

test('optionalAuth 忽略无效令牌', async () => {
  mockedQuery.mockClear();
  const req: AuthRequest = { headers: { authorization: 'Bearer invalid-token' } };
  const error = await run(optionalAuth, req);

  assert.equal(error, undefined);
  assert.equal(req.user, null);
});

test('optionalAuth 对封禁账号仍然报错', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'banned' }] } as never);
  const error = await run(optionalAuth, { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } });
  assert.equal(error?.status, 403, '封禁账号不能降级成访客继续访问');
});

test('resolveUser 对过期令牌返回空而不抛异常', async () => {
  const expired = tokenFor({ userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
  assert.equal(await resolveUser(expired), null);
  assert.equal(await resolveUser(''), null);
});
