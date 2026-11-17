/**
 * 管理员视图：管理员可以在用户公开页代改他人资料。
 *
 * - 管理员 `PUT /users/:id/profile` 成功，公开页读回新资料；
 * - 普通用户调用被 403 拦住；
 * - 邮箱仍不允许在这个接口改（与本人资料一致），返回稳定错误码。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { get, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('管理员代改用户公开资料，公开页立即生效', async () => {
  const targetId = String(tokens.user.user.id);
  const updated = await put(
    `/api/v1/users/${targetId}/profile`,
    {
      nickname: '管理员代改昵称',
      bio: '管理员代改简介',
      region: '江苏省南京市',
      socialMedia: '@admin-edited',
      showRegistrations: true,
    },
    { token: tokens.admin.token },
  );
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.ok, true, JSON.stringify(updated.body));
  assert.strictEqual(updated.body.profile.nickname, '管理员代改昵称');
  assert.strictEqual(updated.body.profile.bio, '管理员代改简介');
  assert.strictEqual(updated.body.profile.region, '江苏省南京市');
  assert.strictEqual(updated.body.profile.socialMedia, '@admin-edited');
  assert.strictEqual(updated.body.profile.showRegistrations, true);

  const publicProfile = await get(`/api/v1/users/public?userId=${targetId}`, { token: tokens.admin.token });
  assert.strictEqual(publicProfile.status, 200);
  assert.strictEqual(publicProfile.body.nickname, '管理员代改昵称');
  assert.strictEqual(publicProfile.body.bio, '管理员代改简介');
  assert.strictEqual(publicProfile.body.region, '江苏省南京市');
  assert.strictEqual(publicProfile.body.socialMedia, '@admin-edited');
});

test('普通用户不能代改资料；邮箱仍走验证流程', async () => {
  const targetId = String(tokens.user.user.id);
  const forbidden = await put(
    `/api/v1/users/${targetId}/profile`,
    { nickname: '越权改名' },
    { token: tokens.user.token },
  );
  assert.strictEqual(forbidden.status, 403);

  const email = await put(
    `/api/v1/users/${targetId}/profile`,
    { email: 'new@example.com' },
    { token: tokens.admin.token },
  );
  assert.strictEqual(email.body.ok, false);
  assert.strictEqual(email.body.errorCode, 'validation.emailChangeViaFlow');

  const anonymous = await put(`/api/v1/users/${targetId}/profile`, { nickname: '匿名改名' });
  assert.strictEqual(anonymous.status, 401);
});
