/**
 * 前端唯一的**数据访问入口**。
 *
 * 页面不再直接调用桥接层的 `call(动作名, 参数)`，只从本模块取方法：
 *
 *   import { exhibitions, registrations } from '../core/api.js';
 *   const items = await exhibitions.list();
 *
 * ## 传输层
 *
 * 数据请求优先走 HTTP（`server/`），失败时自动退回原生桥接，因此：
 *
 * - **后端可用**：页面数据来自 `callRemote`，前后端已经分离；
 * - **后端不可用**：退回 `callNative`，应用仍然可用（离线 / 未启动服务时）。
 *
 * 分离完成后删掉 `callNative` 分支与本文件里的降级逻辑即可，页面不用改。
 * 连通性在启动时探测一次（`ping`），结果缓存在 `mode`。
 *
 * ## 约定
 *
 * - 方法名与后端资源路径同构（`exhibitions.list` ↔ `GET /exhibitions.list`）；
 * - 返回值字段与状态文案与桥接层完全一致，页面按同一套字段渲染；
 * - 失败统一抛出 `Error`，由页面就地展示；
 * - 只放「数据」相关的方法；摄像头、日历、分享这类系统能力仍走 `bridge.js`。
 */

import { call } from './bridge.js';

/**
 * 后端基地址。
 *
 * 页面本身运行在 `https://appassets.androidplatform.net` 这个 HTTPS 上下文里，
 * 请求 http:// 会被 WebView 判定为混合内容并拦截。因此：
 *
 * - **真机与模拟器统一用 `adb reverse tcp:4000 tcp:4000`**，然后访问 127.0.0.1；
 * - `WebShellActivity` 已开启 `MIXED_CONTENT_ALWAYS_ALLOW` 允许这次明文请求
 *   （正式后端改 HTTPS 后应当去掉该设置）。
 */
const BASE_URL = 'http://127.0.0.1:4000';

/** 探测超时：超过这个时间就认为后端不可用，避免启动被拖住。 */
const PROBE_TIMEOUT = 1200;

/** 单次请求超时：挂起的请求不能把启动流程一起卡死。 */
const REQUEST_TIMEOUT = 3000;

/** 'unknown' | 'remote' | 'native' */
let mode = 'unknown';
let currentToken = '';

/**
 * 显式探一次后端。
 *
 * 取数路径**不用**它（那样会多一次往返，超时还要连试几轮）；它只服务于
 * “设置里显示当前连的是哪个后端”这类需要明确答案的场景。
 */
export async function probe(force = false) {
    if (mode !== 'unknown' && !force) {
        return mode;
    }
    if (typeof fetch !== 'function') {
        mode = 'native';
        return mode;
    }
    try {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT) : null;
        const response = await fetch(`${BASE_URL}/ping`, { signal: controller?.signal });
        if (timer) {
            clearTimeout(timer);
        }
        mode = response.ok ? 'remote' : 'native';
    } catch (ignored) {
        mode = 'native';
    }
    return mode;
}

/** 当前传输方式，供设置页或调试显示。 */
export function transport() {
    return mode;
}

/** 退出登录等场景清掉本地令牌。 */
export function setToken(token) {
    currentToken = token || '';
}

/** 传输层错误：只有这类错误才值得退回原生桥接。 */
class TransportError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TransportError';
    }
}

async function callRemote(action, payload) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT) : null;
    let response;
    try {
        response = await fetch(`${BASE_URL}/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
            },
            body: JSON.stringify(payload || {}),
            signal: controller?.signal,
        });
    } catch (error) {
        // 连不上、被中断、超时：都属于传输层问题，可以退回原生。
        throw new TransportError(error.message);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
    if (!response.ok) {
        throw new TransportError(`后端返回 ${response.status}`);
    }
    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new TransportError(`响应不是合法 JSON：${error.message}`);
    }
    // 业务失败：后端返回 { ok: false, error }，与桥接层一致，交给页面判断。
    if (data && data.ok === false && data.error) {
        throw new Error(data.error);
    }
    return data;
}

/**
 * 只读接口的短缓存。
 *
 * 日志显示同一份数据在一次浏览里会被反复取（切页面、切分区、切筛选都会重新拉），
 * 每次都是一次远端往返 + 一次整页重绘，这是“操作有点卡”的主要来源。这里对
 * 只读接口做几十秒的短缓存，写操作会清掉相关前缀，页面因此仍然看到最新数据。
 *
 * 缓存同时承担「先画旧数据」的职责：`peek()` 会连**过期**的条目一起返回，
 * 页面据此在第一帧就把内容画出来，不再先闪一块骨架屏（见 core/loadable.js）。
 */
const CACHE_TTL = 20000;
const cache = new Map();

/** 同一份数据正在请求时复用同一个 Promise，预加载与页面取数不会各发一次。 */
const inflight = new Map();

/** 哪些动作是只读的、可以缓存。 */
const CACHEABLE = new Set([
    'exhibitions.list', 'exhibitions.month', 'exhibitions.get', 'exhibitions.categories',
    'exhibitions.fields', 'registrations.list', 'registrations.get', 'review.list',
    'review.get', 'users.list', 'users.get', 'users.public', 'search.query',
    'settings.get', 'notify.preferences', 'profile.get',
]);

/** 写操作成功后要清掉的缓存前缀。 */
const INVALIDATE = {
    'exhibitions.save': ['exhibitions.', 'search.'],
    'exhibitions.delete': ['exhibitions.', 'registrations.', 'review.', 'search.'],
    'exhibitions.status': ['exhibitions.', 'registrations.', 'review.', 'search.'],
    'exhibitions.saveFields': ['exhibitions.'],
    'registrations.submit': ['registrations.', 'review.', 'exhibitions.'],
    'registrations.cancel': ['registrations.', 'review.', 'exhibitions.'],
    'review.updateStatus': ['review.', 'registrations.', 'users.public'],
    'checkin.scan': ['review.', 'registrations.', 'users.public'],
    'users.status': ['users.'],
    'settings.save': ['settings.', 'notify.'],
    'settings.uiMode': ['settings.'],
    'notify.savePreferences': ['notify.'],
    'profile.save': ['profile.', 'users.public'],
    'exhibitions.categories': [],
};

/**
 * 缓存键：参数按键名排序后拼成一行，`{day, month}` 与 `{month, day}` 命中同一条；
 * 空值（未指定）不参与，`{query: ''}` 与 `{}` 也命中同一条。
 * 预加载与页面取数是两处独立代码，键不稳定会让预加载永远打不中。
 */
function cacheKey(action, payload) {
    const source = payload || {};
    const parts = Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== '')
        .map((key) => `${key}=${JSON.stringify(source[key])}`);
    return `${action}|${parts.join('&')}`;
}

function invalidate(action) {
    const prefixes = INVALIDATE[action];
    if (!prefixes) {
        return;
    }
    if (prefixes.length === 0) {
        return;
    }
    for (const key of [...cache.keys()]) {
        const cachedAction = key.slice(0, key.indexOf('|'));
        if (prefixes.some((prefix) => prefix.endsWith('.')
            ? cachedAction.startsWith(prefix)
            : cachedAction === prefix)) {
            cache.delete(key);
        }
    }
}

/** 缓存被清空时的通知：预加载据此重算「已经热身过哪些目标」。 */
const clearListeners = [];

export function onCacheClear(listener) {
    if (typeof listener === 'function') {
        clearListeners.push(listener);
    }
}

/** 清空全部缓存；登录 / 退出登录后调用，避免看到上一个身份的数据。 */
export function clearCache() {
    cache.clear();
    for (const listener of clearListeners) {
        try {
            listener();
        } catch (error) {
            console.error(error);
        }
    }
}

/**
 * 统一的取数方法。
 *
 * 传输层**不做单独的连通性预探测**：那会平白多一次往返，超时时还会连试几轮
 * （实测 `bootstrap-done` 因此达到 5.6s）。这里直接发真实请求，失败再退回原生，
 * 第一次成功的那条路会被记住，后续请求不再摇摆。
 *
 * 业务失败（`ok: false`）原样抛给页面，不降级、不重试。
 *
 * 只读接口在请求期间会去重：预加载与页面取数撞到同一个键时只发一次。
 */
async function request(action, payload = {}) {
    const cacheable = CACHEABLE.has(action);
    const key = cacheable ? cacheKey(action, payload) : '';
    if (cacheable) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_TTL) {
            return hit.value;
        }
        const running = inflight.get(key);
        if (running) {
            return running;
        }
    }

    const task = send(action, payload).then(
        (value) => {
            if (cacheable && value !== undefined) {
                cache.set(key, { at: Date.now(), value });
            }
            invalidate(action);
            return value;
        },
        (error) => {
            invalidate(action);
            throw error;
        },
    );

    if (cacheable) {
        inflight.set(key, task);
        // 成败都要摘掉，否则一次失败会被后续请求一直复用。
        const done = () => inflight.delete(key);
        task.then(done, done);
    }
    return task;
}

/** 实际发请求：先远端，传输层失败再退回原生桥接。 */
async function send(action, payload) {
    let value;
    if (mode !== 'native' && typeof fetch === 'function') {
        try {
            value = await callRemote(action, payload);
            mode = 'remote';
        } catch (error) {
            if (!(error instanceof TransportError)) {
                throw error;
            }
            console.warn(`[api] ${action} 远端不可用，退回原生桥接：${error.message}`);
            mode = 'native';
        }
    }
    if (value === undefined) {
        value = await call(action, payload);
    }
    return value;
}

/**
 * **同步**读缓存。
 *
 * 命中时连过期的条目一起返回：页面拿它先画一屏，再让 `request()` 在后台刷新，
 * 这样切页面不会先出现骨架屏。没有命中返回 `undefined`。
 */
export function peek(action, payload = {}) {
    const hit = cache.get(cacheKey(action, payload));
    return hit ? hit.value : undefined;
}

/**
 * 后台预取：把结果灌进只读缓存，失败静默。
 * 供 core/preload.js 按「用户下一步大概率要点哪里」提前热身。
 */
export function warm(action, payload = {}) {
    if (!CACHEABLE.has(action)) {
        return Promise.resolve(false);
    }
    return request(action, payload).then(() => true, () => false);
}

/**
 * 只读接口的包装：同一个函数既能取数，也能同步读缓存、后台预取。
 *
 * - `exhibitions.list(params)` —— 取数，缓存新鲜时不再发请求；
 * - `exhibitions.list.peek(params)` —— 同步返回缓存（可为过期数据）；
 * - `exhibitions.list.warm(params)` —— 后台预取，失败静默。
 *
 * `toPayload` 把页面侧的调用参数（例如 `exhibitions.get(id)` 的 id）翻译成请求体，
 * 这样加了 peek / warm 也不用改任何调用点。
 */
function reader(action, toPayload = (arg) => arg || {}) {
    const fn = (arg) => request(action, toPayload(arg));
    fn.action = action;
    fn.peek = (arg) => peek(action, toPayload(arg));
    fn.warm = (arg) => warm(action, toPayload(arg));
    return fn;
}

/** 以 id 为唯一参数的接口：`exhibitions.get(id)` ↔ `{ id }`。 */
const byId = (id) => ({ id });

/**
 * 完整契约，便于测试与整体替换；页面通常按域具名导入。
 * 新增接口时同步补 README「前后端边界」的对应表。
 *
 * 只读接口一律用 `reader()` 包一层，因此都带 `peek()` / `warm()`；
 * 写接口是普通函数，没有缓存语义。
 */
export const api = {
    // ── 启动与认证 ─────────────────────────────────────────────────
    bootstrap: () => request('bootstrap'),
    auth: {
        login: async (username, password) => {
            const result = await request('auth.login', { username, password });
            if (result?.token) {
                setToken(result.token);
            }
            // 换了身份，上一份缓存不再适用。
            clearCache();
            return result;
        },
        register: (payload) => request('auth.register', payload),
        guest: () => request('auth.guest'),
        logout: async () => {
            setToken('');
            clearCache();
            return request('auth.logout');
        },
    },

    // ── 个人资料与偏好 ─────────────────────────────────────────────
    profile: {
        get: reader('profile.get'),
        save: (payload) => request('profile.save', payload),
        changePassword: (payload) => request('profile.password', payload),
        notifications: reader('notify.preferences'),
        saveNotifications: (patch) => request('notify.savePreferences', patch),
    },

    // ── 展会 ───────────────────────────────────────────────────────
    exhibitions: {
        list: reader('exhibitions.list'),
        /** 月视图：year / month / day / explicit */
        month: reader('exhibitions.month'),
        get: reader('exhibitions.get', byId),
        save: (payload) => request('exhibitions.save', payload),
        remove: (id) => request('exhibitions.delete', { id }),
        setStatus: (id, status) => request('exhibitions.status', { id, status }),
        categories: reader('exhibitions.categories'),
        fields: reader('exhibitions.fields', byId),
        saveFields: (id, fields) => request('exhibitions.saveFields', { id, fields }),
    },

    // ── 报名 ───────────────────────────────────────────────────────
    registrations: {
        list: reader('registrations.list'),
        get: reader('registrations.get', byId),
        submit: (payload) => request('registrations.submit', payload),
        cancel: (id) => request('registrations.cancel', { id }),
    },

    // ── 报名审核与现场核销 ─────────────────────────────────────────
    review: {
        list: reader('review.list'),
        get: reader('review.get', byId),
        updateStatus: (id, status) => request('review.updateStatus', { id, status }),
    },
    /** 展商扫码核销：把报名从「已通过」推进到「已参加」。 */
    checkIn: (code) => request('checkin.scan', { code }),

    // ── 用户与搜索 ─────────────────────────────────────────────────
    users: {
        list: reader('users.list'),
        get: reader('users.get', byId),
        setStatus: (id, status) => request('users.status', { id, status }),
        publicProfile: reader('users.public'),
    },
    search: reader('search.query', (query) => ({ query })),

    // ── 设置（服务器级配置 + 个人外观） ────────────────────────────
    settings: {
        get: reader('settings.get'),
        save: (payload) => request('settings.save', payload),
        /** 外观模式属于个人偏好，单独一个轻量接口。 */
        saveUiMode: (mode2) => request('settings.uiMode', { mode: mode2 }),
    },
};

/**
 * 常用别名。
 * `users` / `profile` / `settings` 这几个域在页面里常被同名的局部变量占用
 * （例如 admin.js 的 `const users = ...`、profile.js 的 `let settings = ...`），
 * 直接导入会被遮蔽，因此同时提供 `*Api` 别名。
 */
export const usersApi = api.users;
export const profileApi = api.profile;
export const settingsApi = api.settings;
export const authApi = api.auth;

// 具名导出：页面按域导入，例如 `import { exhibitions } from '../core/api.js'`。
export const {
    bootstrap, auth, profile, exhibitions, registrations, review, checkIn, users,
    search, settings,
} = api;
