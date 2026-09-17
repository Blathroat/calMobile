/**
 * 后端契约与规则测试。
 *
 * 跑法：`npm run test:contract`（等价于 `node --test test/api.test.js`）。
 *
 * 这个文件做三件事：
 *
 * 1. **契约**：逐接口断言页面真正用到的字段都在。字段漂移会在这里失败，
 *    而不是在页面上静默渲染成空；
 * 2. **权限**：访客 / 普通用户 / 展商 / 管理员四类身份的越权访问必须被拦住；
 * 3. **业务规则**：报名窗口、重复报名、自动通过、审核流转、核销状态、隐私开关。
 *
 * 用独立的测试库（默认 `calmobile_test`），每次运行都重建，因此可以反复执行、
 * 不会污染开发库里的数据。
 */

// 必须在 require 任何 src 模块之前设置：config/database.js 是加载时读环境变量的。
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'calmobile_test';
process.env.LOG_LEVEL = 'quiet';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'calmobile-test-access-secret-32-characters';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'calmobile-test-refresh-secret-32-chars';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { before, after } = require('node:test');
const { Client } = require('pg');

const database = require('../src/config/database');
const { pool } = require('../src/config/pool');
const { migrate, seed } = require('../src/config/migrate');
const { app, routes } = require('../src/index');

let server;

// ── HTTP 小工具 ──────────────────────────────────────────────────

/** 发一次请求；返回 { status, body }，body 已解析成对象（解析失败给原始文本）。 */
function request(method, path, { token, body } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      // 查询串里有中文（状态筛选、搜索关键词），http 模块要求路径已编码；
      // encodeURI 保留 / ? & =，正好是「路径 + 查询串」需要的粒度。
      path: encodeURI(path),
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let parsed = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch (ignored) {
          // 保持原始文本，便于断言失败时看清返回了什么
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

const get = (path, options) => request('GET', path, options);
const post = (path, body, options) => request('POST', path, { ...options, body });
const put = (path, body, options) => request('PUT', path, { ...options, body });
const del = (path, options) => request('DELETE', path, options);

/** 示例展会的日期是相对今天生成的，因此期望值也要按「今天」算出来。 */
function isoDateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 登录并返回 { token, refreshToken, user }。 */
async function login(username, password = 'password') {
  const response = await post('/api/v1/auth/login', { username, password });
  assert.strictEqual(response.status, 200, `登录 ${username} 失败：${JSON.stringify(response.body)}`);
  assert.strictEqual(response.body.ok, true, `登录 ${username} 返回失败：${JSON.stringify(response.body)}`);
  return response.body;
}

const tokens = {};

before(async () => {
  // 每次运行都重建测试库：连接维护库（postgres）后 drop/create。
  const admin = new Client({
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${database.database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database.database}`);
  await admin.end();

  await migrate();
  await seed();

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  tokens.admin = await login('demo');
  tokens.exhibitor = await login('exhibitor');
  tokens.user = await login('user');
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

// ── 连通性与启动数据 ─────────────────────────────────────────────

test('连通性接口返回服务标识', async () => {
  const response = await get('/ping');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.ok, true);
  assert.ok(response.body.service);
});

test('bootstrap 下发前端启动所需的全部配置块', async () => {
  const { body } = await get('/api/v1/bootstrap');
  for (const key of ['user', 'theme', 'ui', 'capabilities', 'categories', 'review',
    'media', 'announcement', 'brand', 'limits', 'server', 'calendar']) {
    assert.ok(body[key] !== undefined, `bootstrap 缺少 ${key}`);
  }
  assert.strictEqual(body.user.loggedIn, false, '匿名访问应当是访客态');
  assert.ok(body.brand.zh, '缺少中文标题');
  assert.ok(Number(body.limits.exhibitionTitle) > 0, '缺少表单字符数上限');
  assert.deepStrictEqual(body.user.can, { register: false, profile: false, exhibitor: false, admin: false });
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

// ── 认证 ────────────────────────────────────────────────────────

test('登录返回访问令牌与刷新令牌，密码错误给业务失败', async () => {
  const ok = await post('/api/v1/auth/login', { username: 'demo', password: 'password' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.ok, true);
  assert.ok(ok.body.token, '缺少访问令牌');
  assert.ok(ok.body.refreshToken, '缺少刷新令牌');
  assert.strictEqual(ok.body.user.role, 'admin');

  const bad = await post('/api/v1/auth/login', { username: 'demo', password: 'wrong' });
  assert.strictEqual(bad.status, 200, '业务失败应当是 200 + ok:false');
  assert.strictEqual(bad.body.ok, false);
  assert.ok(bad.body.error, '必须给出可展示的错误');
});

test('刷新令牌可轮换，旧的一次性作废', async () => {
  const session = await login('user');
  const first = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(first.status, 200);
  assert.ok(first.body.token && first.body.refreshToken, '刷新应当换回一套新令牌');
  assert.notStrictEqual(first.body.refreshToken, session.refreshToken, '刷新令牌应当轮换');

  const reused = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(reused.status, 401, '旧刷新令牌必须失效');
});

test('退出登录会撤销刷新令牌', async () => {
  const session = await login('user');
  const out = await post('/api/v1/auth/logout', { refreshToken: session.refreshToken });
  assert.strictEqual(out.body.ok, true);
  const reused = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(reused.status, 401);
});

test('未登录访问需要身份的接口返回 401', async () => {
  for (const path of ['/api/v1/profile', '/api/v1/registrations', '/api/v1/review?exhibitionId=exh-1']) {
    const response = await get(path);
    assert.strictEqual(response.status, 401, `${path} 应当要求登录`);
    assert.ok(response.body.error, `${path} 缺少错误说明`);
  }
});

test('注册会校验用户名、密码与邮箱，并可直接登录', async () => {
  const short = await post('/api/v1/auth/register', { username: 'ab', password: 'password', email: 'a@b.com' });
  assert.strictEqual(short.body.ok, false);

  const weak = await post('/api/v1/auth/register', { username: 'tester01', password: '123', email: 'a@b.com' });
  assert.strictEqual(weak.body.ok, false);

  const badEmail = await post('/api/v1/auth/register', { username: 'tester01', password: 'password', email: 'nope' });
  assert.strictEqual(badEmail.body.ok, false);

  const created = await post('/api/v1/auth/register', {
    username: 'tester01', password: 'password', email: 'tester01@example.com',
  });
  assert.strictEqual(created.body.ok, true, `注册失败：${JSON.stringify(created.body)}`);
  assert.strictEqual(created.body.user.role, 'user', '自助注册固定为普通用户');
  assert.ok(created.body.token, '注册后应当直接进入登录态');

  const duplicate = await post('/api/v1/auth/register', {
    username: 'tester01', password: 'password', email: 'other@example.com',
  });
  assert.strictEqual(duplicate.body.ok, false);
  assert.ok(duplicate.body.error.includes('已被注册'));
});

// ── 展会契约 ────────────────────────────────────────────────────

test('展会列表字段覆盖页面渲染所需的全部字段', async () => {
  const { body } = await get('/api/v1/exhibitions');
  assert.ok(Array.isArray(body) && body.length > 0, '示例数据至少要有展会');
  const required = ['id', 'title', 'venue', 'time', 'category', 'description',
    'descriptionFormat', 'status', 'mode', 'modeLabel', 'openForRegistration',
    'year', 'month', 'day', 'date', 'dateLabel', 'exhibitor', 'exhibitorNote',
    'highlights', 'imageUri', 'registrationStart', 'registrationEnd', 'qrEnabled',
    'registrationCount', 'fieldCount'];
  for (const item of body) {
    for (const key of required) {
      assert.ok(item[key] !== undefined, `展会 ${item.id} 缺少字段 ${key}`);
    }
    assert.strictEqual(typeof item.qrEnabled, 'boolean');
    assert.strictEqual(typeof item.openForRegistration, 'boolean');
    assert.strictEqual(typeof item.registrationCount, 'number');
    assert.strictEqual(typeof item.fieldCount, 'number');
  }
});

test('月视图返回三块数据，且原样返回请求的月份与日期', async () => {
  // 示例展会相对今天生成，落点月份就是「第一场展会所在的月份」。
  const bootstrap = await get('/api/v1/bootstrap');
  const landing = bootstrap.body.calendar.landing;
  const june = await get(`/api/v1/exhibitions/month?year=${landing.year}&month=${landing.month}`);
  assert.strictEqual(june.body.year, landing.year);
  assert.strictEqual(june.body.month, landing.month);
  assert.ok(june.body.eventDays.length > 0, '落点月份应当有展会');
  assert.ok(june.body.monthLabel.includes(String(landing.year)));
  assert.ok(june.body.eventDays.includes(june.body.day), '缺省选中日期应当是有展会的日期');
  assert.ok(Array.isArray(june.body.exhibitions) && Array.isArray(june.body.selected));

  // 指定了没有展会的日期：原样返回，由页面显示空状态
  const firstEventDay = june.body.eventDays[0];
  const otherDay = firstEventDay === 1 ? 2 : 1;
  const emptyDay = await get(
    `/api/v1/exhibitions/month?year=${landing.year}&month=${landing.month}&day=${otherDay}`,
  );
  assert.strictEqual(emptyDay.body.day, otherDay, '选中日期被服务端改写了');
  assert.strictEqual(emptyDay.body.selected.length, 0);

  // 空月份：原样返回，不回落到有数据的月份
  const emptyMonth = await get(`/api/v1/exhibitions/month?year=${landing.year}&month=${((landing.month + 5) % 12) + 1}`);
  assert.strictEqual(emptyMonth.body.month, ((landing.month + 5) % 12) + 1);
  assert.strictEqual(emptyMonth.body.eventDays.length, 0);
  assert.strictEqual(emptyMonth.body.day, 0);
});

test('展会详情带收集项，找不到时给 found:false', async () => {
  const detail = await get('/api/v1/exhibitions/exh-1');
  assert.strictEqual(detail.body.found, true);
  assert.strictEqual(detail.body.exhibition.id, 'exh-1');
  assert.ok(Array.isArray(detail.body.fields) && detail.body.fields.length > 0, '缺少报名收集项');

  const missing = await get('/api/v1/exhibitions/exh-not-exist');
  assert.strictEqual(missing.status, 200);
  assert.strictEqual(missing.body.found, false);
  assert.ok(missing.body.error);
});

test('展会可按关键词搜索，分类来自服务器设置', async () => {
  const hit = await get('/api/v1/exhibitions?query=智能');
  assert.ok(hit.body.some((item) => item.title.includes('智能')), '搜索没有命中');
  const miss = await get('/api/v1/exhibitions?query=不存在的关键词');
  assert.deepStrictEqual(miss.body, []);

  const categories = await get('/api/v1/exhibitions/categories');
  assert.ok(Array.isArray(categories.body) && categories.body.length > 0);
});

// ── 展会写权限 ──────────────────────────────────────────────────

test('展会的增删改受角色与归属限制', async () => {
  const anonymous = await post('/api/v1/exhibitions', { title: 'x' });
  assert.strictEqual(anonymous.status, 401, '访客不能新建展会');

  const asUser = await post('/api/v1/exhibitions', { title: 'x' }, { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403, '普通用户不能新建展会');

  // 展商新建一场自己的展会
  const created = await post('/api/v1/exhibitions', {
    title: '接口测试展',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: '2026-09-20',
    registrationStart: '2026-08-01',
    registrationEnd: '2026-09-10',
    category: '智能家居',
    status: '需审核',
    description: '契约测试用',
    highlights: ['测试'],
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(created.body.ok, true, `新建失败：${JSON.stringify(created.body)}`);
  const id = created.body.exhibition.id;
  assert.strictEqual(created.body.exhibition.date, '2026-09-20');
  assert.strictEqual(created.body.exhibition.day, 20, '日期必须按 SQL 派生，不能因时区差一天');

  // 校验：截止早于开始、日期非法、标题超长
  const badRange = await put(`/api/v1/exhibitions/${id}`, {
    title: '接口测试展', venue: '测试展馆', time: '09:00-17:00', date: '2026-09-20',
    registrationStart: '2026-09-10', registrationEnd: '2026-08-01', status: '需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(badRange.body.ok, false);
  assert.ok(badRange.body.error.includes('报名截止'), `提示不对：${badRange.body.error}`);

  const badDate = await put(`/api/v1/exhibitions/${id}`, {
    title: '接口测试展', venue: '测试展馆', time: '09:00-17:00', date: '2026-02-31', status: '需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(badDate.body.ok, false, '2026-02-31 不是有效日期');

  const longTitle = await put(`/api/v1/exhibitions/${id}`, {
    title: '超'.repeat(200), venue: '测试展馆', time: '09:00-17:00', date: '2026-09-20', status: '需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(longTitle.body.ok, false, '标题超长必须被服务端拦住');

  // 另一个展商（用普通用户冒充）不能改别人的展会
  const otherUser = await put(`/api/v1/exhibitions/${id}`, { title: 'x' }, { token: tokens.user.token });
  assert.strictEqual(otherUser.status, 403);

  // 管理员可以改
  const asAdmin = await put(`/api/v1/exhibitions/${id}/status`, { status: '无需审核' }, { token: tokens.admin.token });
  assert.strictEqual(asAdmin.body.ok, true, JSON.stringify(asAdmin.body));
  assert.strictEqual((await get(`/api/v1/exhibitions/${id}`)).body.exhibition.status, '无需审核');

  const removed = await del(`/api/v1/exhibitions/${id}`, { token: tokens.exhibitor.token });
  assert.strictEqual(removed.body.ok, true, `删除失败：${JSON.stringify(removed.body)}`);
  const gone = await get(`/api/v1/exhibitions/${id}`);
  assert.strictEqual(gone.body.found, false);
});

test('展会收集项可以整体覆盖并读回', async () => {
  const saved = await put('/api/v1/exhibitions/exh-2/fields', {
    fields: [
      { title: '姓名 / 公司名称', type: '文本', required: true, options: [] },
      { title: '参观身份', type: '单选', required: true, options: ['专业观众', '媒体'] },
    ],
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(saved.body.ok, true, `保存收集项失败：${JSON.stringify(saved.body)}`);
  assert.strictEqual(saved.body.fields.length, 2);

  const read = await get('/api/v1/exhibitions/exh-2/fields');
  assert.strictEqual(read.body.length, 2);
  assert.deepStrictEqual(read.body[1].options, ['专业观众', '媒体']);
});

// ── 报名 ────────────────────────────────────────────────────────

test('我的报名只返回自己的记录', async () => {
  const mine = await get('/api/v1/registrations', { token: tokens.user.token });
  assert.ok(Array.isArray(mine.body) && mine.body.length > 0);
  const required = ['id', 'exhibitionId', 'exhibitionTitle', 'exhibitionDay',
    'exhibitionTime', 'exhibitionVenue', 'visitorName', 'visitorType', 'answers',
    'statusLabel', 'qrEnabled', 'checkInCode'];
  for (const item of mine.body) {
    for (const key of required) {
      assert.ok(item[key] !== undefined, `报名 ${item.id} 缺少字段 ${key}`);
    }
  }
  // 种子数据里 reg-1/reg-3 属于 user，reg-2 属于 exhibitor
  assert.ok(mine.body.every((item) => ['reg-1', 'reg-3'].includes(item.id)),
    `看到了别人的报名：${mine.body.map((item) => item.id).join(',')}`);

  const others = await get('/api/v1/registrations', { token: tokens.exhibitor.token });
  assert.ok(others.body.every((item) => item.id === 'reg-2'));
});

test('报名码只在启用二维码且已通过时下发', async () => {
  const mine = await get('/api/v1/registrations', { token: tokens.user.token });
  const approved = mine.body.find((item) => item.id === 'reg-1');
  assert.ok(approved.checkInCode.startsWith('CALMOBILE-CHECKIN|exh-1|reg-1'),
    `已通过且启用二维码应当有报名码：${approved.checkInCode}`);

  const pending = mine.body.find((item) => item.id === 'reg-3');
  assert.strictEqual(pending.checkInCode, '', '未通过或未启用二维码不应下发报名码');
});

test('报名受展会状态与窗口限制，重复报名被拒', async () => {
  // exh-4 仅展示
  const display = await post('/api/v1/registrations', {
    exhibitionId: 'exh-4', visitorName: '测试', visitorType: '专业观众', answers: '',
  }, { token: tokens.user.token });
  assert.strictEqual(display.body.ok, false);
  assert.ok(display.body.error.includes('仅展示'), display.body.error);

  // exh-3 截止报名
  const closed = await post('/api/v1/registrations', {
    exhibitionId: 'exh-3', visitorName: '测试', visitorType: '专业观众', answers: '',
  }, { token: tokens.user.token });
  assert.strictEqual(closed.body.ok, false);

  // 重复报名 exh-1（user 已有 reg-1）
  const duplicate = await post('/api/v1/registrations', {
    exhibitionId: 'exh-1', visitorName: '测试', visitorType: '专业观众', answers: '',
  }, { token: tokens.user.token });
  assert.strictEqual(duplicate.body.ok, false);
  assert.ok(duplicate.body.error.includes('已提交过'), duplicate.body.error);

  // 必填缺失
  const missing = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2', visitorType: '专业观众', answers: '',
  }, { token: tokens.user.token });
  assert.strictEqual(missing.body.ok, false);

  // 访客不能报名
  const anonymous = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2', visitorName: '测试', visitorType: '专业观众', answers: '',
  });
  assert.strictEqual(anonymous.status, 401);
});

test('无需审核的展会提交即通过，撤销后可以重新报名', async () => {
  // exh-2 是需审核；用 admin（种子里没有他的报名）验证流转，避开 usr-3 已有的 reg-3
  const pending = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2', visitorName: '接口测试', visitorType: '专业观众', answers: '姓名：接口测试',
  }, { token: tokens.admin.token });
  assert.strictEqual(pending.body.ok, true, JSON.stringify(pending.body));
  assert.strictEqual(pending.body.autoApproved, false, '需审核的展会不应自动通过');
  assert.strictEqual(pending.body.statusLabel, '待审核');

  const cancelled = await del(`/api/v1/registrations/${pending.body.registration.id}`, { token: tokens.admin.token });
  assert.strictEqual(cancelled.body.ok, true, JSON.stringify(cancelled.body));

  const again = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2', visitorName: '接口测试', visitorType: '专业观众', answers: '',
  }, { token: tokens.admin.token });
  assert.strictEqual(again.body.ok, true, `撤销后应当可以重新报名：${JSON.stringify(again.body)}`);

  // admin 报 exh-1（无需审核）→ 自动通过
  const auto = await post('/api/v1/registrations', {
    exhibitionId: 'exh-1', visitorName: '管理员报名', visitorType: '专业观众', answers: '',
  }, { token: tokens.admin.token });
  assert.strictEqual(auto.body.ok, true, JSON.stringify(auto.body));
  assert.strictEqual(auto.body.autoApproved, true, '无需审核的展会应当自动通过');
  assert.strictEqual(auto.body.statusLabel, '已通过');
});

test('报名窗口由服务端按数据库当前日期判断', async () => {
  // 示例数据里：exh-1 窗口开放、exh-3 已截止、exh-4 是仅展示
  const open = await get('/api/v1/exhibitions/exh-1');
  const today = new Date().toISOString().slice(0, 10);
  const window = open.body.exhibition;
  assert.ok(window.registrationStart <= today && window.registrationEnd >= today,
    `exh-1 的窗口应当覆盖今天：${window.registrationStart} ~ ${window.registrationEnd}`);

  // 造一场窗口还没开始的展会，提交必须被拒且提示说的是窗口而不是别的
  const created = await post('/api/v1/exhibitions', {
    title: '窗口测试展',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: isoDateAfter(60),
    registrationStart: isoDateAfter(30),
    registrationEnd: isoDateAfter(50),
    category: '智能家居',
    status: '无需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const futureId = created.body.exhibition.id;

  const tooEarly = await post('/api/v1/registrations', {
    exhibitionId: futureId, visitorName: '测试', visitorType: '专业观众', answers: '',
  }, { token: tokens.user.token });
  assert.strictEqual(tooEarly.body.ok, false, '窗口未开始不应报名成功');
  assert.ok(tooEarly.body.error.includes('尚未开始'), `提示应说明窗口未开始：${tooEarly.body.error}`);

  // 把窗口改成已结束，提示应当变成截止
  const past = await put(`/api/v1/exhibitions/${futureId}`, {
    title: '窗口测试展', venue: '测试展馆', time: '09:00-17:00', date: isoDateAfter(60),
    registrationStart: isoDateAfter(-30), registrationEnd: isoDateAfter(-1),
    category: '智能家居', status: '无需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(past.body.ok, true, JSON.stringify(past.body));

  const tooLate = await post('/api/v1/registrations', {
    exhibitionId: futureId, visitorName: '测试', visitorType: '专业观众', answers: '',
  }, { token: tokens.user.token });
  assert.strictEqual(tooLate.body.ok, false, '窗口已结束不应报名成功');
  assert.ok(tooLate.body.error.includes('截止'), `提示应说明已截止：${tooLate.body.error}`);

  await del(`/api/v1/exhibitions/${futureId}`, { token: tokens.exhibitor.token });
});

// ── 审核与核销 ──────────────────────────────────────────────────

test('审核列表给出五种状态计数，且只能看自己举办的展会', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-1&status=全部', { token: tokens.exhibitor.token });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.body.records));
  for (const key of ['total', '待审核', '已通过', '已拒绝', '已参加']) {
    assert.strictEqual(typeof list.body.counts[key], 'number', `counts 缺少 ${key}`);
  }
  const pending = await get('/api/v1/review?exhibitionId=exh-1&status=待审核', { token: tokens.exhibitor.token });
  assert.ok(pending.body.records.every((item) => item.status === '待审核'), '筛选项混入了其它状态');

  // 普通用户不能看审核
  const asUser = await get('/api/v1/review?exhibitionId=exh-1', { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);

  // 看一场不存在的展会：拒绝或给出空列表，但不能是 500
  const foreign = await get('/api/v1/review?exhibitionId=exh-not-exist', { token: tokens.exhibitor.token });
  assert.ok([200, 403, 404].includes(foreign.status), `不应是 ${foreign.status}`);
});

test('审核状态可以流转，非法状态被拒', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-2&status=全部', { token: tokens.exhibitor.token });
  const target = list.body.records.find((item) => item.status === '待审核');
  assert.ok(target, 'exh-2 应当有待审核的报名');

  const approved = await put(`/api/v1/review/${target.id}/status`, { status: '已通过' }, { token: tokens.exhibitor.token });
  assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));
  assert.strictEqual(approved.body.record.status, '已通过');

  const invalid = await put(`/api/v1/review/${target.id}/status`, { status: '瞎写的状态' }, { token: tokens.exhibitor.token });
  assert.strictEqual(invalid.body.ok, false);

  const asUser = await put(`/api/v1/review/${target.id}/status`, { status: '已拒绝' }, { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);
});

test('核销把已通过推进为已参加，重复核销与非法码都有明确提示', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-1&status=已通过', { token: tokens.exhibitor.token });
  const approved = list.body.records[0];
  assert.ok(approved, 'exh-1 应当有已通过的报名');

  const first = await post('/api/v1/checkin', { code: `CALMOBILE-CHECKIN|exh-1|${approved.id}` }, { token: tokens.exhibitor.token });
  assert.strictEqual(first.body.ok, true, `首次核销应当成功：${JSON.stringify(first.body)}`);
  assert.strictEqual(first.body.status, '已参加');
  assert.ok(first.body.record.visitorName, '核销结果要带报名人信息');

  const again = await post('/api/v1/checkin', { code: `CALMOBILE-CHECKIN|exh-1|${approved.id}` }, { token: tokens.exhibitor.token });
  assert.strictEqual(again.body.ok, false);
  assert.strictEqual(again.body.duplicated, true);
  assert.ok(again.body.error.includes('已经核销'), again.body.error);

  const unknown = await post('/api/v1/checkin', { code: 'NOT-A-CODE' }, { token: tokens.exhibitor.token });
  assert.strictEqual(unknown.body.ok, false);
  assert.ok(unknown.body.error.includes('无法识别'), unknown.body.error);

  // 待审核的报名不能核销
  const pendingList = await get('/api/v1/review?exhibitionId=exh-2&status=待审核', { token: tokens.exhibitor.token });
  if (pendingList.body.records.length > 0) {
    const pending = pendingList.body.records[0];
    const rejected = await post('/api/v1/checkin', { code: `CALMOBILE-CHECKIN|exh-2|${pending.id}` }, { token: tokens.exhibitor.token });
    assert.strictEqual(rejected.body.ok, false);
    assert.ok(rejected.body.error.includes('待审核'), rejected.body.error);
  }

  const anonymous = await post('/api/v1/checkin', { code: 'CALMOBILE-CHECKIN|exh-1|reg-1' });
  assert.strictEqual(anonymous.status, 401);
});

// ── 用户、隐私与设置 ────────────────────────────────────────────

test('用户列表与账号状态只有管理员能操作', async () => {
  const asUser = await get('/api/v1/users', { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);

  const list = await get('/api/v1/users?query=demo', { token: tokens.admin.token });
  assert.ok(Array.isArray(list.body) && list.body.length > 0, '管理员应当能查到用户');
  const row = list.body[0];
  for (const key of ['id', 'nickname', 'email', 'role', 'status', 'registrationTime', 'lastLoginTime']) {
    assert.ok(row[key] !== undefined, `用户缺少字段 ${key}`);
  }
  assert.strictEqual(row.password_hash, undefined, '不能把密码哈希发出去');

  const limited = await put('/api/v1/users/usr-3/status', { status: '受限' }, { token: tokens.admin.token });
  assert.strictEqual(limited.body.ok, true, JSON.stringify(limited.body));
  assert.strictEqual(limited.body.user.status, '受限');
  const restored = await put('/api/v1/users/usr-3/status', { status: '正常' }, { token: tokens.admin.token });
  assert.strictEqual(restored.body.user.status, '正常');

  const invalid = await put('/api/v1/users/usr-3/status', { status: '乱写' }, { token: tokens.admin.token });
  assert.strictEqual(invalid.body.ok, false);

  const self = await put('/api/v1/users/usr-1/status', { status: '封禁' }, { token: tokens.admin.token });
  assert.strictEqual(self.body.ok, false, '管理员不应该能封禁自己');
});

test('隐私开关决定公开页是否展示报名记录，管理员始终可见', async () => {
  const hidden = await get('/api/v1/users/public?userId=usr-3', { token: tokens.exhibitor.token });
  assert.strictEqual(hidden.body.found, true);
  assert.strictEqual(hidden.body.showRegistrations, false, '默认应当是关闭的');
  assert.strictEqual(hidden.body.viewedAsAdmin, false);
  assert.deepStrictEqual(hidden.body.registrations, [], '关闭时不应返回报名记录');

  // 本人打开开关（顺带验证 profile 保存真的持久化了这个字段）
  const saved = await put('/api/v1/profile', { showRegistrations: true }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true);
  assert.strictEqual(saved.body.user.showRegistrations, true, '保存结果里应当带上开关状态');

  const reread = await get('/api/v1/profile', { token: tokens.user.token });
  assert.strictEqual(reread.body.showRegistrations, true, '隐私开关没有持久化');

  const visible = await get('/api/v1/users/public?userId=usr-3', { token: tokens.exhibitor.token });
  assert.strictEqual(visible.body.showRegistrations, true);
  assert.ok(visible.body.registrations.length > 0, '打开后应当能看到报名记录');

  const asAdmin = await get('/api/v1/users/public?userId=usr-3', { token: tokens.admin.token });
  assert.strictEqual(asAdmin.body.viewedAsAdmin, true, '管理员视角应当被标记');
  assert.ok(asAdmin.body.registrations.length >= visible.body.registrations.length);

  // 还原
  await put('/api/v1/profile', { showRegistrations: false }, { token: tokens.user.token });
});

test('公开页支持按昵称查询', async () => {
  const byNickname = await get('/api/v1/users/public?nickname=user');
  assert.strictEqual(byNickname.body.found, true, '公开页应当支持昵称查询');
  assert.ok(byNickname.body.profile.nickname);
});

test('资料保存只改提交过的字段', async () => {
  const before = await get('/api/v1/profile', { token: tokens.user.token });
  const saved = await put('/api/v1/profile', { bio: '契约测试改的简介' }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true);
  assert.strictEqual(saved.body.user.bio, '契约测试改的简介');
  assert.strictEqual(saved.body.user.nickname, before.body.nickname, '没提交的字段不应被改动');
  assert.strictEqual(saved.body.user.showRegistrations, before.body.showRegistrations);

  const long = await put('/api/v1/profile', { bio: '长'.repeat(5000) }, { token: tokens.user.token });
  assert.strictEqual(long.body.ok, false, '简介超长必须被服务端拦住');
});

test('改密码校验当前密码，成功后旧刷新令牌失效', async () => {
  const session = await login('user');
  const wrong = await post('/api/v1/profile/password', {
    currentPassword: 'nope', newPassword: 'newpassword', confirmPassword: 'newpassword',
  }, { token: session.token });
  assert.strictEqual(wrong.body.ok, false);

  const mismatch = await post('/api/v1/profile/password', {
    currentPassword: 'password', newPassword: 'newpassword', confirmPassword: 'other',
  }, { token: session.token });
  assert.strictEqual(mismatch.body.ok, false);

  const changed = await post('/api/v1/profile/password', {
    currentPassword: 'password', newPassword: 'newpassword', confirmPassword: 'newpassword',
  }, { token: session.token });
  assert.strictEqual(changed.body.ok, true, JSON.stringify(changed.body));

  const reused = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(reused.status, 401, '改密码后旧刷新令牌必须失效');

  const relogin = await login('user', 'newpassword');
  assert.ok(relogin.token);
  const restored = await post('/api/v1/profile/password', {
    currentPassword: 'newpassword', newPassword: 'password', confirmPassword: 'password',
  }, { token: relogin.token });
  assert.strictEqual(restored.body.ok, true, '还原密码失败，后续用例会受影响');
  tokens.user = await login('user');
});

test('通知偏好可读可写', async () => {
  const current = await get('/api/v1/profile/notifications', { token: tokens.user.token });
  assert.strictEqual(typeof current.body.exhibitionReminder, 'boolean');
  assert.strictEqual(typeof current.body.registrationUpdates, 'boolean');

  const saved = await put('/api/v1/profile/notifications', { exhibitionReminder: false }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true);
  const reread = await get('/api/v1/profile/notifications', { token: tokens.user.token });
  assert.strictEqual(reread.body.exhibitionReminder, false);
  assert.strictEqual(reread.body.registrationUpdates, current.body.registrationUpdates, '未提交的字段不应被改动');
  await put('/api/v1/profile/notifications', { exhibitionReminder: true }, { token: tokens.user.token });
});

test('服务器设置只有管理员能改，保存后可读回', async () => {
  const asUser = await put('/api/v1/settings', { appTitleZh: 'x' }, { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);

  const saved = await put('/api/v1/settings', {
    appTitleZh: '展会助手', appTitleEn: 'ExpoHub', canRevise: true,
    themeIndex: 2, categories: ['智能家居', '新材料'], exhibitionTitle: 80,
  }, { token: tokens.admin.token });
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.settings.brand.zh, '展会助手');
  assert.strictEqual(saved.body.settings.theme.index, 2);
  assert.strictEqual(saved.body.settings.review.canRevise, true);
  assert.strictEqual(saved.body.settings.limits.exhibitionTitle, 80);

  const read = await get('/api/v1/settings');
  assert.strictEqual(read.body.brand.zh, '展会助手');
  assert.strictEqual(read.body.limits.exhibitionTitle, 80);

  // 上限收敛：超界值被夹到范围内，而不是原样写入
  const clamped = await put('/api/v1/settings', { exhibitionTitle: 9999 }, { token: tokens.admin.token });
  assert.strictEqual(clamped.body.settings.limits.exhibitionTitle, 120);

  // 没提交的段不应被重置
  assert.strictEqual(clamped.body.settings.brand.zh, '展会助手');

  // 还原
  await put('/api/v1/settings', {
    appTitleZh: '发现展会', canRevise: false, themeIndex: 0, exhibitionTitle: 60,
  }, { token: tokens.admin.token });
});

test('外观模式只接受三个取值，且是个人偏好', async () => {
  const dark = await put('/api/v1/settings/ui-mode', { mode: 'dark' }, { token: tokens.admin.token });
  assert.strictEqual(dark.body.mode, 'dark');
  const mine = await get('/api/v1/settings', { token: tokens.admin.token });
  assert.strictEqual(mine.body.ui.mode, 'dark', '个人外观模式应当被记住');

  // 另一个用户不受影响
  const other = await get('/api/v1/settings', { token: tokens.user.token });
  assert.notStrictEqual(other.body.ui.mode, 'dark', '外观模式不应该串到别人身上');

  const invalid = await put('/api/v1/settings/ui-mode', { mode: '乱填' });
  assert.strictEqual(invalid.body.mode, 'auto');
  await put('/api/v1/settings/ui-mode', { mode: 'auto' }, { token: tokens.admin.token });
});

test('搜索同时返回展会与用户，空关键词返回空结果', async () => {
  const hit = await get('/api/v1/search?query=智能');
  assert.ok(hit.body.exhibitions.length > 0, '展会应当命中');
  assert.strictEqual(hit.body.count, hit.body.exhibitions.length + hit.body.users.length);
  for (const user of hit.body.users) {
    assert.strictEqual(user.password_hash, undefined, '搜索结果不能带密码哈希');
  }

  const empty = await get('/api/v1/search?query=');
  assert.deepStrictEqual(empty.body.exhibitions, []);
  assert.strictEqual(empty.body.count, 0);
});

test('未知路径返回 404 而不是 500', async () => {
  const response = await get('/api/v1/not-an-endpoint');
  assert.strictEqual(response.status, 404);
  assert.ok(response.body.error);
});

// ── 与前端映射表的交叉校验 ───────────────────────────────────────

/**
 * 把前端 `api.js` 里的 `ENDPOINTS` 对象取出来求值。
 *
 * 这段代码是纯字面量 + 箭头函数，因此在 Node 里可以直接算；用花括号配平（跳过字符串）
 * 而不是正则在对象里找结尾，避免被值里的 `{ ... }` 骗到。
 */
function frontendEndpoints() {
  const file = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'web', 'js', 'core', 'api.js');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('const ENDPOINTS = {');
  assert.ok(start > 0, 'api.js 里找不到 ENDPOINTS');
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  assert.ok(end > open, 'ENDPOINTS 对象没有配平');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${source.slice(open, end + 1)};`)();
}

/** 把 `/exhibitions/:id/status` 这样的声明转成匹配用的正则。 */
function routePattern(full) {
  const segments = full.split('/').map((segment) => (segment.startsWith(':')
    ? '[^/]+'
    : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^${segments.join('/')}$`);
}

/** 后端实际注册的路由表：[方法, 匹配用的正则]。 */
function backendRoutes() {
  const declared = [];
  for (const [prefix, router] of Object.entries(routes)) {
    const base = `/api/v1${prefix ? `/${prefix}` : ''}`;
    for (const layer of router.stack) {
      if (!layer.route) {
        continue;
      }
      const full = `${base}${layer.route.path === '/' ? '' : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        declared.push({ method: method.toUpperCase(), path: full, pattern: routePattern(full) });
      }
    }
  }
  return declared;
}

/**
 * 前端每个数据动作都必须能在后端找到对应路由。
 *
 * 这条断言是「35 个动作全部实现」的机器化证据：漏实现一个动作、或者改了路径忘了
 * 同步 `ENDPOINTS`，都会在这里失败，而不是等到某个页面在真机上静默报错。
 */
test('前端每个数据动作都对应后端已注册的路由', () => {
  const endpoints = frontendEndpoints();
  const actions = Object.keys(endpoints);
  assert.strictEqual(actions.length, 35,
    `前端数据动作数量变了（期望 35）：${actions.length} 个 —— ${actions.join(', ')}`);

  const declared = backendRoutes();
  // 用「带 id 的完整参数」和「空参数」各算一次：像 exhibitions.save 这种
  // 按有没有 id 分派到 POST / PUT 的映射，两个分支都要能对上路由。
  const payloads = [
    {},
    {
      id: 'sample-id', userId: 'sample-id', exhibitionId: 'sample-id', nickname: 'n',
      query: 'q', year: 2026, month: 6, day: 1, status: '待审核', code: 'c',
    },
  ];

  const missing = [];
  for (const action of actions) {
    for (const payload of payloads) {
      const request = endpoints[action](payload);
      assert.ok(request && request.method && request.path, `${action} 的映射没返回 method/path`);
      // 前端映射里的 path 是 BASE_URL（…/api/v1）之后的相对路径。
      const full = `/api/v1${request.path}`;
      const hit = declared.some((route) => route.method === request.method
        && route.pattern.test(full));
      if (!hit) {
        missing.push(`${action} → ${request.method} ${full}`);
      }
    }
  }

  assert.deepStrictEqual(missing, [],
    `以下前端动作在后端没有对应路由：\n  ${missing.join('\n  ')}`);
});

test('后端没有前端用不到的孤立路由', () => {
  const declared = backendRoutes();
  const endpoints = frontendEndpoints();
  const payloads = [
    {},
    {
      id: 'sample-id', userId: 'sample-id', exhibitionId: 'sample-id', nickname: 'n',
      query: 'q', year: 2026, month: 6, day: 1, status: '待审核', code: 'c',
    },
  ];
  const used = new Set();
  for (const action of Object.keys(endpoints)) {
    for (const payload of payloads) {
      const request = endpoints[action](payload);
      const full = `/api/v1${request.path}`;
      for (const route of declared) {
        if (route.method === request.method && route.pattern.test(full)) {
          used.add(`${route.method} ${route.path}`);
        }
      }
    }
  }
  // 这几个是刻意保留、不走前端动作表的：刷新令牌与「撤销全部会话」由 api.js 直接调用。
  const intentional = new Set([
    'POST /api/v1/auth/refresh',
    'POST /api/v1/auth/logout-all',
  ]);
  const orphans = declared
    .map((route) => `${route.method} ${route.path}`)
    .filter((key) => !used.has(key) && !intentional.has(key));
  assert.deepStrictEqual(orphans, [],
    `以下后端路由没有任何前端动作用到，属于冗余：\n  ${orphans.join('\n  ')}`);
});
