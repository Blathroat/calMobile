/**
 * 前端唯一的**数据访问入口**。
 *
 * 页面不再直接调用桥接层的 `call(动作名, 参数)`，只从本模块取方法：
 *
 *   import { exhibitions, registrations } from '../core/api.js';
 *   const items = await exhibitions.list();
 *
 * 这样前后端分离时只需要替换本文件的实现（把 `call()` 换成 fetch 到
 * `server/`），**页面与样式完全不用改**。返回值形状（字段名、状态文案）
 * 与后端接口一一对应，见 README「前后端边界」。
 *
 * 约定：
 * - 所有方法返回 Promise，失败时抛出 `Error`（由页面就地展示）；
 * - 方法名与后端资源路径同构（`exhibitions.list` ↔ `GET /api/exhibitions`）；
 * - 只放「数据」相关的方法；摄像头、日历、分享这类系统能力仍走 `bridge.js`。
 */

import { call } from './bridge.js';

/**
 * 完整契约，便于测试与整体替换；页面通常按域具名导入。
 * 新增接口时同步补 README「前后端边界」的对应表。
 */
export const api = {
    // ── 启动与认证 ─────────────────────────────────────────────────
    bootstrap: () => call('bootstrap'),
    auth: {
        login: (username, password) => call('auth.login', { username, password }),
        register: (payload) => call('auth.register', payload),
        guest: () => call('auth.guest'),
        logout: () => call('auth.logout'),
    },

    // ── 个人资料与偏好 ─────────────────────────────────────────────
    profile: {
        get: () => call('profile.get'),
        save: (payload) => call('profile.save', payload),
        changePassword: (payload) => call('profile.password', payload),
        notifications: () => call('notify.preferences'),
        saveNotifications: (patch) => call('notify.savePreferences', patch),
    },

    // ── 展会 ───────────────────────────────────────────────────────
    exhibitions: {
        list: (params = {}) => call('exhibitions.list', params),
        /** 月视图：year / month / day / explicit */
        month: (params = {}) => call('exhibitions.month', params),
        get: (id) => call('exhibitions.get', { id }),
        save: (payload) => call('exhibitions.save', payload),
        remove: (id) => call('exhibitions.delete', { id }),
        setStatus: (id, status) => call('exhibitions.status', { id, status }),
        categories: () => call('exhibitions.categories'),
        fields: (id) => call('exhibitions.fields', { id }),
        saveFields: (id, fields) => call('exhibitions.saveFields', { id, fields }),
    },

    // ── 报名 ───────────────────────────────────────────────────────
    registrations: {
        list: () => call('registrations.list'),
        get: (id) => call('registrations.get', { id }),
        submit: (payload) => call('registrations.submit', payload),
        cancel: (id) => call('registrations.cancel', { id }),
    },

    // ── 报名审核与现场核销 ─────────────────────────────────────────
    review: {
        list: (params) => call('review.list', params),
        get: (id) => call('review.get', { id }),
        updateStatus: (id, status) => call('review.updateStatus', { id, status }),
    },
    /** 展商扫码核销：把报名从「已通过」推进到「已参加」。 */
    checkIn: (code) => call('checkin.scan', { code }),

    // ── 用户与搜索 ─────────────────────────────────────────────────
    users: {
        list: (params = {}) => call('users.list', params),
        get: (id) => call('users.get', { id }),
        setStatus: (id, status) => call('users.status', { id, status }),
        publicProfile: (params) => call('users.public', params),
    },
    search: (query) => call('search.query', { query }),

    // ── 设置（服务器级配置 + 个人外观） ────────────────────────────
    settings: {
        get: () => call('settings.get'),
        save: (payload) => call('settings.save', payload),
        /** 外观模式属于个人偏好，单独一个轻量接口。 */
        saveUiMode: (mode) => call('settings.uiMode', { mode }),
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
