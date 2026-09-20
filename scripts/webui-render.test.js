/**
 * 前端页面渲染冒烟测试。
 *
 * `webui-check` 只能校验模块能否解析；本脚本补上“真正渲染一遍”的验证：
 * 用最小 DOM 打桩 + 假后端（打桩 `fetch`）+ 只保留系统能力的假桥接，
 * 按角色把每个页面渲染一次，捕获未定义变量、错误的桥接参数、缺失的动作名
 * 这类只在运行时才暴露的问题。
 *
 * 数据只有**一条**路径：`js/core/api.js` 的 `ENDPOINTS` → `server/` 的 REST 接口。
 * 因此这里的 `fetch` 扮演后端（按「方法 + 路径」返回夹具），假桥接只实现
 * `ui.sync` 等 10 个系统动作；页面一旦把数据动作交给原生，桥接会当场报错。
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
    /** 每次渲染都会换成「假后端」，见 createBackend()。 */
    fetch: () => Promise.reject(new Error('测试还没有装假后端')),
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
    // api.js 走 HTTP 取数：把假后端挂到 window 上，模块读到的是同一个函数。
    setGlobal('fetch', sharedWindow.fetch);
    setGlobal('Node', StubNode);
    setGlobal('Element', StubNode);
    setGlobal('CustomEvent', class {});
}

// ── 夹具数据：与后端返回的字段一致 ───────────────────────────────

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

const FIELDS = [{ title: '姓名', type: '文本', required: true, options: [] }];

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

const USER_ROW = {
    id: 'user-1', nickname: 'user', email: 'user@example.com', status: '正常',
    registrationTime: '2026-06-01', lastLoginTime: '2026-06-10', role: '普通用户',
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

const BOOTSTRAP = {
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
};

const PROFILE = {
    loggedIn: true, role: 'admin', nickname: 'demo', can: { admin: true, exhibitor: true },
};

const SETTINGS = {
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
};

const MONTH = {
    year: 2026, month: 6, day: 12, monthLabel: '2026 年 6 月',
    eventDays: [12, 18], exhibitions: [EXHIBITION], selected: [EXHIBITION],
};

const REVIEW = {
    exhibitionId: 'exhibition-1',
    status: '待审核',
    records: [REVIEW_RECORD],
    counts: { total: 3, 待审核: 1, 已通过: 1, 已拒绝: 0, 已参加: 1 },
};

const CHECKIN = {
    ok: true, duplicated: false, status: '已参加', message: '已核销 张三 的报名',
    record: {
        recordId: 'registration-3', visitorName: '张三', exhibitionId: 'exhibition-1',
        exhibitionTitle: '智能制造与工业自动化展', registrationTime: '06-08 09:15', answers: '姓名：张三',
    },
};

/** 只读接口：`GET /exhibitions/month` 只对夹具里的那个月有展会，其余月份返回空月。 */
function monthFixture({ query }) {
    const year = Number(query.year) || MONTH.year;
    const month = Number(query.month) || MONTH.month;
    if (year !== MONTH.year || month !== MONTH.month) {
        return {
            year, month, day: 1, monthLabel: `${year} 年 ${month} 月`,
            eventDays: [], exhibitions: [], selected: [],
        };
    }
    return { ...MONTH, day: Number(query.day) || MONTH.day };
}

/**
 * 假后端。
 *
 * 键是「方法 + 路径」，路径与 `server/README.md` 的接口清单一致（去掉 `/api/v1`）。
 * 响应遵循 server/README.md 的约定：
 * - 读取 → 200 + 数据本身（数组或对象）；
 * - 写入 → 200 + `{ ok:true, error:'', ... }`；
 * - 业务失败 → 200 + `{ ok:false, error }`（夹具里没有需要故意失败的用例）；
 * - 401 → `{ error }`（只有第 17 个用例自己造 401，见文末）。
 */
const BACKEND = {
    // 启动与认证
    'GET /bootstrap': BOOTSTRAP,
    'POST /auth/login': { ok: true, error: '', token: 'token-1', refreshToken: 'refresh-token-1' },
    'POST /auth/register': { ok: true, error: '', token: 'token-2', refreshToken: 'refresh-token-2' },
    'POST /auth/guest': { ok: true, error: '' },
    'POST /auth/logout': { ok: true, error: '' },

    // 资料与偏好
    'GET /profile': PROFILE,
    'PUT /profile': { ok: true, error: '' },
    'POST /profile/password': { ok: true, error: '' },
    'GET /profile/notifications': { exhibitionReminder: true, registrationUpdates: true, granted: true },
    'PUT /profile/notifications': { ok: true, error: '' },

    // 展会
    'GET /exhibitions': [EXHIBITION],
    'GET /exhibitions/month': monthFixture,
    'GET /exhibitions/categories': ['智能制造'],
    'GET /exhibitions/:id': { found: true, exhibition: EXHIBITION, fields: FIELDS },
    'GET /exhibitions/:id/fields': FIELDS,
    'POST /exhibitions': { ok: true, error: '', id: 'exhibition-1' },
    'PUT /exhibitions/:id': { ok: true, error: '' },
    'DELETE /exhibitions/:id': { ok: true, error: '' },
    'PUT /exhibitions/:id/status': { ok: true, error: '' },
    'PUT /exhibitions/:id/fields': { ok: true, error: '' },

    // 报名、审核与核销
    'GET /registrations': [REGISTRATION],
    'GET /registrations/:id': { found: true, registration: REGISTRATION },
    'POST /registrations': { ok: true, error: '', status: 'PENDING' },
    'DELETE /registrations/:id': { ok: true, error: '' },
    'GET /review': REVIEW,
    'GET /review/:id': REVIEW_RECORD,
    'PUT /review/:id/status': { ok: true, error: '' },
    'POST /checkin': CHECKIN,

    // 用户、搜索与设置
    'GET /users': [USER_ROW],
    'GET /users/public': USER_PUBLIC,
    'GET /users/:id': USER_ROW,
    'PUT /users/:id/status': { ok: true, error: '' },
    'GET /search': ({ query }) => ({
        query: query.query || '', exhibitions: [EXHIBITION], users: [], count: 1,
    }),
    'GET /settings': SETTINGS,
    'PUT /settings': { ok: true, error: '' },
    'PUT /settings/ui-mode': { ok: true, mode: 'dark' },
};

const API_PREFIX = '/api/v1';

function splitPath(value) {
    return String(value).split('/').filter(Boolean);
}

/** 按「方法 + 路径」找夹具；先精确匹配，再退回到 `:参数` 模板。 */
function matchEndpoint(method, path) {
    const parts = splitPath(path);
    const candidates = Object.entries(BACKEND)
        .map(([key, fixture]) => {
            const [entryMethod, ...rest] = key.split(' ');
            return { method: entryMethod, pattern: rest.join(' '), fixture };
        })
        .filter((entry) => entry.method === method);

    // 两轮匹配：`/users/public` 不能被 `/users/:id` 抢走。
    for (const pass of ['exact', 'pattern']) {
        for (const entry of candidates) {
            const pattern = splitPath(entry.pattern);
            if (pattern.length !== parts.length) {
                continue;
            }
            const params = {};
            let matched = true;
            for (let index = 0; index < pattern.length; index += 1) {
                if (pattern[index].startsWith(':')) {
                    if (pass === 'exact') {
                        matched = false;
                        break;
                    }
                    params[pattern[index].slice(1)] = decodeURIComponent(parts[index]);
                } else if (pattern[index] !== parts[index]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return { fixture: entry.fixture, params };
            }
        }
    }
    return null;
}

function reply(status, body) {
    return { ok: status < 400, status, json: async () => body };
}

/**
 * 假后端：把每次请求录进 `requests`，按夹具应答。
 * 没有夹具的路径会被记进 `unmatched` 并返回 404，用例会断言它是空的
 * ——那说明 `api.js` 新增了接口而测试夹具没跟上。
 */
function createBackend() {
    const requests = [];
    const unmatched = [];
    const fetchStub = async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        const target = new URL(String(url));
        const path = target.pathname.startsWith(API_PREFIX)
            ? target.pathname.slice(API_PREFIX.length)
            : target.pathname;
        const request = {
            method,
            path,
            url: String(url),
            query: Object.fromEntries(target.searchParams.entries()),
            body: options.body ? JSON.parse(options.body) : null,
            authorized: Boolean(options.headers && options.headers.Authorization),
        };
        requests.push(request);
        const match = matchEndpoint(method, path);
        if (!match) {
            unmatched.push(`${method} ${path}`);
            return reply(404, { error: `测试夹具没有覆盖 ${method} ${path}` });
        }
        const value = typeof match.fixture === 'function'
            ? match.fixture({ query: request.query, body: request.body, params: match.params })
            : match.fixture;
        return reply(200, value);
    };
    return { fetchStub, requests, unmatched };
}

// ── 假的桥接层：只实现保留下来的系统动作 ─────────────────────────

/**
 * 原生侧保留的动作 → 返回值。
 *
 * 这份清单就是 `WebAppActions` 的全部 `case`（见 README「前后端边界」）。
 * 数据动作已经删除：任何不在清单里的动作都会被 {@link installBridge} 当场拒绝，
 * 因为那意味着页面绕过了 `core/api.js`。
 */
const SYSTEM_RESPONSES = {
    'ui.sync': true,
    'camera.ensurePermission': true,
    'calendar.status': { granted: false, inCalendar: false },
    'calendar.toggle': { inCalendar: true, granted: true, message: '已加入系统日历' },
    'notify.requestPermission': true,
    'media.pickImage': { dataUrl: 'data:image/jpeg;base64,AAAA' },
    'media.import': true,
    'media.store': true,
    'share.text': true,
    'export.csv': true,
};

const SYSTEM_ACTION_NAMES = Object.keys(SYSTEM_RESPONSES);

function installBridge(window, calls) {
    window.CalMobileNative = {
        invoke(action, payloadJson, callbackId) {
            calls.push({ action, payload: JSON.parse(payloadJson || '{}') });
            if (!Object.prototype.hasOwnProperty.call(SYSTEM_RESPONSES, action)) {
                // 数据动作不再经过原生：这里必须炸，而不是悄悄返回一份本机数据。
                throw new Error(`动作 ${action} 不在系统能力白名单里，数据必须走 core/api.js`);
            }
            const value = SYSTEM_RESPONSES[action];
            setTimeout(() => {
                window.CalMobileBridge.onResult(callbackId, true, value, null);
            }, 0);
        },
        report() {},
    };
    window.__CALMOBILE_READY__ = true;
}

// ── 测试主体 ─────────────────────────────────────────────────────

/** 每次渲染都重置 DOM 树、假后端与假桥接，模块本身保持在同一个实例里。 */
async function renderRoute(routeId, params = {}) {
    const backend = createBackend();
    sharedWindow.fetch = backend.fetchStub;
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
    // 首次渲染要等 bootstrap（走 HTTP 夹具）落定，不能自己猜时序。
    await router.whenStarted();

    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    sharedWindow.location.hash = `#/${routeId}${query ? `?${query}` : ''}`;
    await router.render();
    // 让桥接回调（setTimeout 0）与页面里的 await 全部落定。
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
        dom,
        calls,
        requests: backend.requests,
        unmatched: backend.unmatched,
        router,
        app: dom.app,
    };
}

/**
 * 页面必须真的画出内容，并且不能出现“启动失败”占位。
 *
 * `app.children.length > 0` 曾是这里的断言，但它恒真：`renderShell` 无论如何都会
 * 挂上 topbar 与 main，哪怕页面模块一行都没画。因此改为断言**页面主体里**有内容
 * ——那才是「渲染过一次」的证据。
 */
function assertRendered(app, label) {
    const text = collectText(app);
    assert.ok(!text.includes('启动失败'), `${label} 渲染失败：${text.slice(0, 200)}`);
    assert.ok(!text.includes('页面加载失败'), `${label} 渲染出错：${text.slice(0, 200)}`);
    const main = app.querySelector('main');
    assert.ok(main, `${label} 没有渲染出页面主体（main）`);
    assert.ok(main.children.length > 0, `${label} 的页面主体是空的`);
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
    ['register', {}],
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
        const { app, unmatched } = await renderRoute(routeId, params);
        assertRendered(app, label);
        assert.deepStrictEqual(unmatched, [],
            `${label} 请求了假后端没有覆盖的接口：${unmatched.join(', ')}`);
    }
});

/**
 * `assertRendered` 自己不能是恒真的。
 *
 * 它原来断言 `app.children.length > 0`，而 `renderShell` 无论如何都会挂上 topbar
 * 与 main，所以「页面模块一行都没画」也照样通过——上面那条用例因此少了半条命。
 * 这里用一个只有外壳、主体为空的 app 把这一点钉住：旧式断言会通过，新断言必须报错。
 */
test('assertRendered 能认出「只有外壳、主体是空的」页面', async () => {
    installGlobals();
    const components = await webModule('js/ui/components.js');
    const dom = resetDom(sharedDocument);
    // renderShell 只挂外壳：topbar + 空的 main，页面内容一行都没有。
    components.renderShell(dom.app, { topbar: null, body: [] });

    assert.ok(dom.app.children.length > 0,
        '前置条件：光有外壳就已经有节点了（这正是旧断言恒真的原因）');
    assert.throws(() => assertRendered(dom.app, '空壳页面'), /页面主体是空的/);
});

test('页面渲染时调用的桥接动作都在系统能力清单里', async () => {
    const unknown = new Set();
    for (const [routeId, params] of ROUTES) {
        const { calls } = await renderRoute(routeId, params);
        for (const { action } of calls) {
            if (!SYSTEM_ACTION_NAMES.includes(action)) {
                unknown.add(action);
            }
        }
    }
    assert.deepStrictEqual([...unknown], [],
        `以下动作不是系统能力，说明有页面绕过了 core/api.js：${[...unknown].join(', ')}`);
});

/**
 * 数据只有一条路径：`core/api.js` 的 `ENDPOINTS` → 后端 HTTP。
 * 原生数据层删除后，桥接只剩系统能力；这条用例同时守住两个方向。
 */
test('数据动作不再经过原生桥接', async () => {
    const { calls, requests, unmatched } = await renderRoute('home', {});
    // 等预加载把相邻月份取回来，否则只能看到首屏那几次请求。
    await settle(150);

    for (const { action } of calls) {
        assert.ok(SYSTEM_ACTION_NAMES.includes(action),
            `首页把动作 ${action} 交给了原生桥接，数据必须走 core/api.js`);
    }
    const paths = requests.map((item) => item.path);
    // bootstrap 只在 app.js 第一次 import 时发一次，因此这里断言首页自己的数据接口。
    for (const expected of ['/exhibitions/month', '/exhibitions']) {
        assert.ok(paths.includes(expected),
            `首页没有请求 ${expected}，实际请求：${paths.join(', ')}`);
    }
    assert.ok(requests.every((item) => item.url.startsWith(`http://127.0.0.1:3000${API_PREFIX}/`)),
        `请求没有走 /api/v1 前缀：${requests.map((item) => item.url).join(', ')}`);
    assert.deepStrictEqual(unmatched, [], `假后端没有覆盖：${unmatched.join(', ')}`);
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
    const { dom, requests } = await renderRoute('profile', {});
    const buttons = dom.app.querySelectorAll((node) => node.classList.contains('seg'))
        .flatMap((group) => group.querySelectorAll((node) => node.tagName === 'BUTTON'));
    const dark = buttons.find((button) => collectText(button).includes('深色'));
    assert.ok(dark, '个人页没有渲染出「深色」选项');
    dark.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const saved = requests.find((item) => item.method === 'PUT' && item.path === '/settings/ui-mode');
    assert.ok(saved, '切换深色模式没有请求 PUT /settings/ui-mode');
    assert.strictEqual(saved.body.mode, 'dark', '外观模式没有提交给后端');
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

test('核销页能够用假后端完成一次扫码核销', async () => {
    const { dom, requests, app } = await renderRoute('checkin', {});
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
    const submitted = requests.find((item) => item.method === 'POST' && item.path === '/checkin');
    assert.ok(submitted, '没有请求 POST /checkin');
    assert.strictEqual(submitted.body.code, 'CALMOBILE-CHECKIN|exhibition-1|registration-3');
    assert.ok(collectText(dom.app).includes('核销成功'), '核销结果没有渲染出来');
});

test('个人页提供「在公开页展示我的报名记录」开关并能保存', async () => {
    const { dom, requests } = await renderRoute('profile', {});
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

    const saved = requests.filter((item) => item.method === 'PUT' && item.path === '/profile').pop();
    assert.ok(saved, '切换隐私开关没有请求 PUT /profile');
    assert.strictEqual(saved.body.showRegistrations, true,
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

/**
 * 注册页要能真的把账号提交给后端。
 *
 * 这是 `POST /auth/register` 夹具唯一的用武之地：只把 register 加进 ROUTES 渲染
 * 一次，表单的提交路径（校验 → 请求 → 保存返回的令牌）一行都没被跑到。
 */
test('注册页提交后请求 POST /auth/register 并保存返回的令牌', async () => {
    const { dom, requests } = await renderRoute('register', {});
    const api = await webModule('js/core/api.js');
    api.setRefreshToken('');

    const control = (id) => dom.app.querySelectorAll((node) => node.id === id)[0];
    const username = control('register-username');
    const email = control('register-email');
    const password = control('register-password');
    const confirm = control('register-confirm');
    assert.ok(username && email && password && confirm, '注册页没有渲染出四个输入框');

    username.value = 'newuser';
    email.value = 'newuser@example.com';
    password.value = 'secret123';
    confirm.value = 'secret123';

    const form = dom.app.querySelectorAll((node) => node.tagName === 'FORM')[0];
    assert.ok(form, '注册页没有渲染表单');
    form.dispatch('submit', { preventDefault() {} });
    await settle(60);

    const submitted = requests.find((item) => item.method === 'POST' && item.path === '/auth/register');
    assert.ok(submitted, `注册页没有请求 POST /auth/register，实际请求：${requests
        .map((item) => `${item.method} ${item.path}`).join(', ')}`);
    assert.deepStrictEqual(submitted.body, {
        username: 'newuser',
        email: 'newuser@example.com',
        password: 'secret123',
        confirmPassword: 'secret123',
    }, '注册请求体与表单内容不一致');
    assert.strictEqual(api.hasRefreshToken(), true, '后端返回的刷新令牌没有保存下来');
});

// ── 取数体验：先画缓存、预加载、日历本地选中 ─────────────────────

/** 取前端模块（与页面解析到同一实例，因此能拿到同一份缓存）。 */
function webModule(relative) {
    return import(pathToFileURL(path.join(webRoot, relative)).href);
}

/** 记下来的请求里，某个「方法 + 路径」被请求了几次。 */
function countRequest(requests, method, endpoint) {
    return requests.filter((item) => item.method === method && item.path === endpoint).length;
}

/**
 * 记下来的请求里，某个月的月视图被请求了几次。
 *
 * 预加载会取相邻月份、切月份后还会预热新的相邻月份，因此只按「整月接口的次数」
 * 断言会随空闲回调的时序抖动；这里锁定具体月份。
 */
function countMonth(requests, month) {
    return requests.filter((item) => item.path === '/exhibitions/month'
        && Number(item.query.month) === month).length;
}

/** 轮询等待条件成立：预加载排在空闲回调里，落点时序不固定。 */
async function waitFor(predicate, timeout = 1000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        if (predicate()) {
            return true;
        }
        if (Date.now() >= deadline) {
            return false;
        }
        await settle(20);
    }
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 首页日历一次返回整月数据，因此「选中哪一天」必须完全在本地完成：
 * 点日期只改选中态与下面的列表，不能再发一次月数据请求。
 * 以前每点一天都重新请求整月、把日历换成骨架屏，那一下空档就是卡片闪白的来源。
 */
test('首页点日期不再请求月数据，列表按当月数据本地切换', async () => {
    const { dom, requests } = await renderRoute('home', {});
    // 先等预加载把相邻月份取回来，之后的计数才不会被后台预热打乱。
    await settle(150);
    const before = countMonth(requests, 6);
    const days = dom.app.querySelectorAll((node) => node.classList.contains('cal-day') && !node.disabled);
    const day12 = days.find((node) => node.dataset.day === '12');
    const day18 = days.find((node) => node.dataset.day === '18');
    assert.ok(day12 && day18, `没有渲染出 12 / 18 日的按钮：${days.map((n) => n.dataset.day).join(',')}`);

    day18.dispatch('click');
    await settle();
    assert.strictEqual(countMonth(requests, 6), before, '点日期不应该再请求月数据');
    assert.strictEqual(day18.getAttribute('aria-pressed'), 'true', '被点的日期应当变成选中态');
    assert.strictEqual(day12.getAttribute('aria-pressed'), 'false', '原选中日期应当取消选中');
    assert.ok(!collectText(dom.app).includes(EXHIBITION.title), '18 日没有展会，列表应当换成空态');

    day12.dispatch('click');
    await settle();
    assert.strictEqual(countMonth(requests, 6), before, '切回已有展会的日期同样不发请求');
    assert.ok(collectText(dom.app).includes(EXHIBITION.title), '12 日的展会应当回到列表里');
});

/** 相邻月份由预加载提前取回，切月份因此当场换页而不是先闪骨架屏。 */
test('日历切月份命中预加载缓存时不再发请求', async () => {
    const { dom, requests } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    // 启动后的预加载排在空闲回调里，等它把相邻月份取回来。
    await settle(150);
    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 5 }), '上个月没有预热');
    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 7 }), '下个月没有预热');
    const before = countMonth(requests, 7);

    const next = dom.app.querySelectorAll((node) =>
        node.getAttribute('aria-label') === frontendStrings.s_y6u3g && node.classList.contains('icon-button'))[0];
    assert.ok(next, '没有找到「下个月」按钮');
    next.dispatch('click');
    // shiftMonth 先播 140ms 的滑出动画，再载入目标月份。
    await settle(220);
    assert.strictEqual(countMonth(requests, 7), before,
        '目标月份（7 月）已在缓存里，切月份不应该再请求它');
    // 表头由用户操作时的参数决定：切到 7 月后不能还写着 6 月。
    const title = dom.app.querySelectorAll((node) => node.tagName === 'STRONG'
        && /^\d{4} 年 \d{1,2} 月$/.test(String(node.textContent)))[0];
    assert.ok(title, '日历卡片上没有找到月份标题');
    assert.strictEqual(title.textContent, '2026 年 7 月', '切月份后日历表头没有跟着走');
    // 换到 7 月后会照常预热新的相邻月份（8 月）：这是预加载的既定行为。
    assert.ok(await waitFor(() => countMonth(requests, 8) > 0),
        '切到 7 月后没有预热 8 月，说明 preloadFollowUps 没有跟上');
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

/** 受控的月视图响应：只声明「这是哪个月」，用来断言画进容器的是哪一次的结果。 */
function emptyMonth(month) {
    return {
        year: 2026, month, day: 1, monthLabel: `2026 年 ${month} 月`,
        eventDays: [], exhibitions: [], selected: [],
    };
}

/**
 * 过期响应不能覆盖新视图。
 *
 * 同一块容器上前后发起两次加载是常态（切月份、切筛选、220ms 防抖搜索都会这样）。
 * 先发的请求如果比后发的慢，回来晚的那次若照画，屏幕上刚切到的月份会被上一次的
 * 数据盖回去，日历表头与列表日期还会对不上。
 */
test('先发起但后返回的过期响应不会覆盖后发起的那次渲染', async () => {
    await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    const { loadInto } = await webModule('js/core/loadable.js');
    // 等启动时的预加载排空再清缓存：下面的请求全部由用例自己控制，时序才确定。
    await settle(150);
    api.clearCache();

    const originalFetch = sharedWindow.fetch;
    try {
        // 受控的月视图后端：每个月的响应都先挂着，由用例决定谁先返回。
        const waiting = new Map();
        sharedWindow.fetch = (url) => new Promise((resolve) => {
            const month = Number(new URL(String(url)).searchParams.get('month'));
            waiting.set(month, (body) => resolve({ ok: true, status: 200, json: async () => body }));
        });
        installGlobals();

        const host = new StubNode('div');
        const painted = [];
        const load = (month) => loadInto(host, {
            read: api.exhibitions.month,
            params: { year: 2026, month },
            render: (data) => painted.push(data.month),
        });

        // 先发 6 月（慢），后发 7 月（快）。
        const june = load(6);
        await settle(0);
        const july = load(7);
        await settle(0);

        waiting.get(7)(emptyMonth(7));
        await settle(0);
        assert.deepStrictEqual(painted, [7], '后发起的 7 月应当先画出来');
        assert.strictEqual(host.dataset.busy, undefined, '最新的那次加载落定后要摘掉刷新标记');

        // 6 月这时才回来：整块丢弃，不能把 7 月盖掉。
        waiting.get(6)(emptyMonth(6));
        await Promise.all([june, july]);
        assert.deepStrictEqual(painted, [7], '先发起的过期响应不能覆盖后发起的那一次渲染');
        assert.strictEqual(host.dataset.busy, undefined, '过期响应不能碰刷新标记');

        // 再验一遍「不碰 data-busy」：旧请求返回时新请求还在飞，标记必须留着。
        const august = load(8);
        await settle(0);
        const september = load(9);
        await settle(0);
        assert.strictEqual(host.dataset.busy, 'true', '有请求在飞时应当标着刷新中');
        waiting.get(8)(emptyMonth(8));
        await settle(0);
        assert.strictEqual(host.dataset.busy, 'true',
            '过期响应不能摘掉后发起那次加载的刷新标记');
        assert.deepStrictEqual(painted, [7], '过期响应不能画进容器');
        waiting.get(9)(emptyMonth(9));
        await Promise.all([august, september]);
        assert.deepStrictEqual(painted, [7, 9], '只有最新发起的加载会画');
        assert.strictEqual(host.dataset.busy, undefined, '最后一次加载落定后摘掉刷新标记');
    } finally {
        sharedWindow.fetch = originalFetch;
        installGlobals();
    }
});

/**
 * 登出会清缓存，但**清不掉已经发出去的请求**。
 *
 * 预加载在登出瞬间往往还有在途请求（`profile.get` / `users.list`），它们回来时
 * 若无条件写回缓存，上一个身份的数据就会留在新会话里，TTL 的 20 秒内还能被读到。
 */
test('clearCache 之后，在途请求的结果不再写回缓存', async () => {
    await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    await settle(150);
    api.clearCache();

    const originalFetch = sharedWindow.fetch;
    try {
        let release;
        sharedWindow.fetch = () => new Promise((resolve) => {
            release = () => resolve({
                ok: true,
                status: 200,
                json: async () => ({ loggedIn: true, nickname: '上一个身份' }),
            });
        });
        installGlobals();

        const pending = api.profile.get();
        // 请求已经在飞，此时用户退出登录：这一代缓存作废。
        api.clearCache();
        release();
        const value = await pending;
        assert.strictEqual(value.nickname, '上一个身份', '调用方仍然拿到自己那次请求的结果');
        assert.strictEqual(api.profile.get.peek(), undefined,
            '过期请求回来以后不能把上一个身份的数据写进新会话的缓存');
    } finally {
        sharedWindow.fetch = originalFetch;
        installGlobals();
    }
});

/** 过期数据仍然可以被 peek 到：页面先画旧的一屏，再让取数去刷新。 */
test('只读缓存过期后仍能 peek，取数会重新请求', async () => {
    const { requests } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    // 等预加载排空后再清一次缓存，计数从真正的空缓存开始。
    await settle(150);
    api.clearCache();
    const before = countRequest(requests, 'GET', '/exhibitions');

    await api.exhibitions.list();
    assert.strictEqual(countRequest(requests, 'GET', '/exhibitions'), before + 1, '首次取数应当请求一次');
    await api.exhibitions.list();
    assert.strictEqual(countRequest(requests, 'GET', '/exhibitions'), before + 1, '缓存新鲜时不应重复请求');

    const realNow = Date.now;
    Date.now = () => realNow() + 60000;
    try {
        assert.ok(api.exhibitions.list.peek(), '过期的数据也要能被 peek 到（页面靠它先画一屏）');
        await api.exhibitions.list();
        assert.strictEqual(countRequest(requests, 'GET', '/exhibitions'), before + 2, '过期后应当重新取数');
    } finally {
        Date.now = realNow;
    }
});

/** 同一份数据的并发请求只发一次：预加载与页面取数经常撞在一起。 */
test('同一份只读数据的并发请求会去重', async () => {
    const { requests } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    await settle(150);
    api.clearCache();
    const before = countRequest(requests, 'GET', '/registrations');

    const [first, second] = await Promise.all([api.registrations.list(), api.registrations.list()]);
    assert.strictEqual(countRequest(requests, 'GET', '/registrations'), before + 1, '并发请求只应该发一次');
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

/**
 * 首页预热的目标月份要跟着 `bootstrap.calendar.landing` 走。
 *
 * 首帧的预加载发生在 bootstrap 落定之前，那时落点还是默认的 `2026-6`；如果
 * 「首页已经预热过」这条记录不带参数，后端下发的真实落点月份就会被它永久挡住，
 * 整个会话都不再预热，用户滑到真实落点月份还得等一次往返。
 */
test('首页预热的是 calendar.landing 指定的月份，而不是默认月份', async () => {
    const { requests } = await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    const bridge = await webModule('js/core/bridge.js');
    const { preloadTabs } = await webModule('js/core/preload.js');
    // 先等首帧那轮预加载（默认落点 2026-6）排空。
    await settle(150);
    assert.ok(api.exhibitions.month.peek({ year: 2026, month: 6 }),
        '前置条件：默认落点月份应当已经被预热过');

    const landing = bridge.state.calendar.landing;
    // bootstrap 下发真实落点：非默认月份，且与上面热过的那个不同。
    bridge.state.calendar.landing = { year: 2026, month: 9 };
    try {
        preloadTabs();
        assert.ok(await waitFor(() => countMonth(requests, 9) > 0),
            'bootstrap 下发真实落点后没有预热 landing 指定的月份');
        assert.ok(api.exhibitions.month.peek({ year: 2026, month: 9 }),
            'landing 月份的月数据没有进缓存');
    } finally {
        bridge.state.calendar.landing = landing;
    }
});

// ── 与后端的 REST 契约 ───────────────────────────────────────────

/**
 * `api.js` 的 ENDPOINTS 是前后端之间唯一的口头约定：动作名翻成哪个方法 + 路径。
 * 这里用打桩的 fetch 把请求录下来逐条核对，避免「后端加了接口、前端映射写错」
 * 这类只在真机上才暴露的问题（例如同名的函数把整个模块弄成语法错误）。
 */
test('动作按 ENDPOINTS 映射成后端请求，401 会自动续期一次', async () => {
    await renderRoute('home', {});
    const api = await webModule('js/core/api.js');

    const originalFetch = sharedWindow.fetch;
    const seen = [];
    let respond = { status: 200, body: {} };
    sharedWindow.fetch = async (url, options = {}) => {
        seen.push({
            url: String(url),
            method: options.method || 'GET',
            body: options.body ? JSON.parse(options.body) : null,
            authorized: Boolean(options.headers && options.headers.Authorization),
        });
        return {
            ok: respond.status < 400,
            status: respond.status,
            json: async () => respond.body,
        };
    };
    installGlobals();

    try {
        api.clearCache();
        api.setToken('');
        api.setRefreshToken('');

        // 读取类：查询串带上参数
        respond = { status: 200, body: [] };
        await api.exhibitions.list({ query: '智能' });
        assert.strictEqual(seen.at(-1).method, 'GET');
        assert.ok(seen.at(-1).url.endsWith('/api/v1/exhibitions?query=%E6%99%BA%E8%83%BD'),
            `列表路径不对：${seen.at(-1).url}`);

        // 路径参数：id 直接拼在路径里，不做查询串
        respond = { status: 200, body: { found: true } };
        await api.exhibitions.get('exh-1');
        assert.ok(seen.at(-1).url.endsWith('/api/v1/exhibitions/exh-1'), seen.at(-1).url);

        // 同一动作按有没有 id 分成新建 / 更新
        await api.exhibitions.save({ title: '新展会' });
        assert.strictEqual(seen.at(-1).method, 'POST');
        assert.ok(seen.at(-1).url.endsWith('/api/v1/exhibitions'), seen.at(-1).url);
        await api.exhibitions.save({ id: 'exh-1', title: '改名' });
        assert.strictEqual(seen.at(-1).method, 'PUT');
        assert.ok(seen.at(-1).url.endsWith('/api/v1/exhibitions/exh-1'), seen.at(-1).url);

        // 带子路径的写操作：请求体保留参数
        await api.review.updateStatus('reg-9', '已通过');
        assert.strictEqual(seen.at(-1).method, 'PUT');
        assert.ok(seen.at(-1).url.endsWith('/api/v1/review/reg-9/status'), seen.at(-1).url);
        assert.deepStrictEqual(seen.at(-1).body, { id: 'reg-9', status: '已通过' });

        // 用户公开页走查询串
        await api.users.publicProfile({ nickname: 'demo' });
        assert.ok(seen.at(-1).url.endsWith('/api/v1/users/public?nickname=demo'), seen.at(-1).url);

        // 退出登录要把刷新令牌交给后端撤销
        respond = { status: 200, body: { ok: true } };
        api.setRefreshToken('refresh-token-1');
        await api.auth.logout();
        assert.ok(seen.at(-1).url.endsWith('/api/v1/auth/logout'), seen.at(-1).url);
        assert.deepStrictEqual(seen.at(-1).body, { refreshToken: 'refresh-token-1' });
        assert.strictEqual(api.hasRefreshToken(), false, '退出后本地不应留着刷新令牌');

        // 401 → 用刷新令牌换一次 → 重试原请求
        api.clearCache();
        api.setToken('expired-token');
        api.setRefreshToken('refresh-token-2');
        let firstAttempt = true;
        sharedWindow.fetch = async (url, options = {}) => {
            const target = String(url);
            const auth = (options.headers && options.headers.Authorization) || '';
            seen.push({
                url: target,
                method: options.method || 'GET',
                body: null,
                // 记下令牌本身，「续期后重试带的是新令牌」才验得出来
                token: auth.replace(/^Bearer /, ''),
            });
            if (target.endsWith('/auth/refresh')) {
                return { ok: true, status: 200, json: async () => ({ ok: true, token: 'fresh-token', refreshToken: 'refresh-token-3' }) };
            }
            if (firstAttempt && target.endsWith('/exhibitions')) {
                firstAttempt = false;
                return { ok: false, status: 401, json: async () => ({ error: '登录状态已失效，请重新登录' }) };
            }
            return { ok: true, status: 200, json: async () => [] };
        };
        installGlobals();
        await api.exhibitions.list();
        const renewed = seen.slice(-3);
        assert.strictEqual(renewed.length, 3, `续期应当正好三次请求：${JSON.stringify(renewed)}`);
        assert.ok(renewed[0].url.endsWith('/api/v1/exhibitions'), renewed[0].url);
        assert.strictEqual(renewed[0].token, 'expired-token', '第一次应当带原来的访问令牌');
        assert.ok(renewed[1].url.endsWith('/api/v1/auth/refresh'), '第二次应当是刷新令牌');
        assert.ok(renewed[2].url.endsWith('/api/v1/exhibitions'), '第三次应当重试原请求');
        assert.strictEqual(renewed[2].token, 'fresh-token', '重试必须带续期后的新令牌');

        // 4xx 业务失败：抛成错误交给页面，不会退回桥接。
        api.clearCache();
        sharedWindow.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: '无权执行此操作' }) });
        installGlobals();
        await assert.rejects(() => api.exhibitions.list(), /无权执行此操作/);

        // 5xx：属于传输层失败，原生数据层已删除，没有第二套实现可以退。
        sharedWindow.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: '网关错误' }) });
        installGlobals();
        api.clearCache();
        await assert.rejects(() => api.exhibitions.list(),
            /后端返回 502/,
            '5xx 时应当如实报传输层失败：数据动作已经不在原生实现里');
    } finally {
        sharedWindow.fetch = originalFetch;
        installGlobals();
    }
});

/**
 * 传输层失败要能自证身份与出处。
 *
 * 页面的错误块只显示 `error.message`，排查时看得见的就是这段文案：5xx 必须带上
 * 动作名与路径，否则「后端返回 502」根本看不出是谁挂了；超时必须与「连不上」
 * 分开报，否则应答慢的后端会被说成「后端没起、请 adb reverse」，把方向带偏。
 */
test('传输层错误带上动作与路径，超时与连不上分开报', async () => {
    await renderRoute('home', {});
    const api = await webModule('js/core/api.js');
    const originalFetch = sharedWindow.fetch;
    try {
        // 5xx：文案里要有动作名与路径。
        sharedWindow.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: '网关错误' }) });
        installGlobals();
        api.clearCache();
        const bad = await api.exhibitions.month({ year: 2026, month: 6 }).catch((error) => error);
        assert.ok(bad instanceof api.TransportError,
            `5xx 应当抛导出的 TransportError，实际是 ${bad && bad.name}`);
        assert.match(bad.message, /后端返回 502/);
        assert.match(bad.message, /exhibitions\.month GET \/exhibitions\/month/,
            `5xx 文案没有带上动作与路径：${bad.message}`);

        // 超时：AbortController 中断走的是同一个 catch，必须单独分支。
        sharedWindow.fetch = async () => {
            const aborted = new Error('This operation was aborted');
            aborted.name = 'AbortError';
            throw aborted;
        };
        installGlobals();
        api.clearCache();
        const slow = await api.exhibitions.list().catch((error) => error);
        assert.ok(slow instanceof api.TransportError, '超时也应当是 TransportError');
        assert.match(slow.message, /后端响应超时/, `超时文案不对：${slow.message}`);
        assert.ok(!slow.message.includes('连不上后端服务'),
            '超时不能报成「连不上」：那会把慢后端说成没启动');
        assert.match(slow.message, /adb reverse/, '超时文案要保留排查提示');
    } finally {
        sharedWindow.fetch = originalFetch;
        installGlobals();
    }
});

// ── 桥接兜底 ─────────────────────────────────────────────────────

test('原生不回调的同步动作会在超时后拒绝，而不是永远挂着', async () => {
    await renderRoute('home', {});
    const bridge = await webModule('js/core/bridge.js');

    const original = sharedWindow.CalMobileNative;
    // 假装原生拿到动作后抛了异常又忘了 failure：既不成功也不失败（share.text 曾踩过）。
    sharedWindow.CalMobileNative = { invoke() {}, report() {} };
    try {
        // 真实等 30s 会拖垮整个测试进程（node --test 会等定时器排空才退出），
        // 把全局 setTimeout 换成「立刻到点」的替身，只影响这一个用例。
        const realSetTimeout = global.setTimeout;
        global.setTimeout = (fn) => realSetTimeout(fn, 0);
        try {
            await assert.rejects(
                bridge.call('calendar.status', { date: '2026-09-20' }),
                /超时未响应/,
            );
        } finally {
            global.setTimeout = realSetTimeout;
        }
    } finally {
        sharedWindow.CalMobileNative = original;
    }
});
