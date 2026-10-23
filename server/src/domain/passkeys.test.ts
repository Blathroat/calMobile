/**
 * 通行密钥选项与失败映射的单元测试（不连数据库）。
 *
 * 校验响应的完整链路要真实认证器，契约测试覆盖「挑战一次一用、失败计数、最后一枚不能删」；
 * 这里钉住下发给浏览器的那份 JSON 的形状：challenge / user.id 是 base64url、
 * 依赖方参数来自配置、excludeCredentials 与 authenticatorSelection 正确。
 */

import assert from 'node:assert/strict';
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  CHALLENGE_TTL_MIN,
  passkeyVerifyFailure,
} from './passkeys.js';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

test('注册选项：challenge 与 user.id 是 base64url，RP 与认证器选择按配置下发', async () => {
  const options = await buildRegistrationOptions({
    rp: { rpId: 'app.example.com', rpName: '发现展会' },
    user: { id: 'usr-3', username: 'zhangsan', email: 'zhangsan@example.com', displayName: '张三' },
    excludeCredentials: [{ id: 'cred-1', transports: ['internal'] }],
  });

  assert.equal(options.rp.id, 'app.example.com');
  assert.equal(options.rp.name, '发现展会');
  assert.match(options.challenge, BASE64URL);
  assert.ok(options.challenge.length >= 16, 'challenge 不能太短');
  assert.equal(options.user.name, 'zhangsan@example.com');
  assert.match(options.user.id, BASE64URL);
  assert.equal(Buffer.from(options.user.id, 'base64url').toString('utf8'), 'usr-3', 'user.id 是账号 id 的 base64url');
  assert.equal(options.user.displayName, '张三');
  assert.equal(options.excludeCredentials?.[0]?.id, 'cred-1');
  assert.deepEqual(options.excludeCredentials?.[0]?.transports, ['internal']);
  assert.equal(options.authenticatorSelection?.residentKey, 'preferred');
  assert.equal(options.authenticatorSelection?.userVerification, 'preferred');
});

test('注册选项：没有邮箱时用用户名当 account name，没有凭据时 excludeCredentials 为空', async () => {
  const options = await buildRegistrationOptions({
    rp: { rpId: 'localhost', rpName: 'CalMobile' },
    user: { id: 'usr-9', username: 'nobody' },
    excludeCredentials: [],
  });
  assert.equal(options.user.name, 'nobody');
  assert.deepEqual(options.excludeCredentials, []);
});

test('登录选项：rpId 与 allowCredentials 原样下发，userVerification 为 preferred', async () => {
  const options = await buildAuthenticationOptions({
    rpId: 'app.example.com',
    allowCredentials: [{ id: 'cred-1', transports: ['internal', 'hybrid'] }, { id: 'cred-2' }],
  });
  assert.equal(options.rpId, 'app.example.com');
  assert.equal(options.userVerification, 'preferred');
  assert.match(options.challenge, BASE64URL);
  assert.deepEqual(
    options.allowCredentials?.map((item) => item.id),
    ['cred-1', 'cred-2'],
  );
  assert.deepEqual(options.allowCredentials?.[0]?.transports, ['internal', 'hybrid']);
});

test('挑战有效期是 10 分钟（与浏览器弹窗节奏一致）', () => {
  assert.equal(CHALLENGE_TTL_MIN, 10);
});

test('校验失败的文案按「地址不对」与「凭据不对」分开', () => {
  assert.deepEqual(passkeyVerifyFailure(new Error('Unexpected registration response origin')), {
    error: '当前地址不允许使用通行密钥，请用应用的正式地址打开',
    errorCode: 'security.passkeyOrigin',
  });
  assert.deepEqual(passkeyVerifyFailure(new Error('Unexpected RP ID hash')), {
    error: '当前地址不允许使用通行密钥，请用应用的正式地址打开',
    errorCode: 'security.passkeyOrigin',
  });
  assert.deepEqual(passkeyVerifyFailure(new Error('signature verification failed')), {
    error: '通行密钥验证没有通过，请重试',
    errorCode: 'security.passkeyInvalid',
  });
  assert.equal(passkeyVerifyFailure('boom').errorCode, 'security.passkeyInvalid');
});
