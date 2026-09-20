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
// 契约测试走 memory 通道：验证码留在内存收件箱里给用例取，既不真发信，也不把码打进日志。
process.env.MAIL_TRANSPORT = 'memory';
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
const { migrate, seed, DEFAULT_SETTINGS } = require('../src/config/migrate');
const { resetRateLimits } = require('../src/middleware/rate-limit');
const { outbox } = require('../src/services/mailer');
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

/**
 * 取最近一封发给该邮箱的验证码。
 *
 * **明文码只存在于邮件正文里**（库里只有 sha256 哈希），所以用例从内存收件箱的正文里把它读出来 ——
 * 走的正是用户实际收到的那条路径，而不是给测试单开的后门（后端没有、也不该有「读出明文码」的接口）。
 */
function codeFromInbox(email) {
  const target = String(email).trim().toLowerCase();
  const mail = outbox().filter((item) => item.to === target).pop();
  assert.ok(mail, `内存收件箱里没有发给 ${target} 的邮件`);
  const match = /验证码：(\d{6})/.exec(mail.text);
  assert.ok(match, `邮件正文里没有 6 位验证码：\n${mail.text}`);
  return { code: match[1], mail };
}

/** 一个必然与真实码不同的 6 位码（用来测错码分支，避免极小概率撞上真码）。 */
function otherCode(code) {
  return code === '000000' ? '111111' : '000000';
}

const tokens = {};

/**
 * 建一个「已验证邮箱」的临时账号。
 *
 * 两步验证与改邮箱的用例需要一个干净的账号：示例账号的密码被改掉会影响后面的用例，
 * 邮箱也不能随便动（`demo@example.com` 之类在别处当已知数据用）。
 */
async function createVerifiedAccount(id, username, email, password = 'password') {
  // eslint-disable-next-line global-require
  const bcrypt = require('bcryptjs');
  await pool.query(`
        INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, 'user', true, now())
        ON CONFLICT (id) DO UPDATE
            SET password_hash = EXCLUDED.password_hash,
                email = EXCLUDED.email,
                email_verified = true,
                two_factor_enabled = false
    `, [id, username, await bcrypt.hash(password, 4), email, username]);
}

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
  assert.deepStrictEqual(body.user.can,
    { register: false, profile: false, exhibitor: false, admin: false, limited: false });
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
  resetRateLimits();
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

test('登录限流：同一账号连续失败到上限后给 429', async () => {
  resetRateLimits();
  const username = `rl-${Date.now().toString(36)}`;
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await post('/api/v1/auth/login', { username, password: 'wrong' });
    assert.strictEqual(last.status, 200, `第 ${i + 1} 次应当在窗口内放行`);
  }
  const blocked = await post('/api/v1/auth/login', { username, password: 'wrong' });
  assert.strictEqual(blocked.status, 429, '超出窗口上限应当 429');
  assert.ok(blocked.body.error, '429 也要给出可展示的错误');
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

test('并发使用同一个刷新令牌只能换到一套新令牌', async () => {
  // 轮换的撤销必须是原子的：以前「先 SELECT 判断 revoked_at、再按 id UPDATE」时，
  // 同一令牌并发用两次两个请求都能通过判断，各换一套新令牌（TOCTOU）。
  for (let round = 0; round < 3; round += 1) {
    const session = await login('user');
    const responses = await Promise.all([
      post('/api/v1/auth/refresh', { refreshToken: session.refreshToken }),
      post('/api/v1/auth/refresh', { refreshToken: session.refreshToken }),
    ]);
    const ok = responses.filter((item) => item.status === 200 && item.body.ok === true);
    const rejected = responses.filter((item) => item.status === 401);
    const seen = responses.map((item) => `${item.status}/${item.body && item.body.ok}`).join(', ');
    assert.strictEqual(ok.length, 1, `第 ${round + 1} 轮：同一个刷新令牌并发只能成功一次（${seen}）`);
    assert.strictEqual(rejected.length, 1, `第 ${round + 1} 轮：另一个请求必须按登录失效处理（${seen}）`);

    // 换到的新令牌仍然可用：只作废了被重放的那一个，不是把整条会话废掉
    const rotated = await post('/api/v1/auth/refresh', { refreshToken: ok[0].body.refreshToken });
    assert.strictEqual(rotated.status, 200, '轮换出来的新令牌应当还能继续刷新');
  }
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

test('注册是两步的：第一步只发码不建号，验证码通过才建号', async () => {
  const short = await post('/api/v1/auth/register', { username: 'ab', password: 'password', email: 'a@b.com' });
  assert.strictEqual(short.body.ok, false);

  const weak = await post('/api/v1/auth/register', { username: 'tester01', password: '123', email: 'a@b.com' });
  assert.strictEqual(weak.body.ok, false);

  const badEmail = await post('/api/v1/auth/register', { username: 'tester01', password: 'password', email: 'nope' });
  assert.strictEqual(badEmail.body.ok, false);

  const email = 'tester01@example.com';
  const applied = await post('/api/v1/auth/register', {
    username: 'tester01', password: 'password', email,
  });
  assert.strictEqual(applied.body.ok, true, `申请发码失败：${JSON.stringify(applied.body)}`);
  assert.strictEqual(applied.body.email, email, '要告诉用户码发到了哪个邮箱');
  assert.ok(applied.body.expiresInSec >= 60, '要给出有效期');
  assert.ok(applied.body.resendAfterSec >= 30, '要给出多久之后能重发');
  assert.strictEqual(applied.body.token, undefined, '第一步不该发令牌');
  assert.strictEqual(applied.body.refreshToken, undefined, '第一步不该发刷新令牌');
  assert.strictEqual(applied.body.user, undefined, '第一步还没建账号，不该有用户态');

  // 「先验证邮箱、通过后才建账号」的核心：没验证的申请不能变成能登录的账号
  const notYet = await post('/api/v1/auth/login', { username: 'tester01', password: 'password' });
  assert.strictEqual(notYet.body.ok, false, '邮箱没验证就等于没注册，这一步不该能登录');

  const { code, mail } = codeFromInbox(email);
  assert.ok(mail.subject.includes('注册'), `邮件主题要写明用途：${mail.subject}`);
  assert.ok(mail.text.includes('10 分钟'), '邮件要写上有效期');

  const wrong = await post('/api/v1/auth/register/verify', { email, code: otherCode(code) });
  assert.strictEqual(wrong.status, 200, `错码应当走 200 + ok:false 信封，实际 ${wrong.status}：${JSON.stringify(wrong.body)}`);
  assert.strictEqual(wrong.body.ok, false, `错码不该通过：${JSON.stringify(wrong.body)}`);
  assert.ok(wrong.body.error.includes('验证码'), `错码要说明是验证码的问题：${wrong.body.error}`);
  const stillNot = await post('/api/v1/auth/login', { username: 'tester01', password: 'password' });
  assert.strictEqual(stillNot.body.ok, false, '错码之后仍然不该有账号');

  const created = await post('/api/v1/auth/register/verify', { email, code });
  assert.strictEqual(created.body.ok, true, `验证失败：${JSON.stringify(created.body)}`);
  assert.strictEqual(created.body.user.role, 'user', '自助注册固定为普通用户');
  assert.strictEqual(created.body.user.email, email);
  assert.ok(created.body.token, '验证通过后应当直接进入登录态');

  // 邮箱当场就是已验证状态：它就是刚刚被验证过的那个
  const stored = await pool.query(
    'SELECT email_verified, email_verified_at FROM users WHERE lower(email) = $1',
    [email],
  );
  assert.strictEqual(stored.rows.length, 1, '验证通过后应当建出账号');
  assert.strictEqual(stored.rows[0].email_verified, true, '新账号的邮箱必须是已验证状态');
  assert.ok(stored.rows[0].email_verified_at);

  // 建出来的账号能正常登录（会话不是一次性的）
  const signedIn = await post('/api/v1/auth/login', { username: 'tester01', password: 'password' });
  assert.strictEqual(signedIn.body.ok, true, `验证建的账号应当能登录：${JSON.stringify(signedIn.body)}`);

  // 同一枚码不能再用第二次
  const replay = await post('/api/v1/auth/register/verify', { email, code });
  assert.strictEqual(replay.body.ok, false, '同一枚验证码不该能重复使用');

  // 用户名与邮箱各自唯一，且都在第一步就查出来（不必等用户输完码）
  const duplicateName = await post('/api/v1/auth/register', {
    username: 'tester01', password: 'password', email: 'tester01-other@example.com',
  });
  assert.strictEqual(duplicateName.body.ok, false);
  assert.ok(duplicateName.body.error.includes('用户名已被注册'), `错误文案要具体：${duplicateName.body.error}`);
});

test('邮箱已被注册时在第一步就拦下，不发码也不建号', async () => {
  const before = outbox().length;
  const applied = await post('/api/v1/auth/register', {
    username: 'fresh01', password: 'password', email: 'demo@example.com',
  });
  assert.strictEqual(applied.body.ok, false, 'demo@example.com 是示例管理员的邮箱，不该被重复注册');
  assert.ok(applied.body.error.includes('邮箱已被注册'), `错误文案要具体：${applied.body.error}`);
  assert.strictEqual(outbox().length, before, '被拦下时不该发码');
});

test('同一邮箱 60 秒内不能重复发码，且要说清多久能重试', async () => {
  const email = 'cooldown01@example.com';
  const first = await post('/api/v1/auth/register', { username: 'cooldown01', password: 'password', email });
  assert.strictEqual(first.body.ok, true, `第一次发码就失败了：${JSON.stringify(first.body)}`);

  const second = await post('/api/v1/auth/register', { username: 'cooldown01', password: 'password', email });
  assert.strictEqual(second.status, 429, '60 秒内重复发码应当按限流拒绝');
  assert.ok(second.body.error.includes('秒'), `要告诉用户多久能重试：${second.body.error}`);
});

test('错码累计到上限后这枚码作废，必须重新获取', async () => {
  const email = 'attempts01@example.com';
  const applied = await post('/api/v1/auth/register', { username: 'attempts01', password: 'password', email });
  assert.strictEqual(applied.body.ok, true, JSON.stringify(applied.body));
  const { code } = codeFromInbox(email);
  const wrong = otherCode(code);

  for (let i = 1; i <= 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const attempt = await post('/api/v1/auth/register/verify', { email, code: wrong });
    assert.strictEqual(attempt.body.ok, false,
      `第 ${i} 次错码不该通过：status=${attempt.status} body=${JSON.stringify(attempt.body)}`);
  }

  // 试满 5 次之后，连正确的码也不认了：这枚码已经作废
  const blocked = await post('/api/v1/auth/register/verify', { email, code });
  assert.strictEqual(blocked.body.ok, false, '作废的码不该还能通过');
  assert.ok(/重新获取/.test(blocked.body.error), `应当提示重新获取：${blocked.body.error}`);
  const never = await post('/api/v1/auth/login', { username: 'attempts01', password: 'password' });
  assert.strictEqual(never.body.ok, false, '一直没验证成功，就不该有账号');
});

test('发码到验证之间用户名被占用时，验证阶段给出可读提示而不是 500', async () => {
  const email = 'race01@example.com';
  const applied = await post('/api/v1/auth/register', { username: 'race01', password: 'password', email });
  assert.strictEqual(applied.body.ok, true, JSON.stringify(applied.body));

  // 模拟另一个请求抢先完成注册，把用户名占掉
  await pool.query(`
        INSERT INTO users (id, username, password_hash, email, nickname, role)
        VALUES ('usr-race01', 'race01', 'not-a-real-hash', 'race01-other@example.com', 'race01', 'user')
    `);
  try {
    const { code } = codeFromInbox(email);
    const verified = await post('/api/v1/auth/register/verify', { email, code });
    assert.strictEqual(verified.status, 200, '业务冲突是 200 + ok:false，不该是 500');
    assert.strictEqual(verified.body.ok, false);
    assert.ok(verified.body.error.includes('已被注册'), `要给出可读原因：${verified.body.error}`);
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-race01'");
  }
});

test('登录支持用户名或已验证邮箱', async () => {
  const byName = await post('/api/v1/auth/login', { username: 'user', password: 'password' });
  assert.strictEqual(byName.body.ok, true, `用户名登录失败：${JSON.stringify(byName.body)}`);

  // 登录页的占位符一直写着「昵称 / 邮箱」，但后端只按用户名匹配 —— 邮箱登录此前是坏的，
  // 而昵称没有唯一约束、本来就不能当标识。
  const byEmail = await post('/api/v1/auth/login', { username: 'user@example.com', password: 'password' });
  assert.strictEqual(byEmail.body.ok, true, `邮箱登录失败：${JSON.stringify(byEmail.body)}`);
  assert.strictEqual(byEmail.body.user.username, 'user', '邮箱登录应当拿到同一个账号');

  const wrong = await post('/api/v1/auth/login', { username: 'user@example.com', password: 'nope' });
  assert.strictEqual(wrong.body.ok, false);
});

test('找回密码不透露邮箱是否存在，但确实给已注册邮箱发码', async () => {
  const before = outbox().length;

  const unknown = await post('/api/v1/auth/password/forgot', {
    email: `nobody-${Date.now().toString(36)}@example.com`,
  });
  assert.strictEqual(unknown.body.ok, true, '不存在的邮箱也要回 ok，否则这个接口就是账号枚举器');
  assert.strictEqual(outbox().length, before, '不存在的邮箱不该真的发信');

  const known = await post('/api/v1/auth/password/forgot', { email: 'user@example.com' });
  assert.strictEqual(known.body.ok, true, `已注册邮箱发码失败：${JSON.stringify(known.body)}`);
  assert.deepStrictEqual(
    Object.keys(known.body).sort(),
    Object.keys(unknown.body).sort(),
    '两种情况返回的字段必须完全一致，否则照样能枚举出账号是否存在',
  );
  assert.strictEqual(known.body.email, 'user@example.com');
  assert.strictEqual(outbox().length, before + 1, '已注册邮箱要真的收到码');

  // 格式不对时照常给提示：这不泄露任何账号信息
  const invalid = await post('/api/v1/auth/password/forgot', { email: 'nope' });
  assert.strictEqual(invalid.body.ok, false);
  assert.ok(invalid.body.error.includes('邮箱'), invalid.body.error);
});

test('找回密码：验证码通过后改密码、撤销全部刷新令牌，且一码一用', async () => {
  const bcrypt = require('bcryptjs');
  const email = 'reset-target@example.com';
  await pool.query(`
        INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified)
        VALUES ('usr-reset', 'resettarget', $1, $2, 'resettarget', 'user', true)
        ON CONFLICT (id) DO UPDATE
            SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email
    `, [await bcrypt.hash('password', 4), email]);

  try {
    // 先在「另一台设备」上登录，改完密码这套刷新令牌必须失效
    const session = await login('resettarget');

    const asked = await post('/api/v1/auth/password/forgot', { email });
    assert.strictEqual(asked.body.ok, true, JSON.stringify(asked.body));
    const { code, mail } = codeFromInbox(email);
    assert.ok(mail.subject.includes('找回密码'), `邮件主题要写明用途：${mail.subject}`);

    // 两次密码不一致不该把这枚码烧掉（校验在消费之前）
    const mismatch = await post('/api/v1/auth/password/reset', {
      email, code, newPassword: 'brand-new-1', confirmPassword: 'brand-new-2',
    });
    assert.strictEqual(mismatch.body.ok, false);
    assert.ok(mismatch.body.error.includes('不一致'), mismatch.body.error);

    // 错码要被拒
    const wrong = await post('/api/v1/auth/password/reset', {
      email, code: otherCode(code), newPassword: 'brand-new-1', confirmPassword: 'brand-new-1',
    });
    assert.strictEqual(wrong.status, 200, `业务失败应当是 200 信封，实际 ${wrong.status}`);
    assert.strictEqual(wrong.body.ok, false);

    // 前面两次都没消费掉它，这个码仍然可用
    const done = await post('/api/v1/auth/password/reset', {
      email, code, newPassword: 'brand-new-1', confirmPassword: 'brand-new-1',
    });
    assert.strictEqual(done.body.ok, true, `重置失败：${JSON.stringify(done.body)}`);

    const oldPassword = await post('/api/v1/auth/login', { username: 'resettarget', password: 'password' });
    assert.strictEqual(oldPassword.body.ok, false, '旧密码必须失效');
    const newPassword = await post('/api/v1/auth/login', { username: 'resettarget', password: 'brand-new-1' });
    assert.strictEqual(newPassword.body.ok, true, `新密码应当能登录：${JSON.stringify(newPassword.body)}`);

    // 找回密码通常意味着密码可能已经泄露：其它设备上的登录状态要一起断掉
    const stale = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
    assert.strictEqual(stale.status, 401, '重置密码后旧刷新令牌必须失效');

    // 同一枚码不能再改一次
    const again = await post('/api/v1/auth/password/reset', {
      email, code, newPassword: 'another-1', confirmPassword: 'another-1',
    });
    assert.strictEqual(again.body.ok, false, '同一枚码不该能重复使用');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-reset'");
  }
});

test('开启两步验证后，密码对了也只发预认证票，过码才发令牌', async () => {
  await createVerifiedAccount('usr-2fa', 'twofactor', 'twofactor@example.com');
  try {
    const session = await login('twofactor');

    // 开启第一步：验证码发到已验证邮箱，且回给页面的是打码后的地址
    const enable = await post('/api/v1/profile/2fa/enable', undefined, { token: session.token });
    assert.strictEqual(enable.body.ok, true, `开启失败：${JSON.stringify(enable.body)}`);
    assert.ok(enable.body.maskedEmail, '要告诉用户码发到哪个邮箱了');
    assert.ok(!enable.body.maskedEmail.includes('twofactor@'), `邮箱应当打码：${enable.body.maskedEmail}`);

    const enableCode = codeFromInbox('twofactor@example.com');
    const enabled = await post('/api/v1/profile/2fa/enable/verify',
      { code: enableCode.code }, { token: session.token });
    assert.strictEqual(enabled.body.ok, true, `验证码通过却没开起来：${JSON.stringify(enabled.body)}`);
    assert.strictEqual(enabled.body.twoFactorEnabled, true);

    // 再登录：密码正确，但**没有令牌**，只有一张票
    const step1 = await post('/api/v1/auth/login', { username: 'twofactor', password: 'password' });
    assert.strictEqual(step1.body.ok, true, JSON.stringify(step1.body));
    assert.strictEqual(step1.body.twoFactorRequired, true, '应当进入两步验证');
    assert.strictEqual(step1.body.token, undefined, '两步验证没过之前不能有访问令牌');
    assert.strictEqual(step1.body.refreshToken, undefined, '更不能有刷新令牌');
    assert.strictEqual(step1.body.user, undefined, '这一步也不该下发用户态');
    assert.ok(step1.body.ticket, '要给出预认证票');

    const loginCode = codeFromInbox('twofactor@example.com');
    const wrong = await post('/api/v1/auth/login/verify',
      { ticket: step1.body.ticket, code: otherCode(loginCode.code) });
    assert.strictEqual(wrong.body.ok, false, '错码不该通过');
    assert.strictEqual(wrong.body.token, undefined, '错码之后仍然不能有令牌');

    const done = await post('/api/v1/auth/login/verify', { ticket: step1.body.ticket, code: loginCode.code });
    assert.strictEqual(done.body.ok, true, `过码后应当登录成功：${JSON.stringify(done.body)}`);
    assert.ok(done.body.token && done.body.refreshToken, '过码后才发令牌');
    assert.strictEqual(done.body.user.username, 'twofactor');

    // 同一张票不能再用（单次使用）
    const replay = await post('/api/v1/auth/login/verify', { ticket: step1.body.ticket, code: loginCode.code });
    assert.strictEqual(replay.body.ok, false, '预认证票只能用一次');

    // 关闭要当前密码
    const wrongPassword = await post('/api/v1/profile/2fa/disable',
      { password: 'not-my-password' }, { token: done.body.token });
    assert.strictEqual(wrongPassword.body.ok, false, '密码不对不该能关掉两步验证');

    const disabled = await post('/api/v1/profile/2fa/disable',
      { password: 'password' }, { token: done.body.token });
    assert.strictEqual(disabled.body.ok, true, JSON.stringify(disabled.body));

    const plain = await post('/api/v1/auth/login', { username: 'twofactor', password: 'password' });
    assert.ok(plain.body.token, '关掉之后应当恢复成一步登录');
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-2fa'");
  }
});

test('改邮箱要把验证码发到新地址，通过才落库；别人的码用不了', async () => {
  await createVerifiedAccount('usr-email', 'emailchange', 'before@example.com');
  try {
    const session = await login('emailchange');

    // 直接写 email 被拦住：PUT /profile 不再接受这个字段
    const direct = await put('/api/v1/profile', { email: 'hacked@example.com' }, { token: session.token });
    assert.strictEqual(direct.body.ok, false, '邮箱不该能直接改');
    assert.ok(direct.body.error.includes('验证'), `要指出正确路径：${direct.body.error}`);
    const untouched = await get('/api/v1/profile', { token: session.token });
    assert.strictEqual(untouched.body.email, 'before@example.com', '被拦住之后邮箱不能变');

    // 第一轮：换到 after1，验证码被别人拿去用（换了登录身份）应当失败
    const asked = await post('/api/v1/profile/email',
      { email: 'after1@example.com' }, { token: session.token });
    assert.strictEqual(asked.body.ok, true, `发码失败：${JSON.stringify(asked.body)}`);
    const stolen = codeFromInbox('after1@example.com');
    const adminSession = await login('demo');
    const foreign = await post('/api/v1/profile/email/verify',
      { email: 'after1@example.com', code: stolen.code }, { token: adminSession.token });
    assert.strictEqual(foreign.body.ok, false, '别人账号的改邮箱验证码不能用来改自己的邮箱');
    assert.strictEqual(foreign.body.error.includes('不正确') || foreign.body.error.includes('失效'), true,
      `文案要说不通：${foreign.body.error}`);

    // 第二轮：换到 after2，这一次自己走完
    const asked2 = await post('/api/v1/profile/email',
      { email: 'after2@example.com' }, { token: session.token });
    assert.strictEqual(asked2.body.ok, true, JSON.stringify(asked2.body));
    const own = codeFromInbox('after2@example.com');
    const done = await post('/api/v1/profile/email/verify',
      { email: 'after2@example.com', code: own.code }, { token: session.token });
    assert.strictEqual(done.body.ok, true, `改邮箱失败：${JSON.stringify(done.body)}`);
    assert.strictEqual(done.body.user.email, 'after2@example.com');
    assert.strictEqual(done.body.user.emailVerified, true, '新邮箱是验证过的，账号不会掉进「未验证」状态');

    // 新邮箱可以直接用来登录
    const byNewEmail = await post('/api/v1/auth/login', { username: 'after2@example.com', password: 'password' });
    assert.strictEqual(byNewEmail.body.ok, true, '改完之后新邮箱应当能登录');

    // 已被占用的邮箱不能再被改成目标
    const taken = await post('/api/v1/profile/email',
      { email: 'demo@example.com' }, { token: session.token });
    assert.strictEqual(taken.body.ok, false);
    assert.ok(taken.body.error.includes('已被'), taken.body.error);
  } finally {
    await pool.query("DELETE FROM users WHERE id = 'usr-email'");
  }
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
  // exh-2 是需审核；用 admin（种子里没有他的报名）验证流转，避开 usr-3 已有的 reg-3。
  // 报名内容要满足该展会的收集项（必填项不能为空，单选值要在选项里）。
  const worksAnswers = '姓名 / 公司名称：接口测试\n参观身份：专业观众';
  const pending = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2', visitorName: '接口测试', visitorType: '专业观众', answers: worksAnswers,
  }, { token: tokens.admin.token });
  assert.strictEqual(pending.body.ok, true, JSON.stringify(pending.body));
  assert.strictEqual(pending.body.autoApproved, false, '需审核的展会不应自动通过');
  assert.strictEqual(pending.body.statusLabel, '待审核');

  const cancelled = await del(`/api/v1/registrations/${pending.body.registration.id}`, { token: tokens.admin.token });
  assert.strictEqual(cancelled.body.ok, true, JSON.stringify(cancelled.body));

  const again = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2', visitorName: '接口测试', visitorType: '专业观众', answers: worksAnswers,
  }, { token: tokens.admin.token });
  assert.strictEqual(again.body.ok, true, `撤销后应当可以重新报名：${JSON.stringify(again.body)}`);

  // admin 报 exh-1（无需审核）→ 自动通过
  const auto = await post('/api/v1/registrations', {
    exhibitionId: 'exh-1',
    visitorName: '管理员报名',
    visitorType: '专业观众',
    answers: '姓名 / 公司名称：管理员报名\n参观身份：专业观众',
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

test('报名收集项的必填与选项由服务端校验', async () => {
  // 自造一场展会：不依赖其它用例留下的展会配置，跑完即删（外键级联清掉收集项与报名）。
  const created = await post('/api/v1/exhibitions', {
    title: '收集项校验展',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: isoDateAfter(30),
    category: '智能家居',
    status: '无需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    // 没有配置收集项时按默认三项校验：默认的「姓名 / 公司名称」必填，空答案要被拦住。
    const fallback = await post('/api/v1/registrations', {
      exhibitionId, visitorName: '校验用例', visitorType: '专业观众', answers: '',
    }, { token: tokens.user.token });
    assert.strictEqual(fallback.body.ok, false, '默认收集项的必填项没有被校验');
    assert.ok(fallback.body.error.includes('姓名 / 公司名称'),
      `提示要指出缺哪一项：${fallback.body.error}`);

    // 配置成必填 + 选项的收集项
    const saved = await put(`/api/v1/exhibitions/${exhibitionId}/fields`, {
      fields: [
        { title: '姓名 / 公司名称', type: '文本', required: true, options: [] },
        { title: '参观身份', type: '单选', required: true, options: ['专业观众', '媒体'] },
        { title: '报名需求', type: '多选', required: false, options: ['停车位', '翻译服务'] },
      ],
    }, { token: tokens.exhibitor.token });
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));

    const base = { exhibitionId, visitorName: '校验用例', visitorType: '专业观众' };

    const missing = await post('/api/v1/registrations', {
      ...base, answers: '参观身份：专业观众',
    }, { token: tokens.user.token });
    assert.strictEqual(missing.body.ok, false, '缺必填项必须被拒');
    assert.ok(missing.body.error.includes('请填写「姓名 / 公司名称」'), missing.body.error);

    const badOption = await post('/api/v1/registrations', {
      ...base, answers: '姓名 / 公司名称：校验用例\n参观身份：同行人员',
    }, { token: tokens.user.token });
    assert.strictEqual(badOption.body.ok, false, '选项以外的单选值必须被拒');
    assert.ok(badOption.body.error.includes('参观身份'), badOption.body.error);

    const badMulti = await post('/api/v1/registrations', {
      ...base, answers: '姓名 / 公司名称：校验用例\n参观身份：专业观众\n报名需求：停车位、接送机',
    }, { token: tokens.user.token });
    assert.strictEqual(badMulti.body.ok, false, '多选里混入选项以外的值必须被拒');

    const accepted = await post('/api/v1/registrations', {
      ...base, answers: '姓名 / 公司名称：校验用例\n参观身份：专业观众\n报名需求：停车位、翻译服务',
    }, { token: tokens.user.token });
    assert.strictEqual(accepted.body.ok, true, `合规提交应当成功：${JSON.stringify(accepted.body)}`);
    assert.strictEqual(accepted.body.registration.statusLabel, '已通过');

    // 选填项没填：页面会写「未填写」占位（见 pages/registration-form.js），
    // 服务端要把它当成空值，而不是一个不在选项里的多选值。
    const blank = await post('/api/v1/registrations', {
      ...base,
      visitorName: '校验用例二',
      answers: '姓名 / 公司名称：校验用例二\n参观身份：媒体\n报名需求：未填写',
    }, { token: tokens.admin.token });
    assert.strictEqual(blank.body.ok, true, `未填写占位不应被当成非法选项：${JSON.stringify(blank.body)}`);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

// ── 审核与核销 ──────────────────────────────────────────────────

test('已参加是终态：本人不能撤销，展商也不能再改', async () => {
  // 自造展会与报名，不依赖其它用例留下的记录（跑完删展会，外键级联清掉报名）。
  const created = await post('/api/v1/exhibitions', {
    title: '终态校验展',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: isoDateAfter(20),
    category: '智能家居',
    status: '无需审核',
    qrEnabled: true,
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    const submitted = await post('/api/v1/registrations', {
      exhibitionId,
      visitorName: '终态用例',
      visitorType: '专业观众',
      answers: '姓名 / 公司名称：终态用例\n参观身份：专业观众',
    }, { token: tokens.user.token });
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const registrationId = submitted.body.registration.id;

    // 展商核销 → 已参加
    const checked = await post('/api/v1/checkin', {
      code: `CALMOBILE-CHECKIN|${exhibitionId}|${registrationId}`,
    }, { token: tokens.exhibitor.token });
    assert.strictEqual(checked.body.ok, true, JSON.stringify(checked.body));

    // 本人不能再撤销（出勤记录不能事后抹掉）：业务规则失败走 200 + ok:false
    const cancel = await del(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
    assert.strictEqual(cancel.status, 200, '业务规则失败应当是 200 + ok:false');
    assert.strictEqual(cancel.body.ok, false, `已参加不应允许撤销：${JSON.stringify(cancel.body)}`);
    assert.ok(cancel.body.error.includes('已参加'), cancel.body.error);

    // 展商也不能把它改回别的状态（状态机里已参加是终态）
    const reopen = await put(`/api/v1/review/${registrationId}/status`,
      { status: '已通过' }, { token: tokens.exhibitor.token });
    assert.strictEqual(reopen.status, 200);
    assert.strictEqual(reopen.body.ok, false, `已参加不应允许改回已通过：${JSON.stringify(reopen.body)}`);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

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

test('审核流转受状态机与「允许修改已审核报名」策略限制', async () => {
  const settingsBefore = await get('/api/v1/settings', { token: tokens.admin.token });
  const originalCanRevise = settingsBefore.body.review.canRevise === true;

  // 自造展会与报名：不碰其它用例共享的展会与报名记录，跑完即删（级联清掉报名）。
  const created = await post('/api/v1/exhibitions', {
    title: '审核流转用例展',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: isoDateAfter(30),
    category: '智能家居',
    status: '需审核',
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    await put('/api/v1/settings', { canRevise: false }, { token: tokens.admin.token });

    const submitted = await post('/api/v1/registrations', {
      exhibitionId,
      visitorName: '流转用例',
      visitorType: '专业观众',
      answers: '姓名 / 公司名称：流转用例\n参观身份：专业观众',
    }, { token: tokens.user.token });
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const id = submitted.body.registration.id;
    assert.strictEqual(submitted.body.registration.statusLabel, '待审核');

    // 待审核 → 已通过：canRevise=false 不影响展商的日常审核
    const approved = await put(`/api/v1/review/${id}/status`, { status: '已通过' }, { token: tokens.exhibitor.token });
    assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));

    // canRevise=false：展商不能改已通过的记录（越权 → 403，不是 200 的业务信封）
    const locked = await put(`/api/v1/review/${id}/status`, { status: '已拒绝' }, { token: tokens.exhibitor.token });
    assert.strictEqual(locked.status, 403,
      `展商改已通过的记录应当是 403：${locked.status} ${JSON.stringify(locked.body)}`);
    assert.ok(locked.body.error, '403 要带可展示的原因');

    // 管理员不受这条策略限制，可以在已通过 / 已拒绝之间切换
    const adminReject = await put(`/api/v1/review/${id}/status`, { status: '已拒绝' }, { token: tokens.admin.token });
    assert.strictEqual(adminReject.body.ok, true, JSON.stringify(adminReject.body));
    assert.strictEqual(adminReject.body.record.status, '已拒绝');
    const adminApprove = await put(`/api/v1/review/${id}/status`, { status: '已通过' }, { token: tokens.admin.token });
    assert.strictEqual(adminApprove.body.ok, true, JSON.stringify(adminApprove.body));

    // 管理员开放修改后，展商可以继续流转：已通过 → 已参加
    await put('/api/v1/settings', { canRevise: true }, { token: tokens.admin.token });
    const attended = await put(`/api/v1/review/${id}/status`, { status: '已参加' }, { token: tokens.exhibitor.token });
    assert.strictEqual(attended.body.ok, true, JSON.stringify(attended.body));
    assert.strictEqual(attended.body.record.status, '已参加');

    // 已参加是终态：非法流转是业务规则失败，走 HTTP 200 + { ok:false } 信封
    const illegal = await put(`/api/v1/review/${id}/status`, { status: '已通过' }, { token: tokens.exhibitor.token });
    assert.strictEqual(illegal.status, 200, '非法流转应当是业务失败，而不是权限失败');
    assert.strictEqual(illegal.body.ok, false, '已参加 → 已通过 必须被拒');
    assert.ok(illegal.body.error.includes('已参加'), illegal.body.error);

    const adminIllegal = await put(`/api/v1/review/${id}/status`, { status: '已拒绝' }, { token: tokens.admin.token });
    assert.strictEqual(adminIllegal.body.ok, false, '管理员同样受状态机约束：已参加不能改成别的');
  } finally {
    await put('/api/v1/settings', { canRevise: originalCanRevise }, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
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

/**
 * 受限账号（`users.status = 'limited'`）真的生效：三件事被禁、其余照旧、管理员不受限。
 *
 * 用例自己改状态、自己在 finally 里还原（usr-3 是种子数据里的普通用户，别的用例也在用），
 * 因此不依赖其它用例的执行顺序，也不留下共享状态。
 */
test('受限账号不能报名 / 发布展会 / 编辑个人信息，其余照旧且管理员不受限', async () => {
  const profileBefore = (await get('/api/v1/profile', { token: tokens.user.token })).body;
  const notifyBefore = (await get('/api/v1/profile/notifications', { token: tokens.user.token })).body;
  try {
    const limited = await put('/api/v1/users/usr-3/status', { status: '受限' }, { token: tokens.admin.token });
    assert.strictEqual(limited.body.ok, true, JSON.stringify(limited.body));

    // 受限账号的用户态：能力位同步置灰，并带上原因标记
    const me = await get('/api/v1/bootstrap', { token: tokens.user.token });
    assert.strictEqual(me.body.user.can.register, false, '受限账号 can.register 应为 false');
    assert.strictEqual(me.body.user.can.profile, false, '受限账号 can.profile 应为 false');
    assert.strictEqual(me.body.user.can.limited, true, '受限账号 can.limited 应为 true');
    assert.strictEqual(me.body.user.can.admin, false);

    // ① 不能报名
    const registration = await post('/api/v1/registrations', {
      exhibitionId: 'exh-1', visitorName: '受限用户', visitorType: '专业观众', answers: '',
    }, { token: tokens.user.token });
    assert.strictEqual(registration.status, 403, `受限账号报名应当 403：${JSON.stringify(registration.body)}`);
    assert.strictEqual(registration.body.error, '账号已被限制，不能报名');

    // ② 不能发布展会
    const exhibition = await post('/api/v1/exhibitions', {
      title: '受限账号不该发出的展会',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-09-20',
      status: '需审核',
    }, { token: tokens.user.token });
    assert.strictEqual(exhibition.status, 403, `受限账号发布展会应当 403：${JSON.stringify(exhibition.body)}`);
    assert.strictEqual(exhibition.body.error, '账号已被限制，不能发布展会');

    // ③ 不能编辑个人信息
    const profile = await put('/api/v1/profile', { nickname: '受限昵称' }, { token: tokens.user.token });
    assert.strictEqual(profile.status, 403, `受限账号改资料应当 403：${JSON.stringify(profile.body)}`);
    assert.strictEqual(profile.body.error, '账号已被限制，不能编辑个人信息');

    // 仍然允许：浏览与查询（200），通知偏好与改密码（不是 403）
    assert.strictEqual((await get('/api/v1/bootstrap', { token: tokens.user.token })).status, 200);
    assert.strictEqual((await get('/api/v1/exhibitions', { token: tokens.user.token })).status, 200);
    assert.strictEqual((await get('/api/v1/settings', { token: tokens.user.token })).status, 200);
    const notify = await put('/api/v1/profile/notifications', {
      exhibitionReminder: !notifyBefore.exhibitionReminder,
    }, { token: tokens.user.token });
    assert.notStrictEqual(notify.status, 403, `通知偏好不受限：${JSON.stringify(notify.body)}`);
    assert.strictEqual(notify.body.ok, true, JSON.stringify(notify.body));
    const password = await post('/api/v1/profile/password', {
      currentPassword: 'x', newPassword: 'y', confirmPassword: 'y',
    }, { token: tokens.user.token });
    assert.notStrictEqual(password.status, 403, '改密码属于账号安全，不应被受限拦下');

    // 管理员自己做同样三件事仍然成功（admin 自己发的展会用来报名，用完连展会一起删掉）
    const adminBootstrap = await get('/api/v1/bootstrap', { token: tokens.admin.token });
    assert.strictEqual(adminBootstrap.body.user.can.limited, false, '管理员不受限，can.limited 应为 false');
    assert.strictEqual(adminBootstrap.body.user.can.register, true);
    assert.strictEqual(adminBootstrap.body.user.can.profile, true);

    const adminExhibition = await post('/api/v1/exhibitions', {
      title: '管理员发布的展会',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-09-21',
      registrationStart: '2026-01-01',
      registrationEnd: '2026-12-31',
      status: '无需审核',
    }, { token: tokens.admin.token });
    assert.strictEqual(adminExhibition.body.ok, true, `管理员发布展会应当成功：${JSON.stringify(adminExhibition.body)}`);
    const adminExhibitionId = adminExhibition.body.exhibition.id;

    const adminRegistration = await post('/api/v1/registrations', {
      exhibitionId: adminExhibitionId,
      visitorName: '管理员',
      visitorType: '专业观众',
      // 新展会没有自定义收集项，服务端按默认三项校验：必填的「姓名 / 公司名称」要填上
      answers: '姓名 / 公司名称：管理员\n参观身份：专业观众',
    }, { token: tokens.admin.token });
    assert.strictEqual(adminRegistration.body.ok, true, `管理员报名应当成功：${JSON.stringify(adminRegistration.body)}`);

    // 写一个与当前值相同的字段：既证明没被受限逻辑拦下，也不改动管理员的资料
    const adminProfile = await put('/api/v1/profile', {
      nickname: adminBootstrap.body.user.nickname, region: adminBootstrap.body.user.region,
    }, { token: tokens.admin.token });
    assert.strictEqual(adminProfile.body.ok, true, `管理员改资料应当成功：${JSON.stringify(adminProfile.body)}`);

    // 清理：删掉展会（报名按外键级联删除）
    assert.strictEqual((await del(`/api/v1/exhibitions/${adminExhibitionId}`,
      { token: tokens.admin.token })).body.ok, true);
  } finally {
    // 还原：账号状态与个人资料，后面的用例还要用这个账号
    await put('/api/v1/users/usr-3/status', { status: '正常' }, { token: tokens.admin.token });
    await put('/api/v1/profile', {
      nickname: profileBefore.nickname, region: profileBefore.region, bio: profileBefore.bio,
      socialMedia: profileBefore.socialMedia,
    }, { token: tokens.user.token });
    await put('/api/v1/profile/notifications', {
      exhibitionReminder: notifyBefore.exhibitionReminder,
    }, { token: tokens.user.token });
    const restored = await get('/api/v1/bootstrap', { token: tokens.user.token });
    assert.strictEqual(restored.body.user.can.limited, false, '受限状态没有还原，后续用例会被污染');
  }
});

/**
 * 受限账号的写操作被全面收紧：编辑 / 删除展会、暂停恢复报名、改报名收集项、现场核销
 * 都要 403 +「受限」文案，且**不再给角色文案**（受限判定排在角色检查之前）；
 * 改回「正常」后五件事照样做得成；管理员即便库里是受限状态也不受影响。
 *
 * 自造展会与报名（跑完删展会，外键级联清掉报名），不依赖种子里的核销状态，
 * 也不依赖其它用例的执行顺序；受限状态一律在 `finally` 里还原成「正常」。
 */
test('受限账号不能编辑 / 删除展会、改报名设置与核销，恢复正常后照旧，管理员不受限', async () => {
  // 账号状态直接改库里的那一列：管理员不能改自己的状态（`PUT /users/:id/status` 会拒），
  // 而种子里只有一个管理员，因此「管理员受限」这个状态只能这样构造出来。
  // 库里存的是英文代码（`users_status_check` 只认 active / limited / banned），
  // 中文标签只在接口层收发，所以这里给代码而不是「受限 / 正常」。
  const setStatus = (id, status) => pool.query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);

  // 两场自造展会：A 给受限展商 / 受限普通用户与「恢复正常后照旧」用；B 专门留给管理员核销。
  const createExhibition = async (title) => {
    const created = await post('/api/v1/exhibitions', {
      title,
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(30),
      category: '智能家居',
      status: '无需审核',
      qrEnabled: true,
    }, { token: tokens.exhibitor.token });
    assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
    return created.body.exhibition.id;
  };

  const exhibitionA = await createExhibition('受限收紧用例展 A');
  const exhibitionB = await createExhibition('受限收紧用例展 B');

  const submit = async (exhibitionId, token, name) => {
    const submitted = await post('/api/v1/registrations', {
      exhibitionId,
      visitorName: name,
      visitorType: '专业观众',
      answers: `姓名 / 公司名称：${name}\n参观身份：专业观众`,
    }, { token });
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    return submitted.body.registration.id;
  };
  const registrationA = await submit(exhibitionA, tokens.user.token, '受限收紧用例');
  const registrationB = await submit(exhibitionB, tokens.admin.token, '受限收紧管理员');

  // 被收紧的五条路由：动作名 + 期望文案 + 怎么发这个请求（受限与恢复正常两轮共用）。
  const calls = [
    {
      name: '编辑展会',
      message: '账号已被限制，不能修改展会',
      send: (token, id) => put(`/api/v1/exhibitions/${id}`, { title: '受限账号不该改成的标题' }, { token }),
    },
    {
      name: '删除展会',
      message: '账号已被限制，不能删除展会',
      send: (token, id) => del(`/api/v1/exhibitions/${id}`, { token }),
    },
    {
      name: '暂停 / 恢复报名',
      message: '账号已被限制，不能修改报名设置',
      send: (token, id) => put(`/api/v1/exhibitions/${id}/status`, { status: '无需审核' }, { token }),
    },
    {
      name: '改报名收集项',
      message: '账号已被限制，不能修改报名设置',
      send: (token, id) => put(`/api/v1/exhibitions/${id}/fields`, {
        fields: [{ title: '受限账号不该改成的问题', type: '文本', required: false }],
      }, { token }),
    },
    {
      name: '现场核销',
      message: '账号已被限制，不能核销',
      send: (token, id, registrationId) => post('/api/v1/checkin', {
        code: `CALMOBILE-CHECKIN|${id}|${registrationId}`,
      }, { token }),
    },
  ];

  try {
    // ① 受限的展商（自己举办的展会也一样不给动）：403 + 逐条比对文案
    await setStatus('usr-2', 'limited');
    for (const item of calls) {
      const response = await item.send(tokens.exhibitor.token, exhibitionA, registrationA);
      assert.strictEqual(response.status, 403,
        `${item.name}对受限展商应当 403：${JSON.stringify(response.body)}`);
      assert.strictEqual(response.body.error, item.message, `${item.name}的受限文案不对`);
    }

    // 被拦下的操作确实没生效：展会还在，标题 / 收集项 / 报名状态都没被改动
    const untouched = await get(`/api/v1/exhibitions/${exhibitionA}`);
    assert.strictEqual(untouched.body.found, true, '受限拦截之后展会必须还在');
    assert.strictEqual(untouched.body.exhibition.title, '受限收紧用例展 A', '受限账号不该改到标题');
    assert.strictEqual(untouched.body.fields[0].title, '姓名 / 公司名称', '受限账号不该改到收集项');
    const beforeCheckin = await get(`/api/v1/registrations/${registrationA}`, { token: tokens.user.token });
    assert.strictEqual(beforeCheckin.body.registration.statusLabel, '已通过', '受限账号不该核销成功');

    // ② 受限的普通用户：同样拿到「账号已被限制…」，而不是「只有展商或管理员可以执行此操作」
    //    —— 这正是受限判定必须排在角色检查之前的机器化证据
    await setStatus('usr-3', 'limited');
    for (const item of calls) {
      const response = await item.send(tokens.user.token, exhibitionA, registrationA);
      assert.strictEqual(response.status, 403,
        `${item.name}对受限普通用户应当 403：${JSON.stringify(response.body)}`);
      assert.ok(response.body.error.includes('已被限制'),
        `${item.name}应当给「账号已被限制」文案：${response.body.error}`);
      assert.ok(!response.body.error.includes('展商'),
        `${item.name}不该给角色文案：${response.body.error}`);
    }

    // ③ 摘掉受限标签后，普通用户被拒的原因变回角色权限（不再因为「已被限制」）
    await setStatus('usr-3', 'active');
    for (const item of calls) {
      const response = await item.send(tokens.user.token, exhibitionA, registrationA);
      assert.strictEqual(response.status, 403,
        `${item.name}普通用户仍应因角色被拒：${JSON.stringify(response.body)}`);
      assert.ok(!response.body.error.includes('已被限制'),
        `${item.name}恢复正常后不该再因受限被拒：${response.body.error}`);
    }

    // ④ 同一账号改回「正常」后，受限展商五件事全部做得成
    await setStatus('usr-2', 'active');
    const edited = await put(`/api/v1/exhibitions/${exhibitionA}`,
      { title: '恢复正常后改的标题' }, { token: tokens.exhibitor.token });
    assert.strictEqual(edited.body.ok, true, `恢复正常后编辑展会应当成功：${JSON.stringify(edited.body)}`);
    assert.strictEqual(edited.body.exhibition.title, '恢复正常后改的标题');

    const paused = await put(`/api/v1/exhibitions/${exhibitionA}/status`,
      { status: '需审核' }, { token: tokens.exhibitor.token });
    assert.strictEqual(paused.body.ok, true, `恢复正常后改报名设置应当成功：${JSON.stringify(paused.body)}`);
    assert.strictEqual(paused.body.exhibition.status, '需审核');

    const refields = await put(`/api/v1/exhibitions/${exhibitionA}/fields`, {
      fields: [{ title: '恢复正常后的问题', type: '文本', required: false }],
    }, { token: tokens.exhibitor.token });
    assert.strictEqual(refields.body.ok, true, `恢复正常后改收集项应当成功：${JSON.stringify(refields.body)}`);
    assert.strictEqual(refields.body.fields[0].title, '恢复正常后的问题');

    const checked = await post('/api/v1/checkin', {
      code: `CALMOBILE-CHECKIN|${exhibitionA}|${registrationA}`,
    }, { token: tokens.exhibitor.token });
    assert.strictEqual(checked.body.ok, true, `恢复正常后核销应当成功：${JSON.stringify(checked.body)}`);
    assert.strictEqual(checked.body.status, '已参加');

    const removed = await del(`/api/v1/exhibitions/${exhibitionA}`, { token: tokens.exhibitor.token });
    assert.strictEqual(removed.body.ok, true, `恢复正常后删除展会应当成功：${JSON.stringify(removed.body)}`);
    assert.strictEqual((await get(`/api/v1/exhibitions/${exhibitionA}`)).body.found, false,
      '删除之后展会不应还在');

    // ⑤ 管理员：库里被标成「受限」也不受这些限制（否则没人能解除限制）
    await setStatus('usr-1', 'limited');
    const adminState = await get('/api/v1/bootstrap', { token: tokens.admin.token });
    assert.strictEqual(adminState.body.user.can.limited, false, '管理员不该被判定为受限');
    assert.strictEqual(adminState.body.user.can.register, true);
    assert.strictEqual(adminState.body.user.can.profile, true);

    const adminEdit = await put(`/api/v1/exhibitions/${exhibitionB}`,
      { title: '管理员受限态下仍能改' }, { token: tokens.admin.token });
    assert.strictEqual(adminEdit.body.ok, true, `管理员受限态下编辑展会应当成功：${JSON.stringify(adminEdit.body)}`);
    const adminStatus = await put(`/api/v1/exhibitions/${exhibitionB}/status`,
      { status: '需审核' }, { token: tokens.admin.token });
    assert.strictEqual(adminStatus.body.ok, true, `管理员受限态下改报名设置应当成功：${JSON.stringify(adminStatus.body)}`);
    const adminFields = await put(`/api/v1/exhibitions/${exhibitionB}/fields`, {
      fields: [{ title: '管理员受限态下改的收集项', type: '文本', required: false }],
    }, { token: tokens.admin.token });
    assert.strictEqual(adminFields.body.ok, true, `管理员受限态下改收集项应当成功：${JSON.stringify(adminFields.body)}`);
    const adminCheckin = await post('/api/v1/checkin', {
      code: `CALMOBILE-CHECKIN|${exhibitionB}|${registrationB}`,
    }, { token: tokens.admin.token });
    assert.strictEqual(adminCheckin.body.ok, true, `管理员受限态下核销应当成功：${JSON.stringify(adminCheckin.body)}`);
    assert.strictEqual(adminCheckin.body.status, '已参加');
    const adminDelete = await del(`/api/v1/exhibitions/${exhibitionB}`, { token: tokens.admin.token });
    assert.strictEqual(adminDelete.body.ok, true, `管理员受限态下删除展会应当成功：${JSON.stringify(adminDelete.body)}`);
  } finally {
    // 还原：三个种子账号的状态（后面的用例还要用它们），再清掉自造展会（级联清报名；
    // 上面已经删掉的那场会拿到 404，忽略即可）。
    await setStatus('usr-1', 'active');
    await setStatus('usr-2', 'active');
    await setStatus('usr-3', 'active');
    await del(`/api/v1/exhibitions/${exhibitionA}`, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionB}`, { token: tokens.admin.token });
  }
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

test('公开页不下发报名码，本人与管理员仍能拿到', async () => {
  // 自己造数据、自己还原：不依赖其它用例执行到哪一步，也不改它们共享的记录。
  const users = await get('/api/v1/users?query=user', { token: tokens.admin.token });
  const self = users.body.find((row) => row.username === 'user');
  assert.ok(self, '种子里的 user 账号应当存在');

  // 启用二维码 + 无需审核：提交即已通过，因此本人应当拿得到报名码。
  const created = await post('/api/v1/exhibitions', {
    title: '公开页报名码用例展',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: isoDateAfter(30),
    category: '智能家居',
    status: '无需审核',
    qrEnabled: true,
  }, { token: tokens.exhibitor.token });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  const before = await get('/api/v1/profile', { token: tokens.user.token });
  const originalShow = before.body.showRegistrations === true;
  try {
    const submitted = await post('/api/v1/registrations', {
      exhibitionId,
      visitorName: '公开页用例',
      visitorType: '专业观众',
      answers: '姓名 / 公司名称：公开页用例\n参观身份：专业观众',
    }, { token: tokens.user.token });
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const registrationId = submitted.body.registration.id;
    const codePrefix = `CALMOBILE-CHECKIN|${exhibitionId}|${registrationId}`;

    // 本人的取码路径（报名详情）照常带报名码
    const own = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
    assert.strictEqual(own.body.found, true);
    assert.ok(String(own.body.registration.checkInCode).startsWith(codePrefix),
      `本人应当拿到报名码：${own.body.registration.checkInCode}`);

    // 打开「展示我的报名」后，匿名访问公开页也必须看不到报名码
    const saved = await put('/api/v1/profile', { showRegistrations: true }, { token: tokens.user.token });
    assert.strictEqual(saved.body.ok, true);

    const anonymous = await get(`/api/v1/users/public?userId=${self.id}`);
    assert.strictEqual(anonymous.body.found, true);
    const record = anonymous.body.registrations.find((item) => item.id === registrationId);
    assert.ok(record, '打开隐私开关后，匿名访问应当看到这条已通过的报名');
    assert.ok(record.checkInCode === '' || record.checkInCode === undefined,
      `公开页不能下发报名码：${JSON.stringify(record.checkInCode)}`);

    // 公开页对所有视角一致（本人 / 管理员也一样）：要报名码请走报名详情或审核接口
    const asSelf = await get(`/api/v1/users/public?userId=${self.id}`, { token: tokens.user.token });
    const selfRecord = asSelf.body.registrations.find((item) => item.id === registrationId);
    assert.ok(selfRecord, '本人应当能在公开页看到自己的报名');
    assert.ok(selfRecord.checkInCode === '' || selfRecord.checkInCode === undefined,
      '公开页对本人也不下发报名码');

    const asAdmin = await get(`/api/v1/users/public?userId=${self.id}`, { token: tokens.admin.token });
    const adminRecord = asAdmin.body.registrations.find((item) => item.id === registrationId);
    assert.ok(adminRecord, '管理员应当能看到公开页上的这条报名');
    assert.strictEqual(adminRecord.checkInCode, '', '公开页对管理员也不下发报名码');
    assert.ok(String(adminRecord.answers).includes('公开页用例'), '展示报名记录仍是隐私开关的本意，回答照常给出');

    // 管理员另有带报名码的路径：报名详情对管理员开放任意一条
    const adminDetail = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.admin.token });
    assert.strictEqual(adminDetail.body.found, true);
    assert.ok(String(adminDetail.body.registration.checkInCode).startsWith(codePrefix),
      '管理员走报名详情应当仍能拿到报名码');
  } finally {
    await put('/api/v1/profile', { showRegistrations: originalShow }, { token: tokens.user.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
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

test('视频大小上限可配置，bootstrap 与 settings 读回同一个值，越界被收敛', async () => {
  // 老库（app_settings 里还没有 videoSizeMb）也要能拿到默认值，而不是 undefined
  const bootstrapBefore = await get('/api/v1/bootstrap');
  assert.ok(Number(bootstrapBefore.body.media.videoSizeMb) > 0,
    `bootstrap 的 media 必须带 videoSizeMb：${JSON.stringify(bootstrapBefore.body.media)}`);
  const settingsBefore = await get('/api/v1/settings');
  const defaultSize = Number(settingsBefore.body.media.videoSizeMb);
  const imageSizeBefore = Number(settingsBefore.body.media.imageSizeMb);
  assert.strictEqual(Number(bootstrapBefore.body.media.videoSizeMb), defaultSize,
    'bootstrap 与 settings 的 media 来自同一份 payload，值必须一致');

  try {
    const saved = await put('/api/v1/settings', { videoSizeMb: 120 }, { token: tokens.admin.token });
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.settings.media.videoSizeMb, 120, '保存结果里应当带上新的上限');

    const bootstrap = await get('/api/v1/bootstrap');
    assert.strictEqual(Number(bootstrap.body.media.videoSizeMb), 120, 'bootstrap 应当读回新的上限');
    const settings = await get('/api/v1/settings');
    assert.strictEqual(Number(settings.body.media.videoSizeMb), 120, 'settings 应当读回新的上限');
    // 同一段里的其它键不受影响
    assert.strictEqual(Number(settings.body.media.imageSizeMb), imageSizeBefore);

    const tooSmall = await put('/api/v1/settings', { videoSizeMb: 0 }, { token: tokens.admin.token });
    assert.strictEqual(tooSmall.body.settings.media.videoSizeMb, 1, '0 应当被夹到下限 1');
    const tooLarge = await put('/api/v1/settings', { videoSizeMb: 9999 }, { token: tokens.admin.token });
    assert.strictEqual(tooLarge.body.settings.media.videoSizeMb, 500, '9999 应当被夹到上限 500');
    assert.strictEqual(Number((await get('/api/v1/bootstrap')).body.media.videoSizeMb), 500);
  } finally {
    await put('/api/v1/settings', { videoSizeMb: defaultSize }, { token: tokens.admin.token });
  }
});

test('老库的 app_settings.media 缺 videoSizeMb 时用默认值兜底', async () => {
  // 直接写一条「加这个键之前」的 media：只有三个键，没有任何 videoSizeMb
  await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2',
    [JSON.stringify({ imageCount: 6, imageSizeMb: 4, videoCount: 1 }), 'media']);
  try {
    const bootstrap = await get('/api/v1/bootstrap');
    assert.strictEqual(bootstrap.body.media.videoSizeMb, DEFAULT_SETTINGS.media.videoSizeMb,
      `缺键时应当补默认值，而不是 undefined：${JSON.stringify(bootstrap.body.media)}`);
    assert.strictEqual(bootstrap.body.media.imageCount, 6, '库里已有的键照旧生效');
    const settings = await get('/api/v1/settings');
    assert.strictEqual(settings.body.media.videoSizeMb, DEFAULT_SETTINGS.media.videoSizeMb);
  } finally {
    await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2',
      [JSON.stringify(DEFAULT_SETTINGS.media), 'media']);
  }
});

test('外观模式只接受三个取值，且是个人偏好', async () => {
  // 未登录不能写：以前这里是 optionalAuth，匿名请求会把取值写成所有用户的默认外观。
  const defaultBefore = await get('/api/v1/settings');
  const anonymous = await put('/api/v1/settings/ui-mode', { mode: 'dark' });
  assert.strictEqual(anonymous.status, 401, '未登录不能修改外观模式');
  assert.ok(anonymous.body.error, '401 要带可展示的原因');
  const defaultAfter = await get('/api/v1/settings');
  assert.strictEqual(defaultAfter.body.ui.mode, defaultBefore.body.ui.mode,
    '匿名请求不能改掉服务器级的默认外观');

  const dark = await put('/api/v1/settings/ui-mode', { mode: 'dark' }, { token: tokens.admin.token });
  assert.strictEqual(dark.body.mode, 'dark');
  const mine = await get('/api/v1/settings', { token: tokens.admin.token });
  assert.strictEqual(mine.body.ui.mode, 'dark', '个人外观模式应当被记住');

  // 另一个用户不受影响
  const other = await get('/api/v1/settings', { token: tokens.user.token });
  assert.notStrictEqual(other.body.ui.mode, 'dark', '外观模式不应该串到别人身上');

  const invalid = await put('/api/v1/settings/ui-mode', { mode: '乱填' }, { token: tokens.admin.token });
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
 * 这条断言是「47 个动作全部实现」的机器化证据：漏实现一个动作、或者改了路径忘了
 * 同步 `ENDPOINTS`，都会在这里失败，而不是等到某个页面在真机上静默报错。
 */
test('前端每个数据动作都对应后端已注册的路由', () => {
  const endpoints = frontendEndpoints();
  const actions = Object.keys(endpoints);
  assert.strictEqual(actions.length, 47,
    `前端数据动作数量变了（期望 47）：${actions.length} 个 —— ${actions.join(', ')}`);

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

// ── 状态报告与状态页 ─────────────────────────────────────────────

/**
 * 连响应头一起返回的请求：既有用例共用的 `request()` 只回状态码与响应体，
 * 而状态页要断言 `content-type`，所以这里单独写一个，不动公共工具。
 */
function requestRaw(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: encodeURI(path),
      method,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
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
  assert.ok(String(report.database.version).includes('PostgreSQL'), `版本串不像 PostgreSQL：${report.database.version}`);
  assert.ok(report.database.database, '缺少库名');
  assert.ok(report.database.host, '缺少地址');
  assert.strictEqual(typeof report.database.pool.total, 'number');
  assert.strictEqual(typeof report.database.pool.idle, 'number');
  assert.strictEqual(typeof report.database.pool.waiting, 'number');
  assert.strictEqual(report.database.error, undefined, '数据库正常时不该带错误信息');

  // 迁移：与 STEPS 逐条对齐，测试库是刚建好的，因此不该有遗漏。
  const { STEPS } = require('../src/config/migrate');
  assert.deepStrictEqual(report.migrations.pending, [], '测试库刚迁移完，不该有未应用的步骤');
  assert.deepStrictEqual(
    report.migrations.applied.map((item) => item.id).sort(),
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
  assert.deepStrictEqual(report.checks.filter((check) => check.status === 'fail').map((check) => check.name), [],
    '测试环境里不该有失败的自检项');

  const endpoints = report.endpoints.map((item) => `${item.method} ${item.path}`);
  assert.ok(endpoints.includes('GET /api/v1/bootstrap'), '接口清单缺少 GET /api/v1/bootstrap');
  assert.ok(endpoints.includes('POST /api/v1/checkin'), '接口清单缺少 POST /api/v1/checkin');
});

test('状态报告的接口清单与后端注册路由、前端动作覆盖一致', async () => {
  const { body } = await get('/api/v1/status');
  assert.ok(body.endpoints.length > 0, '接口清单不能为空');

  // 1) 与后端实际注册的路由逐条对齐（清单与 backendRoutes() 同源，漂移就会失败）
  const declared = backendRoutes().map((route) => `${route.method} ${route.path}`).sort();
  const reported = body.endpoints.map((item) => `${item.method} ${item.path}`).sort();
  assert.deepStrictEqual(reported, declared, '接口清单与后端注册的路由对不上');

  // 2) 路径要么在 /api/v1 下，要么是文档里写明的非前缀路由
  const documentedPlain = new Set(['/ping', '/health', '/status']);
  for (const item of body.endpoints) {
    assert.ok(item.method && item.path, '接口清单每一项都要有 method 与 path');
    assert.ok(item.path.startsWith('/api/v1') || documentedPlain.has(item.path),
      `接口清单里出现未登记的路径：${item.path}`);
  }

  // 3) 前端每个数据动作都能在清单里找到落点（与契约测试同一套映射）
  const endpoints = frontendEndpoints();
  const patterns = body.endpoints.map((item) => ({
    method: item.method,
    pattern: routePattern(item.path),
  }));
  const payloads = [
    {},
    {
      id: 'sample-id', userId: 'sample-id', exhibitionId: 'sample-id', nickname: 'n',
      query: 'q', year: 2026, month: 6, day: 1, status: '待审核', code: 'c',
    },
  ];
  const missing = [];
  for (const action of Object.keys(endpoints)) {
    for (const payload of payloads) {
      const mapped = endpoints[action](payload);
      const full = `/api/v1${mapped.path}`;
      if (!patterns.some((route) => route.method === mapped.method && route.pattern.test(full))) {
        missing.push(`${action} → ${mapped.method} ${full}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], `以下前端动作在接口清单里没有落点：\n  ${missing.join('\n  ')}`);
});

test('状态页返回可直接打开的中文 HTML', async () => {
  const response = await requestRaw('GET', '/status');
  assert.strictEqual(response.status, 200, '状态页必须打得开');
  assert.ok(String(response.headers['content-type']).includes('text/html'),
    `content-type 应当是 HTML：${response.headers['content-type']}`);
  const html = response.body;

  assert.ok(html.includes('calmobile-server'), '页面要显示服务名');
  assert.ok(html.includes('正常'), '页面要显示「正常」徽章');
  assert.ok(html.includes('异常'), '刷新脚本要能切到「异常」徽章');
  for (const title of ['服务信息', '数据库', '迁移', '数据量', '自检项', '接口清单']) {
    assert.ok(html.includes(title), `页面缺少卡片：${title}`);
  }
  assert.ok(html.includes('自动刷新'), '缺少自动刷新开关');
  assert.ok(html.includes("fetch('/api/v1/status'"), '页面脚本应当自己拉 JSON 局部更新');
  assert.ok(html.includes('prefers-color-scheme:dark'), '深色模式要跟随系统');
  // 单文件自包含：不能有外部脚本、样式或图片。
  assert.strictEqual(/<script[^>]+src=/.test(html), false, '状态页不能引用外部脚本');
  assert.strictEqual(/<(link|img)\b/.test(html), false, '状态页不能引用外部资源');
});

test('数据库不可用时状态页仍能渲染出失败原因', async () => {
  // 真的把数据库停掉属于运维动作，这里用一份真实的失败报告走一遍模板：
  // 页面渲染不碰数据库，因此这条断言能稳定复现「降级时页面照样打得开」。
  const { renderStatusPage } = require('../src/status-page');
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
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    },
    migrations: { applied: [], pending: ['0001-core'], error: '数据库不可用：connect ECONNREFUSED 127.0.0.1:5432' },
    data: { users: null, exhibitions: null, registrations: null, exhibition_fields: null, app_settings: null },
    checks: [
      { name: '数据库连通', status: 'fail', detail: 'connect ECONNREFUSED 127.0.0.1:5432', ms: 2000 },
      { name: '至少一场展会', status: 'fail', detail: '数据库不可用，统计不了展会', ms: 0 },
    ],
  };
  const html = renderStatusPage(broken);
  assert.ok(html.includes('异常'), '徽章要变成「异常」');
  assert.ok(html.includes('ECONNREFUSED'), '页面要显示数据库的报错原文');
  assert.ok(html.includes('未连接'), '连通状态要显示「未连接」');
  assert.ok(html.includes('失败'), '自检项要能显示失败');
  assert.ok(html.includes('0001-core'), '未应用的迁移要列出来');
  // 首屏数据是内嵌的 JSON，坏消息也应当已经进去了。
  assert.ok(html.includes('"connected":false'), '首屏就应当带着失败状态');
});
