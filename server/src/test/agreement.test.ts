/**
 * 用户协议 契约测试。
 *
 * 公开读取、管理端开关与正文上传、正文变化升版本、登录用户同意（版本必须匹配），
 * 以及启动数据只带摘要。迁移 0025 给 users 加的同意状态也在这里验证。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { get, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

const CONTENT = '# 用户协议\n\n第一条：本协议用于测试。\n';

test('用户协议默认关闭，公开接口可读', async () => {
  const read = await get('/api/v1/agreement');
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.body.enabled, false);
  assert.strictEqual(read.body.version, 0);
  assert.strictEqual(read.body.content, '');

  const bootstrap = await get('/api/v1/bootstrap');
  assert.strictEqual(bootstrap.body.agreement.enabled, false);
  assert.strictEqual(bootstrap.body.agreement.version, 0);
  assert.strictEqual('content' in bootstrap.body.agreement, false, 'bootstrap 只带摘要，不带正文');
});

test('开启但没正文时拒绝保存', async () => {
  const result = await put(
    '/api/v1/settings',
    { agreement: { enabled: true, content: '' } },
    { token: tokens.admin.token },
  );
  assert.strictEqual(result.body.ok, false);
  assert.strictEqual(result.body.errorCode, 'settings.agreementContentRequired');
});

test('管理员上传正文后版本为 1，公开接口与启动数据同步', async () => {
  const saved = await put(
    '/api/v1/settings',
    { agreement: { enabled: true, content: CONTENT } },
    { token: tokens.admin.token },
  );
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.settings.agreement.enabled, true);
  assert.strictEqual(saved.body.settings.agreement.version, 1);
  assert.strictEqual(saved.body.settings.agreement.content, CONTENT, '管理员能读回正文');
  assert.ok(saved.body.settings.agreement.updatedAt.length > 0);

  const read = await get('/api/v1/agreement');
  assert.strictEqual(read.body.enabled, true);
  assert.strictEqual(read.body.version, 1);
  assert.strictEqual(read.body.content, CONTENT);

  const bootstrap = await get('/api/v1/bootstrap');
  assert.strictEqual(bootstrap.body.agreement.enabled, true);
  assert.strictEqual(bootstrap.body.agreement.version, 1);

  // 非管理员读设置时只拿摘要
  const asUser = await get('/api/v1/settings', { token: tokens.user.token });
  assert.strictEqual(asUser.body.agreement.enabled, true);
  assert.strictEqual('content' in asUser.body.agreement, false, '正文只下发给管理员');
});

test('正文不变时重复保存不升版本，改正文升到 2', async () => {
  const same = await put(
    '/api/v1/settings',
    { agreement: { enabled: true, content: CONTENT } },
    { token: tokens.admin.token },
  );
  assert.strictEqual(same.body.settings.agreement.version, 1);

  const updated = await put(
    '/api/v1/settings',
    { agreement: { content: '# 用户协议 v2\n' } },
    { token: tokens.admin.token },
  );
  assert.strictEqual(updated.body.settings.agreement.version, 2);
  assert.strictEqual(updated.body.settings.agreement.content, '# 用户协议 v2\n');
});

test('登录用户只能同意当前版本，并记录到账号', async () => {
  const wrong = await post('/api/v1/profile/agreement', { version: 1 }, { token: tokens.user.token });
  assert.strictEqual(wrong.status, 200);
  assert.strictEqual(wrong.body.ok, false);
  assert.strictEqual(wrong.body.errorCode, 'profile.agreementVersionChanged');

  const accepted = await post('/api/v1/profile/agreement', { version: 2 }, { token: tokens.user.token });
  assert.strictEqual(accepted.body.ok, true, JSON.stringify(accepted.body));
  assert.strictEqual(accepted.body.agreedTermsVersion, 2);
  assert.ok(accepted.body.agreedTermsAt.length > 0);

  const profile = await get('/api/v1/profile', { token: tokens.user.token });
  assert.strictEqual(profile.body.agreedTermsVersion, 2);

  // 管理员用户列表也带同意状态，管理端据此标识
  const users = await get('/api/v1/users?query=', { token: tokens.admin.token });
  const listed = users.body.find((item: any) => item.id === tokens.user.user?.id);
  assert.strictEqual(listed.agreedTermsVersion, 2);

  // 幂等：再同意一次仍是这个版本
  const again = await post('/api/v1/profile/agreement', { version: 2 }, { token: tokens.user.token });
  assert.strictEqual(again.body.ok, true);
  assert.strictEqual(again.body.agreedTermsVersion, 2);
});

test('关闭后不再接受同意请求，入口由前端按 enabled 隐藏', async () => {
  const disabled = await put('/api/v1/settings', { agreement: { enabled: false } }, { token: tokens.admin.token });
  assert.strictEqual(disabled.body.settings.agreement.enabled, false);
  assert.strictEqual(disabled.body.settings.agreement.version, 2, '只拨开关不升版本');

  const read = await get('/api/v1/agreement');
  assert.strictEqual(read.body.enabled, false);
  assert.strictEqual(read.body.version, 2);

  const rejected = await post('/api/v1/profile/agreement', { version: 2 }, { token: tokens.user.token });
  assert.strictEqual(rejected.body.ok, false);
  assert.strictEqual(rejected.body.errorCode, 'profile.agreementDisabled');
});

test('未登录不能同意，非法版本按校验失败', async () => {
  const anonymous = await post('/api/v1/profile/agreement', { version: 1 });
  assert.strictEqual(anonymous.status, 401);

  const invalid = await post('/api/v1/profile/agreement', { version: -1 }, { token: tokens.user.token });
  assert.strictEqual(invalid.status, 400);
});
