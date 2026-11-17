/**
 * 报名站的展会详情：不请求原生日历、底部只留「立即报名」，未登录也能直接报名；
 * 未登录点展商公开页要先登录并带 `redirect=/u/<昵称>`。
 *
 * 报名站是另一份构建（`VITE_SURFACE=join`），这里把 `@/app/surface` 换成报名站版本，
 * 与 `registration-join-flow.test.ts` 用的是同一种做法。闭展日期也在这条用例里一起看。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import DetailPage from './DetailPage.vue';
import { api } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useSessionStore } from '@/stores/session';
import type { ExhibitionDetail } from '@/api/types';

vi.mock('@/app/surface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/surface')>();
  return { ...actual, isJoinSurface: true, paths: actual.surfacePaths(true) };
});
vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { get: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
// 报名站没有原生日历：一旦有人误请求，这里会留下调用记录，用例据此断言。
vi.mock('@/services/device-services', () => ({
  device: {
    calendarStatus: vi.fn(async () => ({ inCalendar: false, granted: false })),
    toggleCalendar: vi.fn(async () => ({ inCalendar: true, granted: true })),
  },
}));

const DETAIL: ExhibitionDetail = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    date: '2026-11-17',
    endDate: '2026-11-22',
    time: '09:00-17:00',
    venue: '会展中心',
    exhibitor: '示例展商',
    openForRegistration: true,
  },
};

const EXHIBITOR_PATH = `/u/${encodeURIComponent('示例展商')}`;

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML =
    '<div id="app-foot"></div><div id="app-top-actions"></div><div id="join-detail-test"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue(DETAIL);
  vi.mocked(api.registrations.list).mockResolvedValue([]);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  navigation.cancel();
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')];
}

function mainButton(): HTMLButtonElement | undefined {
  return buttons().find((button) => button.classList.contains('cta') && !button.classList.contains('ghost'));
}

async function mountDetail(options: { loggedIn?: boolean } = {}): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  if (options.loggedIn) {
    useSessionStore().applyUser({
      id: 'u1',
      username: 'user',
      loggedIn: true,
      can: { register: true },
    });
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/e/:id', component: DetailPage },
      { path: '/e/:id/register', component: { template: '<div />' } },
      { path: '/mine/:id', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
      { path: '/u/:nickname', component: { template: '<div />' } },
    ],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/e/exh-1');
  app = createApp(DetailPage).use(pinia).use(router);
  app.mount('#join-detail-test');
  await vi.waitFor(() => expect(mainButton()).not.toBeUndefined());
  return router;
}

function exhibitorCard(): HTMLButtonElement {
  const card = document.querySelector<HTMLButtonElement>('#join-detail-test .row-card');
  if (!card) throw new Error('缺少展商卡片');
  return card;
}

describe('报名站展会详情', () => {
  it('底部不摆「加入日历」，只留一颗占满宽度的「立即报名」，也不请求原生日历', async () => {
    await mountDetail();
    await flush();

    expect(buttons()).toHaveLength(1);
    expect(document.querySelector('#app-foot .cta.ghost')).toBeNull();
    expect(mainButton()?.textContent?.trim()).toBe('立即报名');
    expect(mainButton()?.disabled).toBe(false);
    const { device } = await import('@/services/device-services');
    expect(device.calendarStatus).not.toHaveBeenCalled();
  });

  it('未登录点「立即报名」直接进免登录报名表单，不弹先登录', async () => {
    const router = await mountDetail();
    await flush();
    mainButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/register'));
  });

  it('已登录时仍按原有逻辑进报名表单', async () => {
    const router = await mountDetail({ loggedIn: true });
    await flush();
    mainButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/register'));
  });

  it('未登录点展商卡片先登录，并带上公开页回跳地址', async () => {
    const router = await mountDetail();
    await flush();
    exhibitorCard().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'));
    expect(router.currentRoute.value.query.redirect).toBe(EXHIBITOR_PATH);
  });

  it('已登录点展商卡片直接进公开页', async () => {
    const router = await mountDetail({ loggedIn: true });
    await flush();
    exhibitorCard().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(EXHIBITOR_PATH));
  });

  it('信息卡把闭展日期显示成日期区间', async () => {
    await mountDetail();
    await flush();
    const text = document.querySelector('#join-detail-test .card')?.textContent ?? '';
    expect(text).toContain('11月17日（周二） - 11月22日（周日）');
    expect(text).toContain('09:00-17:00');
  });
});
