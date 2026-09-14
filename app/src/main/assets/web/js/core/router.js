/**
 * 哈希路由。
 *
 * 每个页面对应独立的 ES 模块文件（screen-file-first），模块自行渲染所需区域；
 * 路由只负责页面切换、URL 同步与浏览器/系统返回键。
 */

import { state } from './bridge.js';
import { renderShell, topbar, icon } from '../ui/components.js';
import { el, append, qs } from './dom.js';

const routes = new Map();
let current = null;
let onNavigate = null;

export function defineRoute(id, options) {
    routes.set(id, { id, ...options });
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

export function currentRoute() {
    return current;
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
            topbar: topbar({ title: definition.title || '出错了', showBack: false }),
            body: [
                el('div', { class: 'state', dataset: { tone: 'error' } }, [
                    el('strong', { text: '页面加载失败' }),
                    el('p', { class: 'muted', text: error instanceof Error ? error.message : String(error) }),
                    el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => render(),
                    }, ['重试']),
                ]),
            ],
        });
    }

    document.title = `${definition.title || 'CalMobile'} · CalMobile`;
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
    return render();
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

/** 角色化底部导航；与 newUI 的 tab 文案一致。 */
export function tabbar({ items, active }) {
    const bar = el('nav', { class: 'tabbar', 'aria-label': '底部导航' });
    for (const item of items) {
        append(bar, el('button', {
            class: 'tab',
            type: 'button',
            'aria-current': item.id === active ? 'page' : null,
            onclick: () => navigate(item.id, {}, { replace: item.id === active }),
        }, [icon(item.icon, 'icon'), el('span', { text: item.label })]));
    }
    return bar;
}

/** 导航项按角色过滤，与旧版 MainActivity 的四标签可见性规则一致。 */
export function navItems() {
    const items = [
        { id: 'home', label: '首页', icon: 'home' },
        { id: 'my-registrations', label: '我的报名', icon: 'ticket' },
    ];
    const can = state.user.can || {};
    if (can.exhibitor) {
        items.push({ id: 'exhibitor', label: '展商', icon: 'briefcase' });
    }
    if (can.admin) {
        items.push({ id: 'admin', label: '管理', icon: 'shield' });
    }
    items.push({ id: 'profile', label: '个人', icon: 'user' });
    return items;
}
