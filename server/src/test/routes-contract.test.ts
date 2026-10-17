/**
 * 路由契约 契约测试。
 *
 * 前端每个数据动作都对应后端已注册路由，后端没有前端用不到的孤立路由。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import {
  ENDPOINT_SAMPLES,
  backendRoutes,
  frontendEndpointMap,
  startContract,
  stopContract,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 与前端映射表的交叉校验 ───────────────────────────────────────

/**
 * 前端每个数据动作都必须能在后端找到对应路由。
 *
 * 这条断言是「76 个动作全部实现」的机器化证据：漏实现一个动作、或者改了路径忘了
 * 同步 `ENDPOINTS`，都会在这里失败，而不是等到某个页面在真机上静默报错。
 */
test('前端每个数据动作都对应后端已注册的路由', () => {
  const endpoints = frontendEndpointMap;
  const actions = Object.keys(endpoints);
  assert.strictEqual(
    actions.length,
    76,
    `前端数据动作数量变了（期望 76）：${actions.length} 个 —— ${actions.join(', ')}`,
  );

  const declared = backendRoutes();

  const missing = [];
  for (const action of actions) {
    for (const payload of ENDPOINT_SAMPLES) {
      const request = endpoints[action]?.(payload);
      assert.ok(request && request.method && request.path, `${action} 的映射没返回 method/path`);
      // 前端映射里的 path 是 BASE_URL（…/api/v1）之后的相对路径。
      const full = `/api/v1${request.path}`;
      const hit = declared.some((route) => route.method === request.method && route.pattern.test(full));
      if (!hit) {
        missing.push(`${action} → ${request.method} ${full}`);
      }
    }
  }

  assert.deepStrictEqual(missing, [], `以下前端动作在后端没有对应路由：\n  ${missing.join('\n  ')}`);
});

test('后端没有前端用不到的孤立路由', () => {
  const declared = backendRoutes();
  const endpoints = frontendEndpointMap;
  const used = new Set();
  for (const [, map] of Object.entries(endpoints)) {
    for (const payload of ENDPOINT_SAMPLES) {
      const request = map(payload);
      const full = `/api/v1${request.path}`;
      for (const route of declared) {
        if (route.method === request.method && route.pattern.test(full)) {
          used.add(`${route.method} ${route.path}`);
        }
      }
    }
  }
  // 这两个是刻意保留、不走前端动作表的：刷新令牌与「撤销全部会话」由 api.js 直接调用；
  // 个人配色 `PUT /settings/ui-theme` 由前端 `settings.uiTheme` 动作使用，因此不在名单里。
  const intentional = new Set(['POST /api/v1/auth/refresh', 'POST /api/v1/auth/logout-all']);
  const orphans = declared
    .map((route) => `${route.method} ${route.path}`)
    .filter((key) => !used.has(key) && !intentional.has(key));
  assert.deepStrictEqual(orphans, [], `以下后端路由没有任何前端动作用到，属于冗余：\n  ${orphans.join('\n  ')}`);
});
