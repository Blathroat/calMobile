/**
 * 前端页面渲染冒烟测试。
 *
 * `webui-check` 只能校验模块能否解析；本脚本补上“真正渲染一遍”的验证：
 * 用最小 DOM 打桩 + 假的 `CalMobileNative` 桥接，按角色把每个页面渲染一次，
 * 捕获未定义变量、错误的桥接参数、缺失的动作名这类只在运行时才暴露的问题。
 *
 * 用法：node --test scripts/webui-render.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'app', 'src', 'main', 'assets', 'web');

// ── 最小 DOM 打桩 ────────────────────────────────────────────────

class ClassList {
    constructor(node) {
        this.node = node;
    }

    _list() {
        return String(this.node.className || '').split(/\s+/).filter(Boolean);
    }

    add(...names) {
        const list = new Set(this._list());
        names.forEach((name) => list.add(name));
        this.node.className = [...list].join(' ');
    }

    remove(...names) {
        const list = new Set(this._list());
        names.forEach((name) => list.delete(name));
        this.node.className = [...list].join(' ');
    }

    contains(name) {
        return this._list().includes(name);
    }
}

class StubNode {
    constructor(tagName, namespaceURI) {
        this.tagName = String(tagName).toUpperCase();
        this.namespaceURI = namespaceURI || null;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.dataset = {};
        this.style = { setProperty() {}, removeProperty() {} };
        this.listeners = new Map();
        this.className = '';
        this.id = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        this.selected = false;
        this.textContent = '';
        this.innerHTML = '';
        this.offsetWidth = 120;
        this.offsetLeft = 0;
        this.classList = new ClassList(this);
    }

    get childNodes() {
        return this.children;
    }

    get firstChild() {
        return this.children[0] || null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(...nodes) {
        this.children = [];
        for (const node of nodes.flat()) {
            if (node === null || node === undefined) {
                continue;
            }
            node.parentNode = this;
            this.children.push(node);
        }
    }

    remove() {
        if (!this.parentNode) {
            return;
        }
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) {
            this.parentNode.children.splice(index, 1);
        }
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'id' || name === 'class') {
            this[name] = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    addEventListener(type, handler) {
        const list = this.listeners.get(type) || [];
        list.push(handler);
        this.listeners.set(type, list);
    }

    removeEventListener(type, handler) {
        const list = this.listeners.get(type) || [];
        this.listeners.set(type, list.filter((item) => item !== handler));
    }

    /** 触发事件，用于验证交互回调不会抛错。 */
    dispatch(type, event = {}) {
        for (const handler of this.listeners.get(type) || []) {
            handler({ target: this, currentTarget: this, ...event });
        }
    }

    setPointerCapture() {}

    focus() {}

    play() {
        return Promise.resolve();
    }

    getContext() {
        return null;
    }

    /** 递归收集所有后代，按 tagName / className / id 过滤。 */
    queryAll(predicate, out = []) {
        for (const child of this.children) {
            if (predicate(child)) {
                out.push(child);
            }
            child.queryAll(predicate, out);
        }
        return out;
    }

    querySelectorAll(selector) {
        // 既支持 CSS 选择器，也支持直接传断言函数，测试写起来更直观。
        if (typeof selector === 'function') {
            return this.queryAll(selector);
        }
        if (selector.startsWith('.')) {
            const name = selector.slice(1);
            return this.queryAll((node) => node.classList.contains(name));
        }
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            return this.queryAll((node) => node.id === id);
        }
        return this.queryAll((node) => node.tagName === selector.toUpperCase());
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    contains() {
        return true;
    }

    closest() {
        return null;
    }
}

/**
 * 每次渲染都在全新的 DOM 树里进行，避免页面之间互相污染。
 * <p>
 * window 对象本身必须在所有用例之间复用：`bridge.js` 在 import 时会捕获当时的
 * window，替换 global.window 会让它拿到过期的引用。
 */
function resetDom(document) {
    const app = new StubNode('div');
    app.id = 'app';
    const toastHost = new StubNode('div');
    toastHost.id = 'toast-host';
    const overlayHost = new StubNode('div');
    overlayHost.id = 'overlay-host';
    document.body.replaceChildren(app, toastHost, overlayHost);
    return { app, toastHost, overlayHost };
}

function createDocument() {
    const documentElement = new StubNode('html');
    const body = new StubNode('body');
    documentElement.appendChild(body);

    const document = {
        documentElement,
        body,
        title: '',
        createElement: (tag) => new StubNode(tag),
        createElementNS: (ns, tag) => new StubNode(tag, ns),
        createTextNode: (text) => {
            const node = new StubNode('#text');
            node.textContent = String(text);
            return node;
        },
        getElementById: (id) => documentElement.querySelector(`#${id}`),
        querySelector: (selector) => documentElement.querySelector(selector),
        querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
        addEventListener() {},
        removeEventListener() {},
    };
    return document;
}

const sharedDocument = createDocument();
const storage = new Map();
const sharedWindow = {
    document: sharedDocument,
    location: { hash: '#/home' },
    history: {
        length: 1,
        pushState(state, title, hash) { sharedWindow.location.hash = hash; },
        replaceState(state, title, hash) { sharedWindow.location.hash = hash; },
        back() {},
    },
    localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: { userAgent: 'node' },
    /** 探测后端必然失败，测试固定走原生桥接这条路径。 */
    fetch: () => Promise.reject(new Error('测试环境不访问网络')),
    console,
};
sharedWindow.window = sharedWindow;

/** 覆盖一个全局变量；Node 会把 navigator 等定义成 getter，直接赋值会静默失败。 */
function setGlobal(name, value) {
    try {
        global[name] = value;
    } catch (ignored) {
        Object.defineProperty(global, name, {
            value, writable: true, configurable: true, enumerable: true,
        });
    }
}

function installGlobals() {
    // Node 在 globalThis 上预置了 window / navigator / fetch：只写 global.window
    // 不会覆盖模块看到的 globalThis.window，必须用 defineProperty 显式接管。
    setGlobal('window', sharedWindow);
    setGlobal('document', sharedDocument);
    setGlobal('navigator', sharedWindow.navigator);
    setGlobal('location', sharedWindow.location);
    setGlobal('history', sharedWindow.history);
    setGlobal('localStorage', sharedWindow.localStorage);
    setGlobal('requestAnimationFrame', sharedWindow.requestAnimationFrame);
    setGlobal('cancelAnimationFrame', sharedWindow.cancelAnimationFrame);
    setGlobal('getComputedStyle', sharedWindow.getComputedStyle);
    // api.js 的连通性探测要求 window 上也有 fetch；打桩成“不可达”即走原生桥接。
    setGlobal('fetch', sharedWindow.fetch);
    setGlobal('Node', StubNode);
    setGlobal('Element', StubNode);
    setGlobal('CustomEvent', class {});
}

// ── 假的桥接层：覆盖前端会用到的全部动作 ─────────────────────────

const EXHIBITION = {
    id: 'exhibition-1',
    title: '智能制造与工业自动化展',
    venue: '上海新国际博览中心 · N3 馆',
    time: '09:00-17:00',
    date: '2026-06-12',
    dateLabel: '6月12日',
    year: 2026,
    month: 6,
    day: 12,
    category: '智能制造',
    description: '# 展会亮点\n\n- 工业机器人',
    descriptionFormat: 'md',
    status: '需审核',
    mode: 'review',
    modeLabel: '报名中 · 需审核',
    openForRegistration: true,
    exhibitor: '主办方',
    exhibitorNote: '主办方公开信息',
    highlights: ['工业机器人'],
    imageUri: '',
    registrationStart: '2026-05-01',
    registrationEnd: '2026-05-31',
    registrationCount: 2,
    fieldCount: 3,
    qrEnabled: true,
};

const REGISTRATION = {
    id: 'registration-3',
    exhibitionId: 'exhibition-1',
    exhibitionTitle: '智能制造与工业自动化展',
    exhibitionDay: 12,
    exhibitionTime: '09:00-17:00',
    exhibitionVenue: '上海新国际博览中心 · N3 馆',
    visitorName: 'user',
    visitorType: '专业观众',
    answers: '姓名：张三\n参观身份：专业观众',
    status: 'PENDING',
    statusLabel: '已通过',
    qrEnabled: true,
    checkInCode: 'CALMOBILE-CHECKIN|exhibition-1|registration-3',
};

const REVIEW_RECORD = {
    id: 'registration-3',
    exhibitionId: 'exhibition-1',
    visitorName: '张三',
    registrationTime: '06-08 09:15',
    answers: '姓名：张三',
    summary: '姓名：张三',
    status: '待审核',
};

const USER_PUBLIC = {
    found: true,
    nickname: 'user',
    role: '普通用户',
    bio: '关注智能制造',
    region: '上海 · 浦东新区',
    avatar: '',
    socialMedia: '微博',
    showRegistrations: false,
    viewedAsAdmin: true,
    registrations: [REGISTRATION],
};

/** 动作名 → 返回值。缺省返回 `true`，用于只关心“调用成功”的动作。 */
const RESPONSES = {
    bootstrap: {
        user: {
            loggedIn: true,
            guest: false,
            role: 'admin',
            roleLabel: '管理员',
            username: 'demo',
            nickname: 'demo',
            avatar: '',
            bio: '',
            region: '',
            socialMedia: '',
            showRegistrations: false,
            email: 'demo@example.com',
            status: '正常',
            can: { register: true, profile: true, exhibitor: true, admin: true },
        },
        theme: { index: 0, colors: ['#C05621', '#48515D'] },
        ui: { mode: 'light' },
        capabilities: {},
        categories: ['智能制造'],
        review: { canRevise: false, statuses: ['待审核', '已通过', '已拒绝'] },
        media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 },
        announcement: { enabled: false, text: '' },
        brand: { zh: '发现展会', en: 'calMobile' },
        limits: {},
        server: {},
        calendar: { available: false },
    },
    'profile.get': { loggedIn: true, role: 'admin', nickname: 'demo', can: { admin: true, exhibitor: true } },
    'notify.preferences': { exhibitionReminder: true, registrationUpdates: true, granted: true },
    'settings.get': {
        theme: { index: 0, colors: ['#C05621'] },
        ui: { mode: 'light' },
        announcement: { enabled: false, text: '' },
        brand: { zh: '发现展会', en: 'calMobile' },
        categories: ['智能制造'],
        review: { canRevise: false },
        media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 },
        upload: { avatarSizeMb: 2, imageFormats: ['jpg'], videoFormats: ['mp4'] },
        limits: {
            exhibitionTitle: 60, exhibitionVenue: 60, category: 20, fieldTitle: 30,
            usernameMin: 3, usernameMax: 20, passwordMin: 6, passwordMax: 32,
            nickname: 20, bio: 200, region: 40, answer: 200,
        },
    },
    'exhibitions.list': [EXHIBITION],
    'exhibitions.month': {
        year: 2026, month: 6, day: 12, monthLabel: '2026 年 6 月',
        eventDays: [12, 18], exhibitions: [EXHIBITION], selected: [EXHIBITION],
    },
    'exhibitions.get': { found: true, exhibition: EXHIBITION, fields: [{ title: '姓名', type: '文本', required: true, options: [] }] },
    'exhibitions.categories': ['智能制造'],
    'exhibitions.fields': [{ title: '姓名', type: '文本', required: true, options: [] }],
    'registrations.list': [REGISTRATION],
    'registrations.get': { found: true, registration: REGISTRATION },
    'review.list': {
        exhibitionId: 'exhibition-1',
        status: '待审核',
        records: [REVIEW_RECORD],
        counts: { total: 3, 待审核: 1, 已通过: 1, 已拒绝: 0, 已参加: 1 },
    },
    'users.list': [{
        id: 'user-1', nickname: 'user', email: 'user@example.com', status: '正常',
        registrationTime: '2026-06-01', lastLoginTime: '2026-06-10', role: '普通用户',
    }],
    'users.public': USER_PUBLIC,
    'search.query': { query: '', exhibitions: [EXHIBITION], users: [], count: 1 },
    'checkin.scan': {
        ok: true, duplicated: false, status: '已参加', message: '已核销 张三 的报名',
        record: {
            recordId: 'registration-3', visitorName: '张三', exhibitionId: 'exhibition-1',
            exhibitionTitle: '智能制造与工业自动化展', registrationTime: '06-08 09:15', answers: '姓名：张三',
        },
    },
    'camera.ensurePermission': true,
    'calendar.status': { granted: false, inCalendar: false },
    'calendar.toggle': { inCalendar: true, granted: true, message: '已加入系统日历' },
    'settings.uiMode': { ok: true, mode: 'dark' },
    'media.pickImage': { dataUrl: 'data:image/jpeg;base64,AAAA' },
    'notify.requestPermission': true,
};

function installBridge(window, calls) {
    window.CalMobileNative = {
        invoke(action, payloadJson, callbackId) {
            calls.push({ action, payload: JSON.parse(payloadJson || '{}') });
            const value = Object.prototype.hasOwnProperty.call(RESPONSES, action)
                ? RESPONSES[action]
                : true;
            setTimeout(() => {
                window.CalMobileBridge.onResult(callbackId, true, value, null);
            }, 0);
        },
        report() {},
    };
    window.__CALMOBILE_READY__ = true;
}

// ── 测试主体 ─────────────────────────────────────────────────────

/** 每次渲染都重置 DOM 树与假桥接，模块本身保持在同一个实例里。 */
async function renderRoute(routeId, params = {}) {
    installGlobals();
    const dom = resetDom(sharedDocument);
    const calls = [];
    installBridge(sharedWindow, calls);
    sharedWindow.location.hash = '#/home';

    const appUrl = pathToFileURL(path.join(webRoot, 'js', 'app.js')).href;
    await import(appUrl);

    // 必须与 app.js 解析到同一个模块实例，否则拿不到已注册的路由。
    const router = await import(pathToFileURL(path.join(webRoot, 'js', 'core', 'router.js')).href);
    // 首次渲染要等 bootstrap（可能是异步的远端请求）落定，不能自己猜时序。
    await router.whenStarted();

    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    sharedWindow.location.hash = `#/${routeId}${query ? `?${query}` : ''}`;
    await router.render();
    // 让桥接回调（setTimeout 0）与页面里的 await 全部落定。
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { dom, calls, router, app: dom.app };
}

/** 页面必须至少渲染出一个可见节点，并且不能出现“启动失败”占位。 */
function assertRendered(app, label) {
    const text = collectText(app);
    assert.ok(!text.includes('启动失败'), `${label} 渲染失败：${text.slice(0, 200)}`);
    assert.ok(!text.includes('页面加载失败'), `${label} 渲染出错：${text.slice(0, 200)}`);
    assert.ok(app.children.length > 0, `${label} 没有渲染任何内容`);
}

function collectText(node, out = []) {
    if (node.textContent) {
        out.push(node.textContent);
    }
    for (const child of node.children) {
        collectText(child, out);
    }
    return out.join(' ');
}

/** 每个页面都渲染一次，覆盖访客 / 普通用户 / 展商 / 管理员四种身份。 */
const ROUTES = [
    ['login', {}],
    ['home', {}],
    ['detail', { id: 'exhibition-1' }],
    ['registration-form', { id: 'exhibition-1' }],
    ['search', {}],
    ['my-registrations', {}],
    ['registration-detail', { id: 'registration-3' }],
    ['profile', {}],
    ['exhibitor', {}],
    ['exhibition-form', { id: 'exhibition-1' }],
    ['exhibition-form', { mode: 'create' }],
    ['rich-editor', { id: 'exhibition-1' }],
    ['review', { exhibitionId: 'exhibition-1' }],
    ['checkin', {}],
    ['user-public', { userId: 'user-1' }],
    ['admin', { tab: '用户' }],
    ['admin', { tab: '展会' }],
    ['admin', { tab: '设置' }],
];

test('所有页面在管理员身份下都能完成一次渲染', async () => {
    for (const [routeId, params] of ROUTES) {
        const label = `#/${routeId}${Object.keys(params).length ? ` (${JSON.stringify(params)})` : ''}`;
        const { app } = await renderRoute(routeId, params);
        assertRendered(app, label);
    }
});

test('页面渲染时调用的动作都在假桥接里有约定返回值', async () => {
    const unknown = new Set();
    for (const [routeId, params] of ROUTES) {
        const { calls } = await renderRoute(routeId, params);
        for (const { action } of calls) {
            if (!Object.prototype.hasOwnProperty.call(RESPONSES, action)) {
                unknown.add(action);
            }
        }
    }
    assert.deepStrictEqual([...unknown], [],
        `以下动作缺少约定的返回值，说明新增了动作却没有在测试里覆盖：${[...unknown].join(', ')}`);
});

test('管理后台把当前分区写进哈希，返回后仍停在展会分区', async () => {
    const { calls } = await renderRoute('admin', { tab: '展会' });
    const hash = decodeURIComponent(sharedWindow.location.hash);
    assert.ok(hash.includes('tab='), `哈希里没有分区参数：${hash}`);
    assert.ok(hash.includes('展会'), `哈希没有记录展会分区：${hash}`);
    // 展会分区渲染时应当请求展会列表，而不是用户列表。
    assert.ok(calls.some((item) => item.action === 'exhibitions.list'),
        '展会分区没有拉取展会列表');
    assert.ok(!calls.some((item) => item.action === 'users.list'),
        '展会分区不应该去拉用户列表');
});

test('个人页深色模式切换会调用 settings.uiMode', async () => {
    const { dom, calls } = await renderRoute('profile', {});
    const buttons = dom.app.querySelectorAll((node) => node.classList.contains('seg'))
        .flatMap((group) => group.querySelectorAll((node) => node.tagName === 'BUTTON'));
    const dark = buttons.find((button) => collectText(button).includes('深色'));
    assert.ok(dark, '个人页没有渲染出「深色」选项');
    dark.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(calls.some((item) => item.action === 'settings.uiMode'),
        '切换深色模式没有调用 settings.uiMode');
});

test('报名详情展示报名码并调用二维码库', async () => {
    const { dom, app } = await renderRoute('registration-detail', { id: 'registration-3' });
    const text = collectText(app);
    assert.ok(text.includes('报名码'), `报名详情没有报名码卡片：${text.slice(0, 200)}`);
    assert.ok(text.includes('CALMOBILE-CHECKIN|exhibition-1|registration-3'),
        '报名码文本没有渲染出来');
    assert.ok(dom.app.querySelectorAll((node) => node.classList.contains('qr-canvas')).length > 0,
        '没有渲染二维码画布');
});

test('展商后台卡片只有查看报名与编辑展会两个入口', async () => {
    const { app } = await renderRoute('exhibitor', {});
    const text = collectText(app);
    assert.ok(text.includes('查看报名') && text.includes('编辑展会'), '缺少卡片入口');
    for (const removed of ['报名方式', '编辑简介', '删除展会']) {
        assert.ok(!text.includes(removed), `展商卡片上仍然出现「${removed}」`);
    }
});

test('核销页能够用假桥接完成一次扫码核销', async () => {
    const { dom, calls, app } = await renderRoute('checkin', {});
    assert.ok(collectText(app).includes('核销报名码') || collectText(app).includes('扫码核销'),
        '核销页没有渲染出来');
    // 弹层挂在 #overlay-host 下，因此从 document 根节点查找。
    const root = sharedDocument.documentElement;
    // 走到手动输入入口，避免依赖真实摄像头。
    const manual = root.querySelectorAll((node) => node.tagName === 'BUTTON')
        .find((button) => collectText(button).includes('手动输入报名码'));
    assert.ok(manual, '核销页缺少手动输入入口');
    manual.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const input = root.querySelectorAll((node) => node.id === 'checkin-code')[0];
    assert.ok(input, '手动输入面板没有渲染输入框');
    input.value = 'CALMOBILE-CHECKIN|exhibition-1|registration-3';
    const confirm = root.querySelectorAll((node) => node.tagName === 'BUTTON')
        .find((button) => collectText(button).trim() === '核销');
    assert.ok(confirm, '手动输入面板缺少核销按钮');
    confirm.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 40));
    const submitted = calls.find((item) => item.action === 'checkin.scan');
    assert.ok(submitted, '没有调用 checkin.scan');
    assert.strictEqual(submitted.payload.code, 'CALMOBILE-CHECKIN|exhibition-1|registration-3');
    assert.ok(collectText(dom.app).includes('核销成功'), '核销结果没有渲染出来');
});

test('用户公开页在管理视角下展示已参加展会', async () => {
    const { app } = await renderRoute('user-public', { userId: 'user-1' });
    const text = collectText(app);
    assert.ok(text.includes('管理视角'), '没有标注管理视角');
    assert.ok(text.includes('智能制造与工业自动化展'), '管理视角没有展示已参加展会');
});

/**
 * 内置二维码库的往返验证。
 *
 * 报名码由 qrcode-generator 画到 canvas，展商用 jsQR 扫描，两者必须能对上。
 * 这里用 registration-detail.js 里同样的模块绘制算法生成位图，再交给 jsQR 解码，
 * 保证“生成的码一定是能被本应用扫出来的”。
 */
test('报名码用内置库绘制后能被 jsQR 解出原文', async () => {
    installGlobals();
    const { createRequire } = await import('node:module');
    const requireFromHere = createRequire(__filename);
    const vendor = path.join(webRoot, 'vendor');
    const qrcode = requireFromHere(path.join(vendor, 'qrcode-generator', 'qrcode.js'));
    const jsQR = requireFromHere(path.join(vendor, 'jsqr', 'jsQR.js'));
    assert.strictEqual(typeof qrcode, 'function', 'qrcode-generator 未按 UMD 导出可调用函数');
    assert.strictEqual(typeof jsQR, 'function', 'jsQR 未按 UMD 导出可调用函数');

    const text = 'CALMOBILE-CHECKIN|exhibition-1|registration-3';
    const size = 480;
    const model = qrcode(0, 'M');
    model.addData(text);
    model.make();
    const modules = model.getModuleCount();
    const quiet = 4;
    const cell = size / (modules + quiet * 2);
    const pixels = Buffer.alloc(size * size * 4, 0xff);
    for (let row = 0; row < modules; row += 1) {
        for (let column = 0; column < modules; column += 1) {
            if (!model.isDark(row, column)) {
                continue;
            }
            const x0 = Math.round((column + quiet) * cell);
            const y0 = Math.round((row + quiet) * cell);
            const box = Math.ceil(cell);
            for (let y = y0; y < y0 + box && y < size; y += 1) {
                for (let x = x0; x < x0 + box && x < size; x += 1) {
                    const offset = ((y * size) + x) * 4;
                    pixels[offset] = 0x20;
                    pixels[offset + 1] = 0x25;
                    pixels[offset + 2] = 0x2b;
                    pixels[offset + 3] = 0xff;
                }
            }
        }
    }
    const decoded = jsQR(new Uint8ClampedArray(pixels), size, size);
    assert.ok(decoded, 'jsQR 没有识别出绘制好的二维码');
    assert.strictEqual(decoded.data, text, '解码结果与报名码不一致');
});
