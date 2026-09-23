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
 * 数据只有一个来源：`server/` 的 Hono + PostgreSQL 后端（`pnpm dev`，默认 3000）。
 * 页面只认动作名，HTTP 形状由下面的 `ENDPOINTS` 表翻译，因此后端换实现不影响页面；
 * 后端连不上就直接抛错由页面提示——没有第二个数据源可以退回。
 *
 * ## 约定
 *
 * - 后端返回的字段与状态文案与页面一一对应；
 * - 失败统一抛出 `Error`，由页面就地展示；传输层失败（连不上 / 超时 / 5xx /
 *   响应不是 JSON）抛的是导出的 `TransportError`，需要区分时用 `instanceof` 判断；
 * - 只放「数据」相关的方法；摄像头、日历、分享这类系统能力仍走 `bridge.js`。
 */

/**
 * 后端基地址。
 *
 * 页面本身运行在 `https://appassets.androidplatform.net` 这个 HTTPS 上下文里，
 * 请求 http:// 会被 WebView 判定为混合内容并拦截。因此：
 *
 * - **真机与模拟器统一用 `adb reverse tcp:3000 tcp:3000`**，然后访问 127.0.0.1；
 * - `WebShellActivity` 已开启 `MIXED_CONTENT_ALWAYS_ALLOW` 允许这次明文请求
 *   （正式后端改 HTTPS 后应当去掉该设置）。
 */
const BASE_URL = 'http://127.0.0.1:3000/api/v1';

/** 单次请求超时：挂起的请求不能把页面一起卡死。 */
const REQUEST_TIMEOUT = 3000;

let currentToken = '';
/** 刷新令牌：访问令牌过期时用它换一套新的，见 callRemote。 */
let refreshToken = '';

/** 退出登录等场景清掉本地令牌。 */
export function setToken(token) {
    currentToken = token || '';
}

/** 登录 / 刷新后保存刷新令牌。 */
export function setRefreshToken(token) {
    refreshToken = token || '';
}

export function hasRefreshToken() {
    return Boolean(refreshToken);
}

/**
 * 传输层错误：连不上后端、超时、响应不是 JSON、5xx 这类问题。
 *
 * 导出是给页面与测试分辨「传输失败」和「业务失败（`Error`）」用的：
 * 只比对 message 里的字符串太脆，`error instanceof TransportError` 才是契约。
 */
export class TransportError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TransportError';
    }
}

/**
 * 动作 → REST 端点。
 *
 * 页面只认 `api.exhibitions.list()` 这样的**动作名**，HTTP 长什么样只在这个文件里：
 * 后端由 Hono + PostgreSQL 提供时，页面一行都没改。
 * 每一项接收动作参数，返回 `{ method, path, body }`；`path` 以 `BASE_URL` 为前缀。
 * 契约测试直接调用这张表。页面仍只使用下面导出的方法。
 */
export const ENDPOINTS = {
    bootstrap: () => ({ method: 'GET', path: '/bootstrap' }),

    'auth.login': () => ({ method: 'POST', path: '/auth/login' }),
    // 两步验证的第二步与重发：密码对但还没过码时，后端只发一张预认证票，不发令牌。
    'auth.loginVerify': () => ({ method: 'POST', path: '/auth/login/verify' }),
    'auth.loginCode': () => ({ method: 'POST', path: '/auth/login/code' }),
    'auth.register': () => ({ method: 'POST', path: '/auth/register' }),
    'auth.registerVerify': () => ({ method: 'POST', path: '/auth/register/verify' }),
    'auth.forgotPassword': () => ({ method: 'POST', path: '/auth/password/forgot' }),
    'auth.resetPassword': () => ({ method: 'POST', path: '/auth/password/reset' }),
    'auth.guest': () => ({ method: 'POST', path: '/auth/guest' }),
    'auth.logout': (payload) => ({ method: 'POST', path: '/auth/logout', body: payload }),

    'profile.get': () => ({ method: 'GET', path: '/profile' }),
    'profile.save': () => ({ method: 'PUT', path: '/profile' }),
    'profile.password': () => ({ method: 'POST', path: '/profile/password' }),
    'notify.preferences': () => ({ method: 'GET', path: '/profile/notifications' }),
    'notify.savePreferences': () => ({ method: 'PUT', path: '/profile/notifications' }),

    // 安全设置：邮箱（改邮箱要先验证新地址）与两步验证开关
    'security.get': () => ({ method: 'GET', path: '/profile/security' }),
    'security.enable2fa': () => ({ method: 'POST', path: '/profile/2fa/enable' }),
    'security.verify2fa': () => ({ method: 'POST', path: '/profile/2fa/enable/verify' }),
    'security.disable2fa': () => ({ method: 'POST', path: '/profile/2fa/disable' }),
    'security.changeEmail': () => ({ method: 'POST', path: '/profile/email' }),
    'security.verifyEmail': () => ({ method: 'POST', path: '/profile/email/verify' }),
    'security.totpSetup': () => ({ method: 'POST', path: '/profile/2fa/totp/setup' }),
    'security.totpEnable': () => ({ method: 'POST', path: '/profile/2fa/totp/enable' }),
    'security.backupCodes': () => ({ method: 'POST', path: '/profile/2fa/backup-codes' }),

    'exhibitions.list': (payload) => ({ method: 'GET', path: '/exhibitions', query: payload }),
    'exhibitions.month': (payload) => ({ method: 'GET', path: '/exhibitions/month', query: payload }),
    'exhibitions.categories': () => ({ method: 'GET', path: '/exhibitions/categories' }),
    'exhibitions.get': (payload) => ({ method: 'GET', path: `/exhibitions/${encodeURIComponent(payload.id)}` }),
    'exhibitions.save': (payload) => (payload.id
        ? { method: 'PUT', path: `/exhibitions/${encodeURIComponent(payload.id)}` }
        : { method: 'POST', path: '/exhibitions' }),
    'exhibitions.delete': (payload) => ({ method: 'DELETE', path: `/exhibitions/${encodeURIComponent(payload.id)}` }),
    'exhibitions.status': (payload) => ({ method: 'PUT', path: `/exhibitions/${encodeURIComponent(payload.id)}/status` }),
    'exhibitions.fields': (payload) => ({ method: 'GET', path: `/exhibitions/${encodeURIComponent(payload.id)}/fields` }),
    'exhibitions.saveFields': (payload) => ({ method: 'PUT', path: `/exhibitions/${encodeURIComponent(payload.id)}/fields` }),

    'registrations.list': () => ({ method: 'GET', path: '/registrations' }),
    'registrations.get': (payload) => ({ method: 'GET', path: `/registrations/${encodeURIComponent(payload.id)}` }),
    'registrations.submit': () => ({ method: 'POST', path: '/registrations' }),
    'registrations.cancel': (payload) => ({ method: 'DELETE', path: `/registrations/${encodeURIComponent(payload.id)}` }),

    'review.list': (payload) => ({ method: 'GET', path: '/review', query: payload }),
    'review.get': (payload) => ({ method: 'GET', path: `/review/${encodeURIComponent(payload.id)}` }),
    'review.updateStatus': (payload) => ({ method: 'PUT', path: `/review/${encodeURIComponent(payload.id)}/status` }),

    'checkin.scan': () => ({ method: 'POST', path: '/checkin' }),

    'users.list': (payload) => ({ method: 'GET', path: '/users', query: payload }),
    'users.get': (payload) => ({ method: 'GET', path: `/users/${encodeURIComponent(payload.id)}` }),
    'users.status': (payload) => ({ method: 'PUT', path: `/users/${encodeURIComponent(payload.id)}/status` }),
    // 管理员关闭他人两步验证：用户邮箱用不了时唯一的兜底出口
    'users.disable2fa': (payload) => ({ method: 'PUT', path: `/users/${encodeURIComponent(payload.id)}/two-factor` }),
    'users.public': (payload) => ({ method: 'GET', path: '/users/public', query: payload }),

    'search.query': (payload) => ({ method: 'GET', path: '/search', query: payload }),

    'settings.get': () => ({ method: 'GET', path: '/settings' }),
    'settings.save': () => ({ method: 'PUT', path: '/settings' }),
    'settings.uiMode': () => ({ method: 'PUT', path: '/settings/ui-mode' }),
};

/** GET 查询串：丢掉空值，值统一编码。 */
function queryString(query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : '';
}

/**
 * 请求的定位信息，用于传输层错误的文案：`exhibitions.list GET /exhibitions`。
 * 只说「后端返回 502」时，日志里根本看不出是哪个动作、哪条路径挂了。
 */
function requestLabel(action, method, url) {
    const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
    return `${action} ${method} ${path}`;
}

/**
 * 发一次请求。
 *
 * 状态码的用法（与 server/README.md 的「响应约定」一致）：
 * - 2xx：正常。写接口的 `{ ok:false, error }` 也走这条路，抛成业务错误由页面就地提示；
 * - 401：访问令牌过期 → 用刷新令牌换一次再重试；换不到就当业务错误抛出；
 * - 403 / 404 等 4xx：业务错误，抛出后由页面提示；
 * - 5xx / 连不上 / 超时：传输层失败，抛 `TransportError` 并带上排查提示（数据只在后端，没有第二个数据源）。
 */
async function callRemote(action, payload) {
    const spec = ENDPOINTS[action];
    if (!spec) {
        throw new TransportError(`未映射到后端接口的动作：${action}`);
    }
    const request = spec(payload || {});
    const url = `${BASE_URL}${request.path}${queryString(request.query)}`;
    const body = request.method === 'GET' ? undefined : JSON.stringify(request.body === undefined ? payload || {} : request.body);

    let response = await httpFetch(url, request.method, body, action);
    // 只续期一次：重试不再回判断，因此不会出现「401 → 续期 → 401 → 续期」的循环。
    if (response.status === 401 && refreshToken) {
        const renewed = await renewSession();
        if (renewed) {
            response = await httpFetch(url, request.method, body, action);
        }
    }
    if (response.status >= 500) {
        throw new TransportError(`后端返回 ${response.status}（${requestLabel(action, request.method, request.path)}）`);
    }
    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new TransportError(`响应不是合法 JSON：${error.message}`);
    }
    if (!response.ok) {
        // 4xx：把后端的错误文案交给页面，属于业务失败。
        throw new Error(data?.error || `请求失败（${response.status}）`);
    }
    if (data && data.ok === false && data.error) {
        throw new Error(data.error);
    }
    return data;
}

/**
 * 底层 fetch：连不上、超时、被中断都转成带排查提示的 TransportError。
 *
 * 数据只在后端，连不上时页面能做的只有把原因说清楚，所以这里把「后端没起」
 * 和「端口没转发」这两个最常见的原因直接写进错误文案。
 *
 * 「超时」必须与「连不上」分开报：`AbortController` 到点中断走的也是异常，
 * 混在一起会把**应答慢**的后端说成「后端没起、请 adb reverse」，把排查方向带偏。
 */
async function httpFetch(url, method, body, action = '') {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT) : null;
    try {
        return await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
            },
            body,
            signal: controller?.signal,
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new TransportError(
                `后端响应超时（超过 ${REQUEST_TIMEOUT / 1000} 秒）：${action ? `${action} ` : ''}${method} ${url}。`
                + '后端可能正在处理一次较慢的查询，请稍后重试；'
                + '若每次都超时，请确认 server/ 已启动（pnpm dev），真机/模拟器还需要 adb reverse tcp:3000 tcp:3000。',
            );
        }
        throw new TransportError(
            `连不上后端服务（${BASE_URL}）：${error.message}。`
            + '请确认 server/ 已启动（pnpm dev），真机/模拟器还需要 adb reverse tcp:3000 tcp:3000。',
        );
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

/**
 * 用刷新令牌换一套新令牌。
 *
 * 访问令牌只有 15 分钟，没有这一步用户会在用着用着突然被登出。
 * 刷新失败（令牌被撤销或过期）返回 false，由调用方按业务错误抛出。
 */
let renewing = null;

function renewSession() {
    if (renewing) {
        return renewing;
    }
    renewing = (async () => {
        try {
            const response = await httpFetch(`${BASE_URL}/auth/refresh`, 'POST',
                JSON.stringify({ refreshToken }), 'auth.refresh');
            if (!response.ok) {
                return false;
            }
            const data = await response.json();
            if (!data?.token) {
                return false;
            }
            setToken(data.token);
            setRefreshToken(data.refreshToken);
            return true;
        } catch (ignored) {
            return false;
        } finally {
            renewing = null;
        }
    })();
    return renewing;
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

/**
 * **写操作**成功后要清掉的缓存前缀。
 *
 * 只列写动作：`request()` 在读取类接口返回后同样会调一次 `invalidate(action)`，
 * 给读动作填键等于「读一次就把别人的缓存干掉」，只会让缓存失去意义。
 * 这里曾经有一条 `'exhibitions.categories': []`：它是读动作，空数组又让
 * `invalidate()` 直接返回，两条加起来就是一行永远不生效的死配置，已删除。
 * （分类确实变了要失效时，应该挂在改分类的写动作上，例如 `settings.save`。）
 */
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
    // 关闭他人两步验证后，用户列表里的账号状态要重新取
    'users.disable2fa': ['users.'],
    // 换邮箱会改资料里的邮箱，也会影响公开页
    'security.verifyEmail': ['profile.', 'users.public'],
    // 分类由「管理-设置」维护，保存后展会分类缓存要一起作废。
    'settings.save': ['settings.', 'notify.', 'exhibitions.categories'],
    'settings.uiMode': ['settings.'],
    'notify.savePreferences': ['notify.'],
    'profile.save': ['profile.', 'users.public'],
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

/**
 * 缓存代号：`clearCache()` 每次自增。
 *
 * `cache.clear()` 只清掉已经写进去的条目，**清不掉还在飞的请求**：登出瞬间
 * 预加载的 `profile.get` / `users.list` 往往已经发出去了，回来时若无条件
 * `cache.set()`，就把上一个身份的数据写进了新会话，TTL 的 20 秒里新用户
 * 还能读到它。请求发出时记下代号，回写前比对，代号变了就整条丢弃。
 */
let cacheGeneration = 0;

export function onCacheClear(listener) {
    if (typeof listener === 'function') {
        clearListeners.push(listener);
    }
}

/** 清空全部缓存；登录 / 退出登录后调用，避免看到上一个身份的数据。 */
export function clearCache() {
    cacheGeneration += 1;
    cache.clear();
    // 在途请求也要一起作废：留着的话，新会话里同键的取数会直接复用上一个
    // 身份的 Promise（去重表按缓存键存），拿到的是旧数据。
    inflight.clear();
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
 * （实测 `bootstrap-done` 因此达到 5.6s）。这里直接发真实请求，连不上就把
 * 明确的错误抛给页面（数据只在后端，没有第二个数据源可以退回）。
 *
 * 业务失败（`ok: false`）同样原样抛给页面，不重试。
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

    // 发起这次请求时的缓存代号：中途 clearCache() 过，结果就不许再写回缓存。
    const generation = cacheGeneration;
    const task = callRemote(action, payload).then(
        (value) => {
            if (cacheable && value !== undefined && generation === cacheGeneration) {
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
        const done = () => {
            // 只摘掉自己这一条：clearCache() 之后同键可能已经排上了新一代的请求。
            if (inflight.get(key) === task) {
                inflight.delete(key);
            }
        };
        task.then(done, done);
    }
    return task;
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
                setRefreshToken(result.refreshToken);
            }
            // 换了身份，上一份缓存不再适用。
            clearCache();
            return result;
        },
        /**
         * 注册第一步：只校验并请求发码，**后端此时不建账号、不发令牌**。
         * 待建账号暂存在后端的验证码记录里，验证通过（registerVerify）才落库。
         */
        register: (payload) => request('auth.register', payload),
        /** 注册第二步：验证码通过，后端建号并发令牌，这里才切到已登录状态。 */
        registerVerify: async (payload) => {
            const result = await request('auth.registerVerify', payload);
            if (result?.token) {
                setToken(result.token);
                setRefreshToken(result.refreshToken);
            }
            // 换了身份，上一份缓存不再适用。
            clearCache();
            return result;
        },
        guest: () => request('auth.guest'),
        /**
         * 两步验证第二步：预认证票 + 验证码换真正的会话。
         * 这一步才保存令牌 —— 第一步（login）只回一张票，密码对了还不算登录。
         */
        loginVerify: async (payload) => {
            const result = await request('auth.loginVerify', payload);
            if (result?.token) {
                setToken(result.token);
                setRefreshToken(result.refreshToken);
            }
            clearCache();
            return result;
        },
        /** 两步验证：用同一张预认证票重发验证码（票据没被消费掉就还有效）。 */
        loginCode: (ticket) => request('auth.loginCode', { ticket }),
        /**
         * 找回密码第一步：请求发码。
         * 后端**不区分邮箱是否存在**（响应与耗时都一样），所以页面不能拿「返回成功」当成
         * 「这个邮箱注册过」，提示语要写「如果该邮箱已注册」。
         */
        forgotPassword: (email) => request('auth.forgotPassword', { email }),
        /** 找回密码第二步：验证码 + 新密码。成功后后端会撤销该用户全部刷新令牌。 */
        resetPassword: (payload) => request('auth.resetPassword', payload),
        logout: async () => {
            // 先把刷新令牌交给后端撤销，再清本地状态：否则退出后令牌仍然有效。
            const result = await request('auth.logout', { refreshToken })
                .catch(() => ({ ok: false, error: '' }));
            setToken('');
            setRefreshToken('');
            clearCache();
            return result;
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

    /**
     * 安全设置：邮箱与两步验证。
     *
     * `get` 故意**不进缓存**：开关的状态必须跟库里的真实值一致，
     * 拿一份 20 秒前的缓存去渲染「已开启」会让人以为改动没生效。
     */
    security: {
        get: () => request('security.get'),
        /** 开启两步验证第一步：发码到已验证邮箱（开启也要过码）。 */
        enableTwoFactor: () => request('security.enable2fa'),
        verifyTwoFactor: (code) => request('security.verify2fa', { code }),
        disableTwoFactor: (password) => request('security.disable2fa', { password }),
        /** 改邮箱第一步：码发到**新**地址。 */
        changeEmail: (email) => request('security.changeEmail', { email }),
        /** 改邮箱第二步：通过才落库（账号因此永远处于「邮箱已验证」状态）。 */
        verifyEmail: async (email, code) => {
            const result = await request('security.verifyEmail', { email, code });
            if (result?.ok) {
                clearCache();
            }
            return result;
        },
        /** 绑定验证器第一步：拿到 base32 密钥与 otpauth 地址（**此时还没生效**）。 */
        totpSetup: () => request('security.totpSetup'),
        /** 绑定验证器第二步：输对码才生效，并带回一批备用码（只出现这一次）。 */
        totpEnable: (code) => request('security.totpEnable', { code }),
        /** 重新生成备用码（旧的一次性码全部作废），要当前密码。 */
        backupCodes: (password) => request('security.backupCodes', { password }),
    },

    // ── 展会 ───────────────────────────────────────────────────────
    exhibitions: {
        list: reader('exhibitions.list'),
        /** 月视图：只带 year / month（day 可选），见 README「月视图与日历落点」 */
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
        /** 管理员关闭某账号的两步验证：用户邮箱用不了时唯一的兜底出口。 */
        disableTwoFactor: (id) => request('users.disable2fa', { id, enabled: false }),
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
/** 安全设置（邮箱与两步验证）：个人页要它，与 profile 分开是为了语义清楚。 */
export const securityApi = api.security;

// 具名导出：页面按域导入，例如 `import { exhibitions } from '../core/api.js'`。
export const {
    bootstrap, auth, profile, exhibitions, registrations, review, checkIn, users,
    search, settings, security,
} = api;
