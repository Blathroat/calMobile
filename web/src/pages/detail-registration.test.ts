/**
 * 展会详情的报名入口：已报名本场时底部主按钮变「查看我的报名」，点击进报名详情页；
 * 未报名 / 已撤销 / 列表失败 / 访客都保持原来的「立即报名」，且访客不发 registrations 请求。
 *
 * 挂载方式仿 page-loading.test.ts / rich-editor.test.ts：mock `@/app/runtime`，
 * 用真实 pinia + 内存路由把页面挂到 jsdom 里。
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
// 日历状态走原生桥；这里只关心报名按钮，给出一个稳定的「未加入」结果。
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
    exhibitorRole: 'exhibitor',
    openForRegistration: true,
  },
};

/** 已关闭报名、且账号被限制的展会：用来验证「已报名」不受这两条限制。 */
const CLOSED_DETAIL: ExhibitionDetail = {
  found: true,
  exhibition: { id: 'exh-1', title: '秋季展会', date: '2026-09-20', openForRegistration: false },
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

/** 让已经 resolve 的 promise 链与重渲染跑完。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

/** 底部主按钮：日历 / 报名两颗里不带 ghost 的那颗。 */
function registerButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].find(
    (button) => button.classList.contains('cta') && !button.classList.contains('ghost'),
  );
}

function footerHint(): string {
  return document.querySelector('#app-foot .field-hint')?.textContent ?? '';
}

async function mountDetail(
  options: { loggedIn?: boolean; canRegister?: boolean; detail?: ExhibitionDetail } = {},
): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 不调用 applyUser 就是访客态（初始 session）。
  if (options.loggedIn) {
    useSessionStore().applyUser({
      id: 'u1',
      username: 'user',
      loggedIn: true,
      can: { register: options.canRegister !== false },
    });
  }
  if (options.detail) vi.mocked(api.exhibitions.get).mockResolvedValue(options.detail);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/detail/:id', component: DetailPage },
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
  await vi.waitFor(() => expect(registerButton()).not.toBeUndefined());
  return router;
}

describe('展会详情底部报名按钮', () => {
  it('未报名时是「立即报名」，点击进入报名表单', async () => {
    const router = await mountDetail({ loggedIn: true });
    await flush();
    expect(registerButton()?.textContent?.trim()).toBe('立即报名');
    expect(registerButton()?.disabled).toBe(false);
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-form/exh-1'));
  });

  it('已报名本场时变「查看我的报名」，点击进入报名详情', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'approved' },
    ]);
    const router = await mountDetail({ loggedIn: true });
    await vi.waitFor(() => expect(registerButton()?.textContent?.trim()).toBe('查看我的报名'));
    expect(footerHint()).toContain('已报名这场展会');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-detail/reg-9'));
  });

  it('已撤销的报名不算已报名', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'cancelled' },
    ]);
    const router = await mountDetail({ loggedIn: true });
    await flush();
    expect(api.registrations.list).toHaveBeenCalledTimes(1);
    expect(registerButton()?.textContent?.trim()).toBe('立即报名');
    expect(footerHint()).not.toContain('已报名这场展会');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-form/exh-1'));
  });

  it('已报名时按钮不被报名关闭 / 受限账号禁用', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'pending' },
    ]);
    const router = await mountDetail({ loggedIn: true, canRegister: false, detail: CLOSED_DETAIL });
    await vi.waitFor(() => expect(registerButton()?.textContent?.trim()).toBe('查看我的报名'));
    expect(registerButton()?.disabled).toBe(false);
    expect(footerHint()).toContain('已报名这场展会');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-detail/reg-9'));
  });

  it('报名列表失败时仍显示「立即报名」，不把整页变成失败态', async () => {
    vi.mocked(api.registrations.list).mockRejectedValue(new Error('网络错误'));
    const router = await mountDetail({ loggedIn: true });
    await flush();
    expect(document.querySelector('#detail-test h2')?.textContent).toContain('秋季展会');
    expect(registerButton()?.textContent?.trim()).toBe('立即报名');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-form/exh-1'));
  });

  it('访客不发 registrations 请求', async () => {
    await mountDetail({});
    await flush();
    expect(api.registrations.list).not.toHaveBeenCalled();
    expect(registerButton()?.textContent?.trim()).toBe('登录后报名');
  });
});

describe('展会详情举办者卡片', () => {
  it('身份用与其它页卡片一致的主题色小签，不再用普通 pill', async () => {
    await mountDetail();
    const organizer = [...document.querySelectorAll<HTMLElement>('.row-card')].find((node) =>
      node.textContent?.includes('示例展商'),
    );
    expect(organizer?.querySelector('.role-tag')?.textContent).toBe('展商');
    expect(organizer?.querySelector('.pill')).toBeNull();
  });
});
