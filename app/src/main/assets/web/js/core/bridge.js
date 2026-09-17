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

/**
 * 启动耗时打点。
 *
 * 首帧慢是 WebView 承载的常见问题，靠猜不如量。每个节点都记一次
 * `performance.now()`，`mark()` 会把结果写进 `window.__CALMOBILE_TIMING__`，
 * 原生侧通过 `report` 记到 logcat（`adb logcat -s WebShellActivity`）就能看到：
 *
 *   D/WebShellActivity: web timing: module-start=12ms native-ready=48ms first-paint=210ms ...
 */
const timings = {};
const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;

export function mark(label) {
    if (!t0) {
        return;
    }
    timings[label] = Math.round(performance.now() - t0);
}

export function reportTimings() {
    if (hasWindow) {
        window.__CALMOBILE_TIMING__ = { ...timings };
    }
    const summary = Object.entries(timings).map(([key, value]) => `${key}=${value}ms`).join(' ');
    if (summary) {
        console.log(`web timing: ${summary}`);
    }
    return summary;
}

const hasWindow = typeof window !== 'undefined';

const pending = new Map();
let sequence = 1;
let readyResolve;
const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
});
/**
 * bootstrap 只执行一次。
 * <p>
 * 必须在模块顶层声明：原生可能在脚本求值期间就调用 `CalMobileWeb.ready()`，
 * 那时 `boot()` 会立刻执行，声明在后面会踩到暂时性死区。
 */
let bootPromise = null;

const MODE_KEY = 'calmobile.mode';

/** 读取本机缓存的外观偏好，供首帧与原生下发前使用。 */
function readStoredMode() {
    if (!hasWindow) {
        return 'auto';
    }
    try {
        const value = window.localStorage?.getItem(MODE_KEY);
        return value === 'light' || value === 'dark' ? value : 'auto';
    } catch (ignored) {
        return 'auto';
    }
}

/** 应用级状态：原生在 bootstrap 时下发，页面只读。 */
export const state = {
    booted: false,
    user: { loggedIn: false, guest: true, role: 'guest', roleLabel: '访客', nickname: '', avatar: '', can: {} },
    theme: { index: 0, colors: [] },
    /** 外观偏好：auto 跟随系统，light / dark 由用户显式选择。 */
    ui: { mode: readStoredMode() },
    capabilities: {},
    categories: [],
    review: { canRevise: false, statuses: [] },
    media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 },
    /** 服务器设置：上传格式与头像大小限制，管理员保存后对所有用户生效。 */
    server: { avatarSizeMb: 2, imageFormats: [], videoFormats: [] },
    /** 服务器设置：普通用户与展商可自由填写的表单字符数上限。 */
    limits: {
        exhibitionTitle: 60,
        exhibitionVenue: 60,
        category: 20,
        fieldTitle: 30,
        usernameMin: 3,
        usernameMax: 20,
        passwordMin: 6,
        passwordMax: 32,
        nickname: 20,
        bio: 200,
        region: 40,
        answer: 200,
    },
    announcement: { enabled: false, text: '' },
    /** 软件中英文标题，由管理-设置维护，显示在首页上方与其它展示应用名称的位置。 */
    brand: { zh: '发现展会', en: 'calMobile' },
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

/**
 * 原生就绪后触发 bootstrap。
 *
 * **不能等 bootstrap 完成才 resolve `readyPromise`**：bootstrap 走的是远端 HTTP，
 * 未启动后端时它可能超时甚至永久挂起，而 `call()` 本身又依赖页面脚本先加载完，
 * 等下去就是首帧白屏（曾经的死锁：boot → call → 等 ready；ready → 等 boot）。
 *
 * 因此这里立刻放行「原生已就绪」，让应用按已知状态渲染首屏；bootstrap 结果到了
 * 由 app.js 决定是否纠正入口页。
 */
function start() {
    mark('native-ready');
    readyResolve();
    return boot();
}

/**
 * 等待原生桥接就绪（不代表 bootstrap 已完成）。
 * 页面要按最新登录态渲染，请用 {@link bootReady}。
 */
export function whenReady() {
    return readyPromise;
}

/**
 * 等待 bootstrap 数据落定。
 * 与 `whenReady()` 分开：首帧只需要前者，后者可能因为后端不可达而较慢。
 */
export function bootReady() {
    return boot().catch((error) => {
        reportError(error);
        return state;
    });
}

export function boot() {
    if (bootPromise) {
        return bootPromise;
    }
    bootPromise = (async () => {
        mark('boot-start');
        if (!hasNative() && typeof fetch !== 'function') {
            return state;
        }
        // 动态导入避免与 api.js 形成循环依赖：api.js 依赖本模块的 call()，
        // 而 bootstrap 又要走 api 的统一入口。
        const api = await import('./api.js');
        mark('api-loaded');
        applyBootstrap(await api.bootstrap());
        mark('bootstrap-done');
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
    Object.assign(state.ui, data.ui || {});
    Object.assign(state.capabilities, data.capabilities || {});
    Object.assign(state.review, data.review || {});
    Object.assign(state.media, data.media || {});
    Object.assign(state.server, data.server || {});
    Object.assign(state.limits, data.limits || {});
    Object.assign(state.announcement, data.announcement || {});
    Object.assign(state.brand, data.brand || {});
    Object.assign(state.calendar, data.calendar || {});
    state.categories = Array.isArray(data.categories) ? data.categories : [];
    applyTheme();
}

/** 服务器设置保存后同步一次，界面无需重新 bootstrap。 */
export function applySettings(settings) {
    if (!settings) {
        return;
    }
    Object.assign(state.theme, settings.theme || {});
    Object.assign(state.ui, settings.ui || {});
    Object.assign(state.media, settings.media || {});
    Object.assign(state.server, settings.upload || {});
    Object.assign(state.limits, settings.limits || {});
    Object.assign(state.review, settings.review || {});
    Object.assign(state.announcement, settings.announcement || {});
    Object.assign(state.brand, settings.brand || {});
    if (Array.isArray(settings.categories)) {
        state.categories = settings.categories;
    }
    applyTheme();
}

/**
 * 深色模式：把偏好写到 <html data-mode>，由 tokens.css 里的一组令牌接管颜色。
 * 同时缓存到 localStorage，页面重新加载时首帧就能落到正确模式，不会闪白。
 */
export function applyMode(mode) {
    const next = mode === 'light' || mode === 'dark' ? mode : 'auto';
    state.ui.mode = next;
    if (typeof document === 'undefined') {
        return next;
    }
    if (next === 'auto') {
        delete document.documentElement.dataset.mode;
    } else {
        document.documentElement.dataset.mode = next;
    }
    try {
        window.localStorage?.setItem(MODE_KEY, next);
    } catch (ignored) {
        // 隐私模式下忽略缓存失败，本次会话内仍然生效
    }
    // 浅底/描边由页面底色混出，底色变了要重新算一遍强调色衍生值。
    applyTheme();
    return next;
}

/** 当前实际生效的明暗模式（auto 时看系统偏好）。 */
export function effectiveMode() {
    const mode = state.ui.mode;
    if (mode === 'light' || mode === 'dark') {
        return mode;
    }
    if (hasWindow && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
}

/**
 * 管理员配色写入 CSS 变量，页面无需重复声明颜色。
 * <p>
 * 强调色不只驱动事件圆点与浅底，还驱动分段控件滑块、选中日期、导航与区块标题，
 * 这样改配色在触屏设备上也能立刻看到整屏变化。浅底与描边都用强调色与
 * 「当前页面底色」混出：浅色模式下等于白底加淡色边框，深色模式下自动变成深底。
 */
export function applyTheme() {
    if (typeof document === 'undefined') {
        return;
    }
    const colors = Array.isArray(state.theme.colors) ? state.theme.colors : [];
    const index = Number(state.theme.index) || 0;
    const accent = colors[index] || '#c05621';
    const root = document.documentElement;
    const mode = effectiveMode();
    const screen = cssColor('--screen', mode === 'dark' ? '#171a1f' : '#ffffff');
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-ink', mode === 'dark'
        ? mix(accent, screen, 0.28)
        : mix(accent, '#000000', 0.28));
    // 浅底与页面底色保持一致：次按钮只改边框与文字，底色始终是页面自身颜色。
    root.style.setProperty('--accent-tint', screen);
    root.style.setProperty('--accent-edge', mode === 'dark'
        ? mix(accent, screen, 0.62)
        : mix(accent, screen, 0.6));
    root.style.setProperty('--accent-glow', rgba(accent, mode === 'dark' ? 0.26 : 0.14));
    root.style.setProperty('--accent-shadow', rgba(accent, mode === 'dark' ? 0.34 : 0.2));
    root.dataset.accent = String(index);
}

/** 读取令牌当前取值，用于把强调色和页面底色混在一起。 */
function cssColor(name, fallback) {
    if (typeof getComputedStyle !== 'function') {
        return fallback;
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

// 跟随系统时，系统切换深浅色需要重新混一遍强调色的衍生值。
if (hasWindow && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
        if (state.ui.mode === 'auto') {
            applyTheme();
        }
    };
    if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', onChange);
    } else if (typeof query.addListener === 'function') {
        query.addListener(onChange);
    }
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
/** 半透明强调色，用于聚焦光晕与投影，跟随管理员配色一起变化。 */
function rgba(hex, alpha) {
    const { r, g, b } = toRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
