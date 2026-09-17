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
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'app', 'src', 'main', 'assets', 'web');

// ── 内置库的打桩 ─────────────────────────────────────────────────
// 打桩环境不执行 <script>，因此按路径把真实的内置库挂到 window 上，
// 让 core/vendor.js 的按需加载在测试里也能成功。

const { createRequire } = require('node:module');
const requireFromHere = createRequire(__filename);

/** 脚本路径 → 该脚本注册的全局名。 */
const VENDOR_GLOBALS = {
    'vendor/qrcode-generator/qrcode.js': 'qrcode',
    'vendor/jsqr/jsQR.js': 'jsQR',
    'vendor/easymde/easymde.min.js': 'EasyMDE',
};

/** 全局名 → 真实实现（只加载能安全在 Node 里 require 的两个二维码库）。 */
const VENDOR_EXPORTS = {
    qrcode: requireFromHere(path.join(webRoot, 'vendor', 'qrcode-generator', 'qrcode.js')),
    jsQR: requireFromHere(path.join(webRoot, 'vendor', 'jsqr', 'jsQR.js')),
    EasyMDE: function EasyMDEFake() {},
};

/**
 * 前端文案：真实实现由原生从 res/values/strings_frontend.xml 注入，
 * 测试直接读同一份资源文件，保证断言用的是真实文案而不是 key。
 */
const frontendStrings = (() => {
    const file = path.join(root, 'app', 'src', 'main', 'res', 'values', 'strings_frontend.xml');
    const xml = fs.readFileSync(file, 'utf8');
    const map = {};
    for (const match of xml.matchAll(/<string name="(s_[a-z0-9]+)">([\s\S]*?)<\/string>/g)) {
        map[match[1]] = match[2]
            .replace(/\\'/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }
    return map;
})();

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
        // 打桩环境不会真的执行 <script>：按 src 把内置库挂到 window 上再触发 onload，
        // 这样按需加载（core/vendor.js）在测试里也能走完整流程。
        if (child.tagName === 'SCRIPT' && child.src) {
            const name = VENDOR_GLOBALS[child.src];
            if (name) {
                sharedWindow[name] = VENDOR_EXPORTS[name];
                setTimeout(() => child.onload?.(), 0);
            } else {
                setTimeout(() => child.onerror?.(new Error(`未打桩的脚本：${child.src}`)), 0);
            }
        }
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
    /** core/preload.js 用空闲回调排队预加载；打桩成立即执行，测试不必等真实空闲。 */
    requestIdleCallback: (callback) => setTimeout(callback, 0),
    cancelIdleCallback() {},
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
    setGlobal('requestIdleCallback', sharedWindow.requestIdleCallback);
    setGlobal('cancelIdleCallback', sharedWindow.cancelIdleCallback);
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
    // 原生会注入文案；测试用同一份资源文件，断言才能用真实文案。
    sharedWindow.CalMobileStrings = frontendStrings;
    sharedWindow.location.hash = '#/home';

    const appUrl = pathToFileURL(path.join(webRoot, 'js', 'app.js')).href;
    await import(appUrl);

    // 必须与 app.js 解析到同一个模块实例，否则拿不到已注册的路由。
    const router = await import(pathToFileURL(path.join(webRoot, 'js', 'core', 'router.js')).href);
    // 每次渲染当作一次全新的会话：清掉 api.js 的只读缓存，
    // 否则上一个用例取过的数据会命中缓存，看不到新的请求。
    const apiModule = await import(pathToFileURL(path.join(webRoot, 'js', 'core', 'api.js')).href);
    apiModule.clearCache();
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
    const { dom } = await renderRoute('admin', { tab: '展会' });
    const hash = decodeURIComponent(sharedWindow.location.hash);
    assert.ok(hash.includes('tab='), `哈希里没有分区参数：${hash}`);
    assert.ok(hash.includes('展会'), `哈希没有记录展会分区：${hash}`);
    // 断言渲染出来的分区内容，而不是「请求了哪个接口」：预加载会让接口调用次数不可预期。
    assert.ok(dom.app.querySelector('#admin-exhibition-search'), '展会分区没有渲染展会搜索框');
    assert.ok(!dom.app.querySelector('#admin-user-search'), '展会分区不应该渲染用户搜索框');
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

test('个人页提供「在公开页展示我的报名记录」开关并能保存', async () => {
    const { dom, calls } = await renderRoute('profile', {});
    const root = sharedDocument.documentElement;
    const label = root.querySelectorAll((node) => node.tagName === 'LABEL')
        .find((node) => collectText(node.parentNode).includes('在公开页展示我的报名记录'));
    assert.ok(label, '个人页没有渲染出隐私设置开关');

    const input = label.querySelectorAll((node) => node.tagName === 'INPUT')[0];
    assert.ok(input, '隐私开关缺少 checkbox');
    assert.strictEqual(input.checked, false, '默认应当是不公开');

    // 打开开关后必须真的提交给后端（此前只透传恒为 false 的值，等于没有入口）
    input.checked = true;
    input.dispatch('change', { target: input });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const saved = calls.filter((item) => item.action === 'profile.save').pop();
    assert.ok(saved, '切换隐私开关没有调用 profile.save');
    assert.strictEqual(saved.payload.showRegistrations, true,
        '隐私开关没有把 true 提交给后端');
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

// ── 取数体验：先画缓存、预加载、日历本地选中 ─────────────────────

/** 取前端模块（与页面解析到同一实例，因此能拿到同一份缓存）。 */
function webModule(relative) {
    return import(pathToFileURL(path.join(webRoot, relative)).href);
}

function countAction(calls, action) {
    return calls.filter((call) => call.action === action).length;
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 首页日历一次返回整月数据，因此「选中哪一天」必须完全在本地完成：
 * 点日期只改选中态与下面的列表，不能再发一次月数据请求。
 * 以前每点一天都重新请求整月、把日历换成骨架屏，那一下空档就是卡片闪白的来源。
 */
test('首页点日期不再请求月数据，列表按当月数据本地切换', async () => {
    const { dom, calls } = await renderRoute('home', {});
    // 先等预加载把相邻月份取回来，之后的计数才不会被后台预热打乱。
    await settle(150);
    const before = countAction(calls, 'exhibitions.month');
    const days = dom.app.querySelectorAll((node) => node.classList.contains('cal-day') && !node.disabled);
    const day12 = days.find((node) => node.dataset.day === '12');
    const day18 = days.find((node) => node.dataset.day === '18');
    assert.ok(day12 && day18, `没有渲染出 12 / 18 日的按钮：${days.map((n) => n.dataset.day).join(',')}`);

    day18.dispatch('click');
    await settle();
    assert.strictEqual(countAction(calls, 'exhibitions.month'), before, '点日期不应该再请求月数据');
    assert.strictEqual(day18.getAttribute('aria-pressed'), 'true', '被点的日期应当变成选中态');
    assert.strictEqual(day12.getAttribute('aria-pressed'), 'false', '原选中日期应当取消选中');
    assert.ok(!collectText(dom.app).includes(EXHIBITION.title), '18 日没有展会，列表应当换成空态');

    day12.dispatch('click');
    await settle();
    assert.strictEqual(countAction(calls, 'exhibitions.month'), before, '切回已有展会的日期同样不发请求');
    assert.ok(collectText(dom.app).includes(EXHIBITION.title), '12 日的展会应当回到列表里');
});

/** 相邻月份由预加载提前取回，切月份因此当场换页而不是先闪骨架屏。 */
test('日历切月份命中预加载缓存时不再发请求', async () => {
    const { dom, calls } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    // 启动后的预加载排在空闲回调里，等它把相邻月份取回来。
    await settle(150);
    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 5 }), '上个月没有预热');
    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 7 }), '下个月没有预热');

    const before = countAction(calls, 'exhibitions.month');
    const next = dom.app.querySelectorAll((node) =>
        node.getAttribute('aria-label') === frontendStrings.s_y6u3g && node.classList.contains('icon-button'))[0];
    assert.ok(next, '没有找到「下个月」按钮');
    next.dispatch('click');
    // shiftMonth 先播 140ms 的滑出动画，再载入目标月份。
    await settle(220);
    assert.strictEqual(countAction(calls, 'exhibitions.month'), before,
        '目标月份已在缓存里，切月份不应该再发请求');
});

/** 命中缓存时 loadInto 必须在 await 之前就把内容画出来，否则仍会先闪一帧骨架屏。 */
test('loadInto 命中缓存时同步出内容，且不清空容器里已有的内容', async () => {
    await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    const { loadInto } = await webModule('js/core/loadable.js');
    const { el: makeEl, append } = await webModule('js/core/dom.js');

    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 6 }),
        '前置条件：首页渲染后 2026 年 6 月应当在缓存里');

    const host = new StubNode('div');
    append(host, makeEl('span', { text: '刷新前的内容' }));
    let painted = 0;
    const pending = loadInto(host, {
        read: api.exhibitions.month,
        params: { year: 2026, month: 6 },
        render: () => { painted += 1; },
    });
    assert.strictEqual(painted, 1, '命中缓存时应当在第一个 await 之前就渲染一次');
    assert.ok(collectText(host).includes('刷新前的内容'), '容器里已有的内容不能被清空');
    await pending;
    assert.strictEqual(painted, 1, '取回来的数据与缓存一致时不应该再重绘一次');
});

/** 过期数据仍然可以被 peek 到：页面先画旧的一屏，再让取数去刷新。 */
test('只读缓存过期后仍能 peek，取数会重新请求', async () => {
    const { calls } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    // 等预加载排空后再清一次缓存，计数从真正的空缓存开始。
    await settle(150);
    api.clearCache();
    const before = countAction(calls, 'exhibitions.list');

    await api.exhibitions.list();
    assert.strictEqual(countAction(calls, 'exhibitions.list'), before + 1, '首次取数应当请求一次');
    await api.exhibitions.list();
    assert.strictEqual(countAction(calls, 'exhibitions.list'), before + 1, '缓存新鲜时不应重复请求');

    const realNow = Date.now;
    Date.now = () => realNow() + 60000;
    try {
        assert.ok(api.exhibitions.list.peek(), '过期的数据也要能被 peek 到（页面靠它先画一屏）');
        await api.exhibitions.list();
        assert.strictEqual(countAction(calls, 'exhibitions.list'), before + 2, '过期后应当重新取数');
    } finally {
        Date.now = realNow;
    }
});

/** 同一份数据的并发请求只发一次：预加载与页面取数经常撞在一起。 */
test('同一份只读数据的并发请求会去重', async () => {
    const { calls } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    await settle(150);
    api.clearCache();
    const before = countAction(calls, 'registrations.list');

    const [first, second] = await Promise.all([api.registrations.list(), api.registrations.list()]);
    assert.strictEqual(countAction(calls, 'registrations.list'), before + 1, '并发请求只应该发一次');
    assert.strictEqual(first, second, '并发请求应当复用同一个结果对象');
});

/** 启动后预热底部导航各页，切标签时数据已经在缓存里。 */
test('启动后会预加载其它标签页的数据', async () => {
    await renderRoute('home', {});
    // 预加载排在空闲回调里，等它把标签页数据取回来。
    await settle(150);
    const api = await webModule('js/core/api.js');
    // 只访问了首页，但底部导航能直达的页面数据都应当在缓存里。
    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 6 }), '首页月份没有预热');
    assert.ok(api.registrations.list.peek(), '「我的报名」没有预热');
    assert.ok(api.profile.get.peek(), '个人页没有预热');
    assert.ok(api.exhibitions.list.peek(), '展商后台没有预热');
});
