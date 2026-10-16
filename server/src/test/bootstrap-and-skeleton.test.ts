/**
 * 连通性、bootstrap 与骨架公共层 契约测试。
 *
 * 连通性探测、bootstrap 配置块、日历落点、搜索与 404、安全响应头 / CORS / 预检。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { CORS_ORIGIN_FOR_TESTS, get, request, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 连通性与启动数据 ─────────────────────────────────────────────

test('连通性接口返回服务标识', async () => {
  const response = await get('/ping');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.ok, true);
  assert.ok(response.body.service);
});

test('bootstrap 下发前端启动所需的全部配置块', async () => {
  const { body } = await get('/api/v1/bootstrap');
  for (const key of [
    'user',
    'theme',
    'ui',
    'capabilities',
    'categories',
    'review',
    'media',
    'announcement',
    'brand',
    'limits',
    'server',
    'calendar',
    'publicBaseUrl',
    'privacyPolicyUrl',
    'lang',
  ]) {
    assert.ok(body[key] !== undefined, `bootstrap 缺少 ${key}`);
  }
  assert.equal(typeof body.lang.defaultPack, 'string');
  assert.ok(Array.isArray(body.lang.packs));
  assert.equal(typeof body.publicBaseUrl, 'string', 'publicBaseUrl 必须是字符串，空串表示没配域名');
  assert.equal(typeof body.privacyPolicyUrl, 'string', 'privacyPolicyUrl 必须是字符串，空串表示没配政策地址');
  assert.strictEqual(body.user.loggedIn, false, '匿名访问应当是访客态');
  assert.ok(body.brand.zh, '缺少中文标题');
  assert.ok(Number(body.limits.exhibitionTitle) > 0, '缺少表单字符数上限');
  assert.ok(Number(body.limits.textFill) > 0, '缺少文本框填写上限');
  assert.ok(Number(body.limits.radioOption) > 0, '缺少单选选项上限');
  assert.ok(Number(body.limits.checkOption) > 0, '缺少多选选项上限');
  assert.deepStrictEqual(body.user.can, {
    register: false,
    profile: false,
    exhibitor: false,
    admin: false,
    limited: false,
  });
  assert.deepStrictEqual(Object.keys(body.media).sort(), ['imageCount', 'imageSizeMb', 'videoCount', 'videoSizeMb']);
  assert.deepStrictEqual(Object.keys(body.server).sort(), [
    'avatarFormats',
    'avatarSizeMb',
    'imageFormats',
    'videoFormats',
  ]);
});

test('带令牌的 bootstrap 返回真实用户态与个人外观模式', async () => {
  const { body } = await get('/api/v1/bootstrap', { token: tokens.admin.token });
  assert.strictEqual(body.user.loggedIn, true);
  assert.strictEqual(body.user.username, 'demo');
  assert.strictEqual(body.user.role, 'admin');
  assert.strictEqual(body.user.can.admin, true);
  assert.ok(['auto', 'light', 'dark'].includes(body.ui.mode));
});

test('bootstrap 的日历落点月份确实有展会', async () => {
  const { body } = await get('/api/v1/bootstrap');
  const landing = body.calendar.landing;
  assert.ok(landing && landing.year && landing.month, '必须下发 calendar.landing');
  const month = await get(`/api/v1/exhibitions/month?year=${landing.year}&month=${landing.month}`);
  assert.ok(month.body.eventDays.length > 0, '落点月份没有展会');
});

test('搜索同时返回展会与用户，空关键词返回空结果', async () => {
  const hit = await get('/api/v1/search?query=智能');
  assert.ok(hit.body.exhibitions.length > 0, '展会应当命中');
  assert.strictEqual(hit.body.count, hit.body.exhibitions.length + hit.body.users.length);
  for (const user of hit.body.users) {
    assert.strictEqual(user.password_hash, undefined, '搜索结果不能带密码哈希');
    assert.strictEqual(typeof user.roleCode, 'string');
  }
  const exhibitorHit = await get('/api/v1/search?query=exhibitor');
  assert.ok(exhibitorHit.body.users.some((user: { roleCode?: string }) => user.roleCode === 'exhibitor'));

  const empty = await get('/api/v1/search?query=');
  assert.deepStrictEqual(empty.body.exhibitions, []);
  assert.strictEqual(empty.body.count, 0);
});

test('未知路径返回 404 而不是 500', async () => {
  const response = await get('/api/v1/not-an-endpoint');
  assert.strictEqual(response.status, 404);
  assert.ok(response.body.error);
  // 404 也要带统一的安全响应头与 CORS 头：公共层不挑响应
  assert.strictEqual(response.headers?.['x-content-type-options'], 'nosniff');
  assert.strictEqual(response.headers?.['access-control-allow-origin'], CORS_ORIGIN_FOR_TESTS);
});

/**
 * 骨架公共层在真服务上的样子：安全响应头、CORS、请求日志。
 *
 * 这些断言放在契约测试里，覆盖真实 Hono 路由的公共响应边界。
 */
test('骨架公共层：安全响应头与 CORS 头在业务响应上一并生效', async () => {
  const response = await get('/api/v1/bootstrap');
  assert.strictEqual(response.status, 200);
  const headers = response.headers ?? {};
  // 业务响应也带着骨架的安全头
  assert.strictEqual(headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(headers['x-frame-options'], 'SAMEORIGIN');
  assert.strictEqual(headers['referrer-policy'], 'no-referrer');
  assert.ok(headers['strict-transport-security'], '缺少 HSTS 头');
  // 不广播技术栈
  assert.strictEqual(headers['x-powered-by'], undefined);
  // CORS：固定来源 + Vary
  assert.strictEqual(headers['access-control-allow-origin'], CORS_ORIGIN_FOR_TESTS);
  assert.strictEqual(headers.vary, 'Origin');
});

test('骨架公共层：预检在到达路由之前就被答掉', async () => {
  const response = await request('OPTIONS', '/api/v1/auth/login', {
    headers: {
      origin: CORS_ORIGIN_FOR_TESTS,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.strictEqual(response.status, 204);
  assert.ok(response.body === '' || response.body === null, '预检不应当有正文');
  assert.strictEqual(response.headers?.['access-control-allow-origin'], CORS_ORIGIN_FOR_TESTS);
  assert.strictEqual(response.headers?.['access-control-allow-methods'], 'GET,HEAD,PUT,PATCH,POST,DELETE');
  assert.strictEqual(response.headers?.['access-control-allow-headers'], 'authorization,content-type');
});
