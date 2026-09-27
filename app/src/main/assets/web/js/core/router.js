import { t } from './strings.js';
/**
 * 哈希路由。
 *
 * 每个页面对应独立的 ES 模块文件（screen-file-first），模块自行渲染所需区域；
 * 路由只负责页面切换、URL 同步与浏览器/系统返回键。
 */

import { state, mark } from './bridge.js';
import { renderShell, topbar, icon } from '../ui/components.js';
import { el, append, qs } from './dom.js';

const routes = new Map();
let current = null;
let onNavigate = null;
/** 首次渲染的 Promise，供 whenStarted() 等待。 */
let started = null;
/** 当前页面注册的清理回调（摄像头、定时器等），页面被替换前执行。 */
let pageStopHandlers = [];

export function defineRoute(id, options) {
    routes.set(id, { id, ...options });
}

/**
 * 注册当前页面的清理回调：页面被下一次渲染替换前调用。
 * 用于释放摄像头、定时器这类跨渲染存活的资源。
 */
export function onPageStop(handler) {
    if (typeof handler === 'function') {
        pageStopHandlers.push(handler);
    }
}

/** 执行并清空清理回调；单个回调出错不影响其它回调与页面切换。 */
function runPageStopHandlers() {
    const handlers = pageStopHandlers;
    pageStopHandlers = [];
    for (const handler of handlers) {
        try {
            handler();
        } catch (error) {
            console.error(error);
        }
    }
}

/** 注册路由变化监听，app.js 用它同步底部导航。 */
export function onRouteChange(listener) {
    onNavigate = listener;
}

export function routeOf(hash = location.hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const [id, queryString] = raw.split('?');
    const params = {};
    if (queryString) {
        for (const pair of queryString.split('&')) {
            const [key, value] = pair.split('=');
            if (key) {
                params[decodeURIComponent(key)] = decodeURIComponent(value || '');
            }
        }
    }
    return { id: id || 'login', params };
}

export function navigate(id, params = {}, options = {}) {
    const query = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    const hash = `#/${id}${query ? `?${query}` : ''}`;
    if (location.hash === hash) {
        setDirection('none');
        render(options);
        return;
    }
    if (options.replace) {
        history.replaceState({ id, params }, '', hash);
        setDirection('replace');
        render(options);
        return;
    }
    history.pushState({ id, params }, '', hash);
    setDirection('forward');
    render(options);
}

export function back(fallback = 'home') {
    if (history.length > 1 && current && current.id !== 'login') {
        setDirection('back');
        history.back();
        return;
    }
    setDirection('back');
    navigate(fallback, {}, { replace: true });
}

/** 页面切换方向：驱动 tokens 中的滑入 / 滑出动画。 */
function setDirection(direction) {
    if (typeof document === 'undefined') {
        return;
    }
    const app = document.getElementById('app');
    if (app) {
        app.dataset.direction = direction;
    }
}

/** 角色允许访问的页面；无权访问时回退到首页并说明。 */
function guard(route) {
    const can = state.user.can || {};
    if (route.roles) {
        const role = state.user.role || 'guest';
        if (!route.roles.includes(role)) {
            return { id: 'home', params: {}, denied: route.title || route.id };
        }
    }
    if (route.requires === 'auth' && !state.user.loggedIn) {
        // 保留当前页面的参数，登录后可以原样返回。
        const redirectParams = Object.entries(route.params || {})
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join('&');
        return {
            id: 'login',
            params: {
                redirect: route.id,
                ...(redirectParams ? { redirectParams } : {}),
            },
        };
    }
    return route;
}

export async function render() {
    let route = routeOf();
    let definition = routes.get(route.id) || routes.get('home');
    const resolved = guard({ ...definition, ...route });
    if (resolved.id !== route.id) {
        history.replaceState({ id: resolved.id, params: resolved.params }, '',
            `#/${resolved.id}`);
        route = { id: resolved.id, params: resolved.params };
        definition = routes.get(route.id) || routes.get('home');
    }

    // 先释放上一页占用的资源（例如扫码页的摄像头），再渲染新页面。
    runPageStopHandlers();
    current = { id: route.id, params: route.params, definition, denied: resolved.denied };
    const context = {
        params: route.params,
        route: current,
        navigate,
        back,
        refresh: render,
    };

    try {
        await definition.render(context);
    } catch (error) {
        console.error(error);
        renderShell(qs('#app'), {
            topbar: topbar({ title: definition.title || t('s_8peqwe'), showBack: false }),
            body: [
                el('div', { class: 'state', dataset: { tone: 'error' } }, [
                    el('strong', { text: t('s_dte5kz') }),
                    el('p', { class: 'muted', text: error instanceof Error ? error.message : String(error) }),
                    el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => render(),
                    }, [t('s_lswd2v')]),
                ]),
            ],
        });
    }

    document.title = `${definition.title || state.brand.zh} · ${state.brand.zh}`;
    mark(`page:${route.id}`);
    onNavigate?.(current);
}

export function start(defaultId = 'login') {
    if (!location.hash) {
        history.replaceState({ id: defaultId }, '', `#/${defaultId}`);
    }
    setDirection('none');
    // 浏览器/系统返回键与页面内返回按钮共用同一套方向动画。
    window.addEventListener('popstate', () => {
        setDirection('back');
        render();
    });
    window.addEventListener('hashchange', () => render());
    started = render();
    return started;
}

/**
 * 等待应用完成首次渲染。
 * 首次渲染要等 bootstrap（可能是异步的远端请求）落定后再执行，因此测试与
 * 其它需要“页面已经就绪”的场景应当 await 它，而不是自己猜时序。
 */
export function whenStarted() {
    return started || Promise.resolve();
}

/** 最近一次 render 进入的页面。未注册的 id 使用首页的定义。 */
export function currentRoute() {
    return current;
}

// ── 布局辅助 ──────────────────────────────────────────────────────

/** 标准二级页：返回 + 标题 + 可选右侧操作；bodyProps 用于设置内容区密度。 */
export function scaffold({ title, actions = [], children, showBack = true, foot, backTo = 'home', bodyProps = {} }) {
    const body = el('main', { class: 'app-body route-enter', ...bodyProps });
    append(body, children);
    renderShell(qs('#app'), {
        topbar: topbar({
            title,
            showBack,
            actions,
            onBack: () => back(backTo),
        }),
        body: [body],
        tabbar: foot || null,
    });
    return body;
}

/** 顶部页面级操作按钮。 */
export function topAction(name, label, onClick) {
    return el('button', {
        class: 'icon-button',
        type: 'button',
        'aria-label': label,
        title: label,
        onclick: onClick,
    }, [icon(name)]);
}

/** 角色化底部导航；与 newUI 的 tab 文案一致，选中指示条在切换时滑动过去。 */
export function tabbar({ items, active }) {
    const bar = el('nav', { class: 'tabbar', 'aria-label': t('s_1fe4wn6') });
    const indicator = el('span', { class: 'tabbar-indicator', 'aria-hidden': 'true' });
    append(bar, indicator);

    const buttons = [];
    for (const item of items) {
        const button = el('button', {
            class: 'tab',
            type: 'button',
            'aria-current': item.id === active ? 'page' : null,
            onclick: () => navigate(item.id, {}, { replace: item.id === active }),
        }, [icon(item.icon, 'icon'), el('span', { text: item.label })]);
        buttons.push(button);
        append(bar, button);
    }

    // 首次定位不加过渡，之后的切换由 CSS 负责滑动。
    const position = () => {
        const current = buttons.find((button) => button.getAttribute('aria-current') === 'page');
        if (!current || current.offsetWidth === 0) {
            indicator.dataset.hidden = 'true';
            return;
        }
        indicator.dataset.hidden = 'false';
        indicator.style.transform = `translate3d(${current.offsetLeft + (current.offsetWidth / 2)}px, 0, 0)`;
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            position();
            indicator.dataset.ready = 'true';
        });
    }
    return bar;
}

/** 导航项按角色过滤，与旧版 MainActivity 的四标签可见性规则一致。 */
export function navItems() {
    const items = [
        { id: 'home', label: t('s_1ow5v10'), icon: 'home' },
        { id: 'my-registrations', label: t('s_1m2dh8u'), icon: 'ticket' },
    ];
    const can = state.user.can || {};
    if (can.exhibitor) {
        items.push({ id: 'exhibitor', label: t('s_1mdxfsy'), icon: 'briefcase' });
    }
    if (can.admin) {
        items.push({ id: 'admin', label: t('s_pzy8ri'), icon: 'shield' });
    }
    items.push({ id: 'profile', label: t('s_8ddpxh'), icon: 'user' });
    return items;
}
