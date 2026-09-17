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
const PROBE_TIMEOUT = 1500;

/** 'unknown' | 'remote' | 'native' */
let mode = 'unknown';
let currentToken = '';

/** 探一次后端；结果缓存，`force` 可强制重探。 */
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
    let response;
    try {
        response = await fetch(`${BASE_URL}/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
            },
            body: JSON.stringify(payload || {}),
        });
    } catch (error) {
        // 连不上、被中断、超时：都属于传输层问题，可以退回原生。
        throw new TransportError(error.message);
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
 * 统一的取数方法：先按探测结果选传输层，传输层失败时退回原生。
 * 业务失败（`ok: false`）原样抛给页面，不做降级。
 */
async function request(action, payload) {
    const selected = await probe();
    if (selected === 'remote') {
        try {
            return await callRemote(action, payload);
        } catch (error) {
            if (!(error instanceof TransportError)) {
                throw error;
            }
            console.warn(`[api] ${action} 远端不可用，退回原生桥接：${error.message}`);
            mode = 'native';
        }
    }
    return call(action, payload);
}

/**
 * 完整契约，便于测试与整体替换；页面通常按域具名导入。
 * 新增接口时同步补 README「前后端边界」的对应表。
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
            return result;
        },
        register: (payload) => request('auth.register', payload),
        guest: () => request('auth.guest'),
        logout: async () => {
            setToken('');
            return request('auth.logout');
        },
    },

    // ── 个人资料与偏好 ─────────────────────────────────────────────
    profile: {
        get: () => request('profile.get'),
        save: (payload) => request('profile.save', payload),
        changePassword: (payload) => request('profile.password', payload),
        notifications: () => request('notify.preferences'),
        saveNotifications: (patch) => request('notify.savePreferences', patch),
    },

    // ── 展会 ───────────────────────────────────────────────────────
    exhibitions: {
        list: (params = {}) => request('exhibitions.list', params),
        /** 月视图：year / month / day / explicit */
        month: (params = {}) => request('exhibitions.month', params),
        get: (id) => request('exhibitions.get', { id }),
        save: (payload) => request('exhibitions.save', payload),
        remove: (id) => request('exhibitions.delete', { id }),
        setStatus: (id, status) => request('exhibitions.status', { id, status }),
        categories: () => request('exhibitions.categories'),
        fields: (id) => request('exhibitions.fields', { id }),
        saveFields: (id, fields) => request('exhibitions.saveFields', { id, fields }),
    },

    // ── 报名 ───────────────────────────────────────────────────────
    registrations: {
        list: () => request('registrations.list'),
        get: (id) => request('registrations.get', { id }),
        submit: (payload) => request('registrations.submit', payload),
        cancel: (id) => request('registrations.cancel', { id }),
    },

    // ── 报名审核与现场核销 ─────────────────────────────────────────
    review: {
        list: (params) => request('review.list', params),
        get: (id) => request('review.get', { id }),
        updateStatus: (id, status) => request('review.updateStatus', { id, status }),
    },
    /** 展商扫码核销：把报名从「已通过」推进到「已参加」。 */
    checkIn: (code) => request('checkin.scan', { code }),

    // ── 用户与搜索 ─────────────────────────────────────────────────
    users: {
        list: (params = {}) => request('users.list', params),
        get: (id) => request('users.get', { id }),
        setStatus: (id, status) => request('users.status', { id, status }),
        publicProfile: (params) => request('users.public', params),
    },
    search: (query) => request('search.query', { query }),

    // ── 设置（服务器级配置 + 个人外观） ────────────────────────────
    settings: {
        get: () => request('settings.get'),
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
