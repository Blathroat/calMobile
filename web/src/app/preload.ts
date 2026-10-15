/**
 * 预加载：把「下一步大概率要看的数据」提前放进查询缓存。
 *
 * master 的 `core/preload.js` 就是做这件事：切到底部导航或点进详情时数据已经在缓存里，
 * 因此不会先闪一下骨架屏。这里保留同样的策略，但更简单 —— 只排进空闲回调、
 * 一次只发一个请求、失败静默，并且目标去重（参数变了才重新预热）。
 *
 * 缓存本身在 `services/query-cache.ts`，与页面自己的请求天然去重：
 * 预热和页面同时取同一份数据只会发一次请求。
 */
import { api } from '@/app/runtime';
import { isJoinSurface } from '@/app/surface';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';

const done = new Set<string>();
let queue: Array<() => Promise<unknown>> = [];
let draining = false;

/** 身份变化（登录 / 退出）后缓存被清空，预热标记与排队目标一起作废。 */
export function resetPreload(): void {
  done.clear();
  queue = [];
}

function idle(task: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 1000 });
  } else {
    window.setTimeout(task, 120);
  }
}

/** 排一个预热任务：同一个目标只排一次，避免来回切页面时重复热身。 */
function enqueue(label: string, task: () => Promise<unknown>): void {
  if (done.has(label)) return;
  done.add(label);
  queue.push(task);
  if (draining) return;
  draining = true;
  idle(drain);
}

function drain(): void {
  const task = queue.shift();
  if (!task) {
    draining = false;
    return;
  }
  task()
    .catch(() => undefined)
    .then(() => idle(drain));
}

/** 首页落点月份：与 `HomePage` 用同一套参数，键一致才命中缓存。 */
function homeMonth(): { year: number; month: number } {
  const landing = useBootstrapStore().calendar.landing;
  const info = (landing && typeof landing === 'object' ? landing : {}) as Record<string, unknown>;
  return {
    year: Number(info.year) || new Date().getFullYear(),
    month: Number(info.month) || new Date().getMonth() + 1,
  };
}

/** 底部导航能直达的几个页面（切换最频繁）。 */
export function preloadTabs(): void {
  const session = useSessionStore();
  if (isJoinSurface) {
    if (session.loggedIn) enqueue('my-registrations', () => api.registrations.list());
    return;
  }
  const { year, month } = homeMonth();
  // 首页的键带上落点年月：参数变了就重新预热，否则真实落点会被默认月份永久挡住。
  enqueue(`home-${year}-${month}`, () => api.exhibitions.month({ year, month }));
  enqueue('my-registrations', () => api.registrations.list());
  if (session.loggedIn) {
    enqueue('profile', () => api.profile.get());
    enqueue('notifications', () => api.profile.notifications());
  }
  if (session.user.can?.exhibitor) {
    enqueue('exhibitions', () => api.exhibitions.list({}));
  }
  if (session.user.can?.admin) {
    enqueue('users', () => api.users.list({ query: '' }));
    enqueue('settings', () => api.settings.get());
  }
}

/** 相邻月份：左右滑动切月时目标月份已经在缓存里。 */
export function preloadAdjacentMonths(year: number, month: number): void {
  for (const delta of [1, -1]) {
    const total = year * 12 + (month - 1) + delta;
    const target = { year: Math.floor(total / 12), month: (total % 12) + 1 };
    enqueue(`month-${target.year}-${target.month}`, () => api.exhibitions.month(target));
  }
}
