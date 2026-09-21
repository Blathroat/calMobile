/**
 * 认证中间件的单元测试。
 *
 * 中间件不再自己写响应，而是 `next(new ApiError(...))` 交给 index.js 的统一错误处理，
 * 因此这里的断言看的是「抛给 next 的错误」而不是 response 对象。
 */

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const path = require('node:path');

// vi.mock 只拦 import；本文件与被测模块都是 require，所以把桩写进 require.cache。
const query = vi.fn();
const poolPath = path.resolve(__dirname, '../config/pool.ts');
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: { query },
};

const { authenticate, authorize, optionalAuth, tokenFrom, resolveUser } = require('./auth');

const USER_ROW = {
  id: 'user-1',
  username: 'demo',
  email: 'demo@example.com',
  nickname: 'Demo',
  role: 'admin',
  status: 'active',
};

/** 跑一个中间件并返回 next 收到的错误（没有错误时返回 undefined）。 */
async function run(middleware, req) {
  let captured;
  await middleware(req, {}, (error) => {
    captured = error;
  });
  return captured;
}

function tokenFor(payload, secret = process.env.JWT_SECRET, options = {}) {
  return jwt.sign(payload, secret, options);
}

test('tokenFrom 只认 Bearer 前缀', () => {
  assert.equal(tokenFrom({ headers: {} }), '');
  assert.equal(tokenFrom({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(tokenFrom({ headers: { authorization: 'Bearer abc' } }), 'abc');
});

test('authenticate 缺少令牌时给出 401', async () => {
  const error = await run(authenticate, { headers: {} });
  assert.equal(error.status, 401);
  assert.ok(error.message.includes('登录'), error.message);
});

test('authenticate 令牌无效或过期时给出 401', async () => {
  const invalid = await run(authenticate, { headers: { authorization: 'Bearer nonsense' } });
  assert.equal(invalid.status, 401);

  const expired = tokenFor({ userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
  const error = await run(authenticate, { headers: { authorization: `Bearer ${expired}` } });
  assert.equal(error.status, 401);
});

test('authenticate 用其它密钥签发的令牌不通过', async () => {
  const foreign = tokenFor({ userId: 'user-1' }, 'another-secret-0123456789012345678901234');
  const error = await run(authenticate, { headers: { authorization: `Bearer ${foreign}` } });
  assert.equal(error.status, 401);
});

test('authenticate 挂上用户与角色能力', async () => {
  query.mockResolvedValueOnce({ rows: [USER_ROW] });
  const req = { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } };

  const error = await run(authenticate, req);

  assert.equal(error, undefined, '有效令牌不应报错');
  assert.equal(req.user.userId, 'user-1');
  assert.equal(req.user.username, 'demo');
  assert.equal(req.user.role, 'admin');
  assert.deepEqual(req.user.can, { register: true, profile: true, exhibitor: true, admin: true, limited: false });
});

test('authenticate 放行受限账号，但能力位按状态置灰', async () => {
  query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, role: 'user', status: 'limited' }] });
  const req = { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } };

  const error = await run(authenticate, req);

  assert.equal(error, undefined, '受限账号仍然能登录与浏览');
  assert.equal(req.user.role, 'user');
  assert.equal(req.user.status, 'limited');
  assert.deepEqual(req.user.can, { register: false, profile: false, exhibitor: false, admin: false, limited: true });
});

test('authenticate 对已删除的用户给出 401', async () => {
  query.mockResolvedValueOnce({ rows: [] });
  const error = await run(authenticate, { headers: { authorization: `Bearer ${tokenFor({ userId: 'gone' })}` } });
  assert.equal(error.status, 401);
});

test('authenticate 拒绝被封禁的账号', async () => {
  query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'banned' }] });
  const error = await run(authenticate, { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } });
  assert.equal(error.status, 403);
  assert.ok(error.message.includes('封禁'), error.message);
});

test('authorize 按角色放行与拦截', async () => {
  const middleware = authorize(['admin']);

  const anonymous = await run(middleware, {});
  assert.equal(anonymous.status, 401, '没有登录信息应当给 401');

  const forbidden = await run(middleware, { user: { role: 'user' } });
  assert.equal(forbidden.status, 403, '角色不符应当给 403');

  const allowed = await run(middleware, { user: { role: 'admin' } });
  assert.equal(allowed, undefined, '角色符合应当放行');
});

test('optionalAuth 没有令牌时继续，不查库', async () => {
  query.mockClear();
  const req = {};
  const error = await run(optionalAuth, req);

  assert.equal(error, undefined);
  assert.equal(req.user, null, '访客应当是空的用户');
  assert.equal(query.mock.calls.length, 0, '没有令牌不应该查数据库');
});

test('optionalAuth 忽略无效令牌', async () => {
  query.mockClear();
  const req = { headers: { authorization: 'Bearer invalid-token' } };
  const error = await run(optionalAuth, req);

  assert.equal(error, undefined);
  assert.equal(req.user, null);
});

test('optionalAuth 对封禁账号仍然报错', async () => {
  query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'banned' }] });
  const error = await run(optionalAuth, { headers: { authorization: `Bearer ${tokenFor({ userId: 'user-1' })}` } });
  assert.equal(error.status, 403, '封禁账号不能降级成访客继续访问');
});

test('resolveUser 对过期令牌返回空而不抛异常', async () => {
  const expired = tokenFor({ userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
  assert.equal(await resolveUser(expired), null);
  assert.equal(await resolveUser(''), null);
});
