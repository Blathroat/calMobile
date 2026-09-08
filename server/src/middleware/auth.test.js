const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-access-secret-012345678901234567890';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-012345678901234567890';

jest.mock('../config/pool', () => ({
  query: jest.fn()
}));

const { query } = require('../config/pool');
const { authenticate, authorize, optionalAuth } = require('./auth');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };
}

test('authenticate rejects requests without a bearer token', async () => {
  const req = { headers: {} };
  const res = createResponse();
  const next = jest.fn();

  await authenticate(req, res, next);

  assert.equal(res.status.mock.calls[0][0], 401);
  assert.equal(res.json.mock.calls[0][0].message, '未提供认证令牌');
  assert.equal(next.mock.calls.length, 0);
});

test('authenticate attaches an active user from a valid token', async () => {
  const req = {
    headers: {
      authorization: `Bearer ${jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET)}`
    }
  };
  const res = createResponse();
  const next = jest.fn();
  query.mockResolvedValueOnce({
    rows: [{
      id: 'user-1',
      username: 'demo',
      email: 'demo@example.com',
      nickname: 'Demo',
      role: 'admin',
      status: 'active'
    }]
  });

  await authenticate(req, res, next);

  assert.deepEqual(req.user, {
    userId: 'user-1',
    username: 'demo',
    email: 'demo@example.com',
    nickname: 'Demo',
    role: 'admin'
  });
  assert.equal(next.mock.calls.length, 1);
  assert.equal(res.status.mock.calls.length, 0);
});

test('authorize rejects unauthenticated and disallowed users', () => {
  const res = createResponse();
  const next = jest.fn();
  const middleware = authorize(['admin']);

  middleware({ user: undefined }, res, next);
  assert.equal(res.status.mock.calls[0][0], 401);

  const forbiddenResponse = createResponse();
  middleware({ user: { role: 'user' } }, forbiddenResponse, next);
  assert.equal(forbiddenResponse.status.mock.calls[0][0], 403);
});

test('optionalAuth continues without a token and ignores invalid tokens', async () => {
  query.mockClear();
  const next = jest.fn();
  await optionalAuth({ headers: {} }, createResponse(), next);
  assert.equal(next.mock.calls.length, 1);
  assert.equal(query.mock.calls.length, 0);

  const invalidNext = jest.fn();
  const req = { headers: { authorization: 'Bearer invalid-token' } };
  await optionalAuth(req, createResponse(), invalidNext);
  assert.equal(invalidNext.mock.calls.length, 1);
  assert.equal(req.user, undefined);
});
