/**
 * 状态报告与状态页 契约测试。
 *
 * 状态接口的完整健康报告、接口清单与注册路由一致、状态页 HTML 自包含、数据库不可用时的降级渲染。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { STEPS } from '../config/migrate.js';
import { renderStatusPage } from '../status-page.js';
import { backendRoutes, get, serverPort, startContract, stopContract } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 状态报告与状态页 ─────────────────────────────────────────────

/**
 * 连响应头一起返回的请求：既有用例共用的 `request()` 只回状态码与响应体，
 * 而状态页要断言 `content-type`，所以这里单独写一个，不动公共工具。
 */
function requestRaw(
  method: string,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: serverPort(),
        path: encodeURI(path),
        method,
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('状态接口给出一份完整的健康报告', async () => {
  const response = await get('/api/v1/status');
  assert.strictEqual(response.status, 200, `服务与数据库都正常时应当是 200：${JSON.stringify(response.body)}`);
  const report = response.body;

  assert.strictEqual(report.ok, true, 'ok 只在服务活着且数据库答得上时为 true');
  assert.strictEqual(report.database.connected, true);
  assert.ok(Number.isFinite(report.database.latencyMs) && report.database.latencyMs >= 0, '必须实测数据库延迟');
  assert.ok(
    String(report.database.version).includes('PostgreSQL'),
    `版本串不像 PostgreSQL：${report.database.version}`,
  );
  assert.ok(report.database.database, '缺少库名');
  assert.ok(report.database.host, '缺少地址');
  assert.strictEqual(typeof report.database.pool.total, 'number');
  assert.strictEqual(typeof report.database.pool.idle, 'number');
  assert.strictEqual(typeof report.database.pool.waiting, 'number');
  assert.strictEqual(report.database.error, undefined, '数据库正常时不该带错误信息');

  // 迁移：与 STEPS 逐条对齐，测试库是刚建好的，因此不该有遗漏。
  assert.deepStrictEqual(report.migrations.pending, [], '测试库刚迁移完，不该有未应用的步骤');
  assert.deepStrictEqual(
    report.migrations.applied.map((item: any) => item.id).sort(),
    STEPS.map((step) => step.id).sort(),
    '已应用列表必须与 migrate.js 的 STEPS 一致',
  );
  for (const item of report.migrations.applied) {
    assert.ok(!Number.isNaN(Date.parse(item.appliedAt)), `${item.id} 的 appliedAt 不是时间`);
  }

  // 数据量：示例数据至少有账号与展会。
  assert.ok(report.data.users > 0, '示例数据至少要有账号');
  for (const table of ['users', 'exhibitions', 'registrations', 'exhibition_fields', 'app_settings']) {
    assert.strictEqual(typeof report.data[table], 'number', `${table} 应当给出行数`);
  }

  // 服务信息
  assert.strictEqual(report.service.name, 'calmobile-server');
  assert.ok(String(report.service.node).startsWith('v'), `Node 版本不对：${report.service.node}`);
  assert.ok(report.service.uptimeSec >= 0);
  assert.ok(report.service.timeZone, '缺少时区');
  assert.ok(!Number.isNaN(Date.parse(report.service.now)), 'now 必须是时间');
  assert.ok(!Number.isNaN(Date.parse(report.service.startedAt)), 'startedAt 必须是时间');

  // 自检项：结构完整，且在当前环境（真库 + 真密钥）下应当全绿。
  assert.ok(Array.isArray(report.checks) && report.checks.length >= 6, '自检项至少要有 6 条');
  for (const check of report.checks) {
    assert.ok(check.name, '自检项要有名字');
    assert.ok(check.detail, `${check.name} 缺少说明`);
    assert.ok(['ok', 'fail'].includes(check.status), `自检项状态只能是 ok/fail：${check.status}`);
    assert.ok(Number.isFinite(check.ms), `${check.name} 缺少耗时`);
  }
  assert.deepStrictEqual(
    report.checks.filter((check: any) => check.status === 'fail').map((check: any) => check.name),
    [],
    '测试环境里不该有失败的自检项',
  );

  const endpoints = report.endpoints.map((item: any) => `${item.method} ${item.path}`);
  assert.ok(endpoints.includes('GET /api/v1/bootstrap'), '接口清单缺少 GET /api/v1/bootstrap');
  assert.ok(endpoints.includes('POST /api/v1/checkin'), '接口清单缺少 POST /api/v1/checkin');
});

test('状态报告的接口清单与后端注册路由一致', async () => {
  const { body } = await get('/api/v1/status');
  assert.ok(body.endpoints.length > 0, '接口清单不能为空');

  const declared = backendRoutes()
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  const reported = body.endpoints.map((item: any) => `${item.method} ${item.path}`).sort();
  assert.deepStrictEqual(reported, declared, '接口清单与后端注册的路由对不上');

  const documentedPlain = new Set(['/ping', '/health', '/status']);
  for (const item of body.endpoints) {
    assert.ok(item.method && item.path, '接口清单每一项都要有 method 与 path');
    assert.ok(
      item.path.startsWith('/api/v1') || documentedPlain.has(item.path),
      `接口清单里出现未登记的路径：${item.path}`,
    );
  }
});

test('状态页返回可直接打开的中文 HTML', async () => {
  const response = await requestRaw('GET', '/status');
  assert.strictEqual(response.status, 200, '状态页必须打得开');
  assert.ok(
    String(response.headers['content-type']).includes('text/html'),
    `content-type 应当是 HTML：${response.headers['content-type']}`,
  );
  const html = response.body;

  assert.ok(html.includes('calmobile-server'), '页面要显示服务名');
  assert.ok(html.includes('正常'), '页面要显示「正常」徽章');
  assert.ok(html.includes('异常'), '刷新脚本要能切到「异常」徽章');
  for (const title of ['服务信息', '数据库', '迁移', '数据量', '自检项', '接口清单']) {
    assert.ok(html.includes(title), `页面缺少卡片：${title}`);
  }
  assert.ok(html.includes('自动刷新'), '缺少自动刷新开关');
  assert.ok(html.includes("fetch('/api/v1/status'"), '页面脚本应当自己拉 JSON 局部更新');
  assert.match(html, /prefers-color-scheme:\s*(dark|light)/, '颜色模式要跟随系统');
  // 单文件自包含：不能有外部脚本、样式或图片。
  assert.strictEqual(/<script[^>]+src=/.test(html), false, '状态页不能引用外部脚本');
  assert.strictEqual(/<(link|img)\b/.test(html), false, '状态页不能引用外部资源');
});

test('数据库不可用时状态页仍能渲染出通用失败提示', async () => {
  // 真的把数据库停掉属于运维动作，这里用一份真实的失败报告走一遍模板：
  // 页面渲染不碰数据库，因此这条断言能稳定复现「降级时页面照样打得开」。
  const { body } = await get('/api/v1/status');
  const broken = {
    ...body,
    ok: false,
    database: {
      ...body.database,
      connected: false,
      latencyMs: null,
      version: '',
      database: '',
      host: '',
      error: '数据库暂时不可用，请查看服务端日志',
    },
    migrations: { applied: [], pending: ['0001-core'], error: '数据库暂时不可用，请查看服务端日志' },
    data: { users: null, exhibitions: null, registrations: null, exhibition_fields: null, app_settings: null },
    checks: [
      { name: '数据库连通', status: 'fail', detail: '数据库暂时不可用，请查看服务端日志', ms: 2000 },
      { name: '至少一场展会', status: 'fail', detail: '数据库不可用，统计不了展会', ms: 0 },
    ],
  };
  const html = renderStatusPage(broken);
  assert.ok(html.includes('异常'), '徽章要变成「异常」');
  assert.ok(html.includes('数据库暂时不可用，请查看服务端日志'), '页面要显示通用错误提示');
  assert.strictEqual(html.includes('ECONNREFUSED'), false, '页面不能显示数据库的报错原文');
  assert.ok(html.includes('未连接'), '连通状态要显示「未连接」');
  assert.ok(html.includes('失败'), '自检项要能显示失败');
  assert.ok(html.includes('0001-core'), '未应用的迁移要列出来');
  // 首屏数据是内嵌的 JSON，坏消息也应当已经进去了。
  assert.ok(html.includes('"connected":false'), '首屏就应当带着失败状态');
});
