/**
 * 演示后端与前端 API 入口的契约测试。
 *
 * 前后端分离后最容易出问题的地方是**字段漂移**：后端改了字段名，前端静默渲染成空。
 * 这里直接启动演示后端（零依赖，仅用 Node 内置模块），按 `js/core/api.js`
 * 调用一遍关键接口，断言页面真正用到的字段都在。
 *
 * 用法：node --test server/test/demo-api.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const { handlers, setCurrentUser } = require('../src/demo-api');

/** 直接调用处理函数，不起 HTTP：契约测试关心的是返回结构。 */
function invoke(action, body = {}, username = 'demo') {
    setCurrentUser(username);
    const handler = handlers[action];
    assert.ok(handler, `后端缺少接口 ${action}`);
    return handler(body);
}

test('连通性接口返回服务标识', () => {
    const result = invoke('ping');
    assert.strictEqual(result.ok, true);
    assert.ok(result.service);
});

test('bootstrap 下发前端启动所需的全部配置块', () => {
    const data = invoke('bootstrap');
    // 这些键与 bridge.js 的 applyBootstrap 一一对应，缺一个页面就会渲染异常。
    for (const key of ['user', 'theme', 'ui', 'capabilities', 'categories', 'review',
        'media', 'announcement', 'brand', 'limits', 'server', 'calendar']) {
        assert.ok(data[key] !== undefined, `bootstrap 缺少 ${key}`);
    }
    assert.ok(data.brand.zh, '缺少中文标题');
    assert.ok(Number(data.limits.exhibitionTitle) > 0, '缺少表单字符数上限');
    assert.ok(data.user.can, '缺少角色权限');
});

test('展会列表的字段覆盖页面渲染所需的全部字段', () => {
    const items = invoke('exhibitions.list');
    assert.ok(items.length > 0, '演示数据至少要有展会');
    const required = ['id', 'title', 'venue', 'time', 'category', 'description',
        'descriptionFormat', 'status', 'mode', 'modeLabel', 'openForRegistration',
        'year', 'month', 'day', 'date', 'dateLabel', 'exhibitor', 'exhibitorNote',
        'highlights', 'imageUri', 'registrationStart', 'registrationEnd', 'qrEnabled',
        'registrationCount', 'fieldCount'];
    for (const item of items) {
        for (const key of required) {
            assert.ok(item[key] !== undefined, `展会 ${item.id} 缺少字段 ${key}`);
        }
        assert.strictEqual(typeof item.qrEnabled, 'boolean', 'qrEnabled 必须是布尔值');
        assert.strictEqual(typeof item.openForRegistration, 'boolean', 'openForRegistration 必须是布尔值');
    }
});

test('月视图返回 eventDays / exhibitions / selected 三块', () => {
    const data = invoke('exhibitions.month', { year: 2026, month: 6, explicit: true });
    assert.strictEqual(data.year, 2026);
    assert.strictEqual(data.month, 6);
    assert.ok(Array.isArray(data.eventDays) && data.eventDays.length > 0, '缺少有展会的日期');
    assert.ok(Array.isArray(data.exhibitions), '缺少当月展会列表');
    assert.ok(Array.isArray(data.selected), '缺少选中日期的展会列表');
    assert.ok(data.monthLabel.includes('2026'), '缺少月份标题');
    assert.ok(data.eventDays.includes(data.day), '选中日期应当是有展会的日期');
});

test('选中没有展会的日期时原样返回该日期，不回落到有展会的日子', () => {
    // 用户点的是没有展会的那一天：服务端必须原样返回，由页面显示空状态；
    // 之前这里会回落到 eventDays[0]，表现为“点了日期没反应”。
    const data = invoke('exhibitions.month', { year: 2026, month: 6, day: 16, explicit: true });
    assert.strictEqual(data.day, 16, '选中日期被服务端改写了');
    assert.strictEqual(data.selected.length, 0, '没有展会的日期不应返回展会');

    // 有展会的日期照常返回对应展会
    const withEvent = invoke('exhibitions.month', { year: 2026, month: 6, day: 15, explicit: true });
    assert.strictEqual(withEvent.day, 15);
    assert.ok(withEvent.selected.length > 0, '有展会的日期应当返回展会');

    // 不带日期时才回落到第一个有展会的日期
    const fallback = invoke('exhibitions.month', { year: 2026, month: 6 });
    assert.strictEqual(fallback.day, 8, '进入页面时应落到第一个有展会的日期');
});

/**
 * 月视图不再替调用方改月份。
 *
 * 以前「请求的月份没有展会」会被悄悄换成第一个有展会的月份，于是返回值和入参对不上、
 * 缓存键也不稳定（预加载按请求的月份热身，页面却拿到别的月份）。现在：
 * 请求哪个月就返回哪个月，「打开应用先看哪个月」由 bootstrap 的 calendar.landing 决定。
 */
test('月视图原样返回请求的月份，空月份不回落到有数据的月份', () => {
    const empty = invoke('exhibitions.month', { year: 2026, month: 1 });
    assert.strictEqual(empty.month, 1, '空月份必须原样返回');
    assert.strictEqual(empty.year, 2026);
    assert.strictEqual(empty.eventDays.length, 0, '空月份不应有展会日期');
    assert.strictEqual(empty.day, 0, '没有展会时选中日期为 0');

    const filled = invoke('exhibitions.month', { year: 2026, month: 6 });
    assert.strictEqual(filled.month, 6);
    assert.ok(filled.eventDays.length > 0, '示例数据应当落在 6 月');
});

test('bootstrap 下发日历落点月份，供前端决定首次打开哪个月', () => {
    const landing = invoke('bootstrap').calendar.landing;
    assert.ok(landing && landing.year && landing.month, '必须下发 calendar.landing');

    // 落点必须是真的有展会的月份，否则首页一进来就是空日历。
    const data = invoke('exhibitions.month', { year: landing.year, month: landing.month });
    assert.ok(data.eventDays.length > 0, 'calendar.landing 指向的月份没有展会');
});

test('登录成功返回令牌与用户态，失败给出业务错误', () => {
    const ok = invoke('auth.login', { username: 'demo', password: 'password' });
    assert.strictEqual(ok.ok, true);
    assert.ok(ok.token, '登录成功应当返回令牌');
    assert.strictEqual(ok.user.role, 'admin');
    assert.strictEqual(ok.user.can.admin, true);

    const bad = invoke('auth.login', { username: 'demo', password: 'wrong' });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.error, '登录失败必须给出可展示的错误');
});

test('报名记录字段覆盖报名详情与我的报名', () => {
    const items = invoke('registrations.list');
    assert.ok(items.length > 0);
    for (const item of items) {
        for (const key of ['id', 'exhibitionId', 'exhibitionTitle', 'exhibitionDay',
            'exhibitionTime', 'exhibitionVenue', 'visitorName', 'visitorType', 'answers',
            'statusLabel', 'qrEnabled', 'checkInCode']) {
            assert.ok(item[key] !== undefined, `报名 ${item.id} 缺少字段 ${key}`);
        }
    }
});

test('报名码只在启用二维码且已通过时下发', () => {
    // exh-1 启用了二维码且记录为已通过 → 有码
    const withCode = invoke('registrations.list')
        .find((item) => item.id === 'registration-1');
    assert.ok(withCode.checkInCode.startsWith('CALMOBILE-CHECKIN|exh-1|registration-1'),
        `已通过的报名应当有报名码，实际：${withCode.checkInCode}`);

    // exh-2 未启用二维码 → 不下发报名码
    const withoutCode = invoke('registrations.list')
        .find((item) => item.id === 'registration-3');
    assert.strictEqual(withoutCode.checkInCode, '', '未启用二维码的展会不应下发报名码');
});

test('核销把已通过推进为已参加，重复核销给出提示', () => {
    const code = 'CALMOBILE-CHECKIN|exh-2|registration-4';
    // 先造一条已通过的报名
    const created = invoke('registrations.submit', {
        exhibitionId: 'exh-1',
        visitorName: '核销用例',
        answers: '姓名 / 公司名称：核销用例',
    });
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.statusLabel, '已通过', '无需审核的展会提交后应自动通过');

    const first = invoke('checkin.scan', { code: `CALMOBILE-CHECKIN|exh-1|${created.registration.id}` });
    assert.strictEqual(first.ok, true, `首次核销应当成功：${first.error}`);
    assert.strictEqual(first.status, '已参加');
    assert.ok(first.record.visitorName, '核销结果要带报名人信息');

    const again = invoke('checkin.scan', { code: `CALMOBILE-CHECKIN|exh-1|${created.registration.id}` });
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.duplicated, true, '重复核销应当标记 duplicated');
    assert.ok(again.error.includes('已经核销'), `重复核销提示不正确：${again.error}`);
});

test('无法识别的报名码与待审核报名都会被拒绝核销', () => {
    const unknown = invoke('checkin.scan', { code: 'NOT-A-CODE' });
    assert.strictEqual(unknown.ok, false);
    assert.ok(unknown.error.includes('无法识别'));

    // registration-3 属于 exh-2，状态为待审核
    const pending = invoke('checkin.scan', { code: 'CALMOBILE-CHECKIN|exh-2|registration-3' });
    assert.strictEqual(pending.ok, false);
    assert.ok(pending.error.includes('待审核'), `待审核应说明原因：${pending.error}`);
});

test('review 列表给出五种状态计数与筛选后的记录', () => {
    const data = invoke('review.list', { exhibitionId: 'exh-1', status: '全部' });
    assert.ok(Array.isArray(data.records));
    for (const key of ['total', '待审核', '已通过', '已拒绝', '已参加']) {
        assert.strictEqual(typeof data.counts[key], 'number', `counts 缺少 ${key}`);
    }
    const pending = invoke('review.list', { exhibitionId: 'exh-1', status: '待审核' });
    assert.ok(pending.records.every((item) => item.status === '待审核'),
        '按状态筛选后不应混入其它状态');
});

test('settings 保存后可读回，外观模式受限于三个取值', () => {
    const saved = invoke('settings.save', { themeIndex: 2, appTitleZh: '展会助手', canRevise: true });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.settings.theme.index, 2);
    assert.strictEqual(saved.settings.brand.zh, '展会助手');
    assert.strictEqual(saved.settings.review.canRevise, true);

    // 还原，避免影响其它用例
    invoke('settings.save', { themeIndex: 0, appTitleZh: '发现展会', canRevise: false });

    assert.strictEqual(invoke('settings.uiMode', { mode: 'dark' }).mode, 'dark');
    assert.strictEqual(invoke('settings.uiMode', { mode: '乱填' }).mode, 'auto');
    invoke('settings.uiMode', { mode: 'auto' });
});

test('隐私开关保存后会持久，并决定公开页是否展示报名记录', () => {
    // users.list 的 id 按 ACCOUNTS 顺序生成：user-1=demo、user-2=exhibitor、user-3=user
    const userAccount = 'user-3';
    // 默认不公开
    const before = invoke('users.public', { userId: userAccount }, 'user');
    assert.strictEqual(before.showRegistrations, false, '默认应当不公开');

    // 用户打开开关
    const saved = invoke('profile.save', { showRegistrations: true }, 'user');
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.user.showRegistrations, true, '保存结果里应当带上开关状态');

    // 读回仍然是 true（此前 userPayload 会把它重置成默认值）
    const after = invoke('profile.get', {}, 'user');
    assert.strictEqual(after.showRegistrations, true, '隐私开关没有持久化');

    // 公开页随之按该设置放行；管理员始终可见
    const publicView = invoke('users.public', { userId: userAccount }, 'exhibitor');
    assert.strictEqual(publicView.showRegistrations, true, '公开页没有读到隐私开关');
    const adminView = invoke('users.public', { userId: userAccount }, 'demo');
    assert.strictEqual(adminView.viewedAsAdmin, true);
    assert.ok(adminView.registrations.length >= publicView.registrations.length,
        '管理员应当至少能看到普通访问者能看到的记录');

    // 还原
    invoke('profile.save', { showRegistrations: false }, 'user');
});

test('管理员查看用户公开页不受隐私设置影响', () => {
    const asAdmin = invoke('users.public', { userId: 'user-3' }, 'demo');
    assert.strictEqual(asAdmin.found, true);
    assert.strictEqual(asAdmin.viewedAsAdmin, true, '管理员视角应当被标记');

    const asUser = invoke('users.public', { userId: 'user-3' }, 'user');
    assert.strictEqual(asUser.viewedAsAdmin, false, '普通用户不应是管理视角');
});

test('未实现的接口在 HTTP 层返回 404 而不是 500', async () => {
    // 起一个真实服务实例，验证路由与状态码（处理函数本身不抛异常）。
    const { spawn } = require('node:child_process');
    const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'demo-server.js')], {
        env: { ...process.env, DEMO_PORT: '4123' },
        stdio: 'ignore',
    });
    try {
        const status = await waitForPing(4123);
        assert.strictEqual(status, 200, '连通性接口应当返回 200');
        const notFound = await request(4123, 'not-an-endpoint');
        assert.strictEqual(notFound.status, 404, '未实现的接口应当返回 404');
    } finally {
        server.kill();
    }
});

function waitForPing(port, attempts = 20) {
    return new Promise((resolve, reject) => {
        const attempt = (left) => {
            request(port, 'ping')
                .then((result) => resolve(result.status))
                .catch(() => {
                    if (left <= 0) {
                        reject(new Error('演示后端未能启动'));
                        return;
                    }
                    setTimeout(() => attempt(left - 1), 100);
                });
        };
        attempt(attempts);
    });
}

function request(port, action) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: `/${action}`,
            method: 'GET',
            timeout: 2000,
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.end();
    });
}
