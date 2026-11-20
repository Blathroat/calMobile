/**
 * 展会详情的编辑入口：管理员与这场展会的创建者在右上角看到一颗小铅笔（在分享按钮左边），
 * 点击进入编辑页；普通用户与其他展商看不到。
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

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { get: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
vi.mock('@/services/device-services', () => ({
  device: { calendarStatus: vi.fn(async () => ({ inCalendar: false, granted: false })) },
}));

const DETAIL: ExhibitionDetail = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    date: '2026-09-20',
    time: '09:00-17:00',
    venue: '会展中心',
    exhibitor: '示例展商',
    exhibitorId: 'exhibitor-1',
    openForRegistration: true,
  },
};

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="detail-test"></div>';
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
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

/** 顶栏里按 aria-label 找图标按钮。 */
function topButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('#app-top-actions button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );
}

async function mountDetail(user?: Record<string, unknown>): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  if (user) useSessionStore().applyUser(user as never);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/detail/:id', component: DetailPage },
      { path: '/exhibition-form/:id', component: { template: '<div />' } },
      { path: '/registration-form/:id', component: { template: '<div />' } },
      { path: '/registration-detail/:id', component: { template: '<div />' } },
    ],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/detail/exh-1');
  app = createApp(DetailPage).use(pinia).use(router);
  app.mount('#detail-test');
  await flush();
  return router;
}

describe('展会详情：编辑入口', () => {
  it('管理员看到编辑铅笔，点击进入编辑页', async () => {
    const router = await mountDetail({ id: 'admin-1', role: 'admin', loggedIn: true, can: { admin: true } });
    const edit = topButton('编辑展会');
    expect(edit).not.toBeUndefined();
    // 分享按钮必须在；铅笔在它的左边（同一行顶栏操作区）。
    const share = topButton('分享展会');
    expect(share).not.toBeUndefined();
    expect(edit!.compareDocumentPosition(share!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    edit!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1'));
  });

  it('展会创建者（展商本人）也能看到并进入编辑页', async () => {
    const router = await mountDetail({ id: 'exhibitor-1', role: 'exhibitor', loggedIn: true, can: {} });
    topButton('编辑展会')!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1'));
  });

  it('普通用户与其他展商看不到编辑入口', async () => {
    await mountDetail({ id: 'user-1', role: 'user', loggedIn: true, can: {} });
    expect(topButton('编辑展会')).toBeUndefined();
    expect(topButton('分享展会')).not.toBeUndefined();

    app?.unmount();
    document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="detail-test"></div>';
    await mountDetail({ id: 'exhibitor-2', role: 'exhibitor', loggedIn: true, can: {} });
    expect(topButton('编辑展会')).toBeUndefined();
  });
});
