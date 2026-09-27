/** Hono 认证共享解析器的单元测试。 */

import assert from 'node:assert/strict';
import { query } from '../config/pool.js';
import { signAccessToken } from '../domain/session.js';
import { resolveUser, tokenFrom } from './auth.js';
import { SignJWT, jwtVerify } from 'jose';

vi.mock('../config/pool', () => ({ query: vi.fn() }));

const USER_ROW = {
  id: 'user-1',
  username: 'demo',
  email: 'demo@example.com',
  nickname: 'Demo',
  role: 'admin',
  status: 'active',
};
const mockedQuery = vi.mocked(query);

async function tokenFor(
  payload: Record<string, unknown>,
  secret = process.env.JWT_SECRET || '',
  algorithm: 'HS256' | 'HS384' = 'HS256',
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret));
}

test('tokenFrom 只认 Bearer 前缀', () => {
  assert.equal(tokenFrom({ headers: {} }), '');
  assert.equal(tokenFrom({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(tokenFrom({ headers: { authorization: 'Bearer abc' } }), 'abc');
});

test('jose 签发的访问令牌固定使用 HS256', async () => {
  const token = await signAccessToken({ id: 'user-1', username: 'demo', role: 'admin' });
  const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET || ''), {
    algorithms: ['HS256'],
  });
  assert.equal(protectedHeader.alg, 'HS256');
  assert.equal(payload.userId, 'user-1');
  assert.ok(typeof payload.exp === 'number');
});

test('resolveUser 解析有效令牌并附加能力', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [USER_ROW] } as never);
  const token = await tokenFor({ userId: 'user-1' });
  const user = await resolveUser(token);
  assert.equal(user?.userId, 'user-1');
  assert.deepEqual(user?.can, { register: true, profile: true, exhibitor: true, admin: true, limited: false });
});

test('resolveUser 拒绝异算法、过期和空令牌', async () => {
  assert.equal(await resolveUser(''), null);
  assert.equal(await resolveUser(await tokenFor({ userId: 'user-1' }, process.env.JWT_SECRET, 'HS384')), null);
  const expired = await new SignJWT({ userId: 'user-1' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('-1s')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET || ''));
  assert.equal(await resolveUser(expired), null);
});

test('resolveUser 对被封禁和不存在用户返回安全结果', async () => {
  mockedQuery.mockResolvedValueOnce({ rows: [] } as never);
  assert.equal(await resolveUser(await tokenFor({ userId: 'gone' })), null);
  mockedQuery.mockResolvedValueOnce({ rows: [{ ...USER_ROW, status: 'banned' }] } as never);
  const token = await tokenFor({ userId: 'user-1' });
  await assert.rejects(() => resolveUser(token), /封禁/);
});
