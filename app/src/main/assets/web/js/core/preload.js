/**
 * 预加载：把「用户下一步大概率要点的地方」提前拉进只读缓存。
 *
 * 配合 core/loadable.js 的「先画缓存」策略，切页面时数据已经在缓存里，
 * 于是不再出现「先闪一下骨架屏」的空档。预加载永远不阻塞当前操作：
 * 任务排进空闲回调，一次只发一个请求，失败静默。
 *
 * 两类目标：
 *
 * - `preloadTabs()` —— 底部导航能直达的几个页面（切页面最频繁）；
 * - `preloadFollowUps()` —— 当前页面的下一步（相邻月份、列表首项的详情）。
 */

import { state } from './bridge.js';
import { warm, exhibitions, registrations, onCacheClear } from './api.js';

/** 一次只跑一个任务，避免预加载和当前页面的请求抢带宽。 */
const queue = [];
const done = new Set();
let draining = false;

/** 换了身份（登录 / 退出）后缓存被清空，预热标记与排队中的目标一起作废。 */
onCacheClear(() => {
    done.clear();
    // 旧队列必须一起丢掉：目标已经在下一代重新排队，留着只会让新任务排在旧任务后面，
    // 而排空速度是「一次空闲回调跑一个」，积压起来后切页面要等很久才热身。
    queue.length = 0;
});

function idle(callback) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(callback, { timeout: 1000 });
    } else {
        setTimeout(callback, 120);
    }
}

/** 排一个预加载任务；同一个目标只排一次，避免切页面时重复热身。 */
function enqueue(label, task) {
    if (done.has(label)) {
        return;
    }
    done.add(label);
    queue.push(task);
    if (!draining) {
        draining = true;
        idle(drain);
    }
}

function drain() {
    const task = queue.shift();
    if (!task) {
        draining = false;
        return;
    }
    Promise.resolve()
        .then(task)
        .catch(() => undefined)
        .then(() => idle(drain));
}

/** 立即预取（不进队列）：用于「手指刚按下」这种要抢在点击处理之前起跑的场景。 */
function fire(action, payload) {
    warm(action, payload).catch(() => undefined);
}

/**
 * 标签页数据。
 *
 * 顺序即优先级：首页最常用，其次是我的报名，个人页每次渲染都要读，
 * 展商后台与管理后台只在有权限时预热。
 *
 * 首页目标的键带上解析后的年月：`bootstrap` 落定前拿到的是默认落点
 * （`2026-6`），真实落点是后端下发的 `state.calendar.landing`——键里不带参数
 * 时，先热过的默认月份会把真实落点永久挡在 `done` 外面，整个会话都不再预热。
 * 代价只是默认月份多一次无害的预热，换来的规则很直白：**参数变了就重新预热**，
 * 以后新增带参数的首页目标不会再踩同一个坑。
 */
export function preloadTabs() {
    const [homeAction, homeQuery] = homeRead();
    const reads = [
        [`home-${homeQuery.year}-${homeQuery.month}`, homeAction, homeQuery],
        ['my-registrations', 'registrations.list', undefined],
    ];
    if (state.user.loggedIn) {
        reads.push(['profile', 'profile.get', undefined]);
    }
    if (state.user.can?.exhibitor) {
        reads.push(['exhibitor', 'exhibitions.list', {}]);
    }
    if (state.user.can?.admin) {
        reads.push(['admin', 'users.list', { query: '' }]);
        reads.push(['admin-settings', 'settings.get', undefined]);
    }
    for (const [label, action, payload] of reads) {
        enqueue(label, () => warm(action, payload));
    }
}

/**
 * 当前页面的下一步。
 *
 * @param {string} routeId 路由 id
 * @param {object} params  路由参数
 */
export function preloadFollowUps(routeId, params = {}) {
    if (routeId === 'home') {
        // 相邻月份：左右滑动时目标月份已经在缓存里。
        warmMonths(params);
        const month = exhibitions.month.peek(homeParams(params));
        warmFirstDetails(month?.exhibitions, exhibitions.get, 'exhibition');
        return;
    }
    if (routeId === 'my-registrations') {
        warmFirstDetails(registrations.list.peek(), registrations.get, 'registration');
        return;
    }
    if (routeId === 'exhibitor' || routeId === 'admin') {
        for (const item of exhibitions.list.peek({ query: '' }) || []) {
            if (item?.id) {
                enqueue(`exhibition-${item.id}`, () => warm(exhibitions.get.action, { id: item.id }));
            }
        }
    }
}

/**
 * 月视图的规范请求参数。
 *
 * 只带 year / month 两个键，且都归一成数字：页面与预加载必须发**一模一样**的
 * 形状，缓存键才会一致，预加载才打得中（见 api.js 的 cacheKey）。
 */
export function homeParams(view = {}) {
    const landing = state.calendar?.landing || {};
    return {
        year: Number(view.year) || Number(landing.year) || 2026,
        month: Number(view.month) || Number(landing.month) || 6,
    };
}

/** 首页要看的那个月。 */
function homeRead() {
    return ['exhibitions.month', homeParams()];
}

/** 左右相邻的月份：滑动手势最需要它们已经在缓存里。 */
function warmMonths(view) {
    const { year, month } = homeParams(view);
    for (const delta of [1, -1]) {
        const total = (year * 12) + (month - 1) + delta;
        const target = { year: Math.floor(total / 12), month: (total % 12) + 1 };
        enqueue(`month-${target.year}-${target.month}`, () => warm('exhibitions.month', target));
    }
}

/**
 * 列表首项的详情。
 *
 * 数据直接从缓存里读（页面刚渲染完，缓存一定有），因此不需要额外请求，
 * 只是把「点进去」要看的那一份提前拉回来。
 */
function warmFirstDetails(items, readDetail, kind) {
    for (const item of (items || []).slice(0, 2)) {
        if (item?.id) {
            enqueue(`${kind}-${item.id}`, () => warm(readDetail.action, { id: item.id }));
        }
    }
}

/**
 * 「手指按下就先取数」的事件属性。
 *
 * 列表行的点击处理器要等手势判定完成才执行，中间有几十毫秒；在 pointerdown
 * 就起跑，点进详情页时数据往往已经到了，详情页因此也能直接出内容。
 *
 * 用法：`el('button', { class: 'row-card', ...warmOnPress(exhibitions.get, { id }) })`
 */
export function warmOnPress(read, payload) {
    const action = read?.action || read;
    return {
        onpointerdown: () => fire(action, payload),
    };
}
