/**
 * 原生桥接层。
 *
 * Android 侧通过 `addJavascriptInterface(WebAppBridge, 'CalMobileNative')` 暴露：
 *   CalMobileNative.invoke(action, payloadJson, callbackId)
 * 原生处理完成后回调：
 *   window.CalMobileBridge.onResult(callbackId, ok, result, error)
 *
 * 页面只使用 `call(action, payload)`，异常统一抛出 Error 供页面展示。
 * 模块顶层的 window 访问都做了存在性判断，便于静态检查工具直接导入本文件。
 */

const hasWindow = typeof window !== 'undefined';

const pending = new Map();
let sequence = 1;
let readyResolve;
const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
});

/** 应用级状态：原生在 bootstrap 时下发，页面只读。 */
export const state = {
    booted: false,
    user: { loggedIn: false, guest: true, role: 'guest', roleLabel: '访客', nickname: '', can: {} },
    theme: { index: 0, colors: [] },
    capabilities: {},
    categories: [],
    review: { canRevise: false, statuses: [] },
    media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 },
    announcement: { enabled: false, text: '' },
    calendar: { available: false },
};

export function hasNative() {
    return hasWindow && typeof window.CalMobileNative !== 'undefined' && window.CalMobileNative !== null;
}

/** 调用原生动作，返回 Promise。 */
export function call(action, payload = {}) {
    if (!hasNative()) {
        return Promise.reject(new Error('当前环境没有原生桥接，请在 Android 应用中打开'));
    }
    const callbackId = `cb-${sequence++}`;
    return new Promise((resolve, reject) => {
        pending.set(callbackId, { resolve, reject, action });
        try {
            window.CalMobileNative.invoke(action, JSON.stringify(payload || {}), callbackId);
        } catch (error) {
            pending.delete(callbackId);
            reject(error);
        }
    });
}

/** 原生在页面加载完成后调用；页面脚本可能尚未执行，因此先落一个标记。 */
if (hasWindow) {
    window.CalMobileWeb = {
        ready() {
            window.__CALMOBILE_READY__ = true;
            start().catch(reportError);
        },
    };

    if (window.__CALMOBILE_READY__) {
        start().catch(reportError);
    }

    window.CalMobileBridge = {
        onResult(callbackId, ok, result, error) {
            const entry = pending.get(callbackId);
            if (!entry) {
                return;
            }
            pending.delete(callbackId);
            if (ok) {
                entry.resolve(result);
            } else {
                entry.reject(new Error(error || '操作未完成'));
            }
        },
    };
}

function start() {
    return boot().then(() => readyResolve());
}

/** 等待原生就绪并完成 bootstrap。 */
export function whenReady() {
    return readyPromise;
}

export function isReady() {
    return state.booted;
}

let bootPromise = null;

export function boot() {
    if (bootPromise) {
        return bootPromise;
    }
    bootPromise = (async () => {
        if (!hasNative()) {
            return state;
        }
        const data = await call('bootstrap');
        applyBootstrap(data);
        return state;
    })();
    return bootPromise;
}

export function applyBootstrap(data) {
    if (!data) {
        return;
    }
    state.booted = true;
    Object.assign(state.user, data.user || {});
    Object.assign(state.theme, data.theme || {});
    Object.assign(state.capabilities, data.capabilities || {});
    Object.assign(state.review, data.review || {});
    Object.assign(state.media, data.media || {});
    Object.assign(state.announcement, data.announcement || {});
    Object.assign(state.calendar, data.calendar || {});
    state.categories = Array.isArray(data.categories) ? data.categories : [];
    applyTheme();
}

/** 管理员配色写入 CSS 变量，页面无需重复声明颜色。 */
export function applyTheme() {
    if (typeof document === 'undefined') {
        return;
    }
    const accent = state.theme.colors?.[state.theme.index] || '#c05621';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-ink', shade(accent, -0.28));
    document.documentElement.style.setProperty('--accent-tint', mix(accent, '#ffffff', 0.86));
    document.documentElement.style.setProperty('--accent-edge', mix(accent, '#ffffff', 0.6));
}

/** 刷新用户态，用于登录、注册、退出后同步导航与权限。 */
export async function refreshUser() {
    const user = await call('profile.get');
    Object.assign(state.user, user || {});
    return state.user;
}

export function reportError(error) {
    const message = error instanceof Error ? `${error.message}` : String(error);
    console.error(message);
    if (hasNative()) {
        try {
            window.CalMobileNative.report(message);
        } catch (ignored) {
            // 忽略上报失败
        }
    }
}

// ── 颜色工具 ──────────────────────────────────────────────────────

function toRgb(hex) {
    const value = String(hex || '').replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    return {
        r: parseInt(full.slice(0, 2), 16) || 0,
        g: parseInt(full.slice(2, 4), 16) || 0,
        b: parseInt(full.slice(4, 6), 16) || 0,
    };
}

function toHex({ r, g, b }) {
    const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
}

function mix(hex, other, amount) {
    const a = toRgb(hex);
    const b = toRgb(other);
    return toHex({
        r: a.r + (b.r - a.r) * amount,
        g: a.g + (b.g - a.g) * amount,
        b: a.b + (b.b - a.b) * amount,
    });
}

function shade(hex, amount) {
    return amount < 0 ? mix(hex, '#000000', -amount) : mix(hex, '#ffffff', amount);
}
