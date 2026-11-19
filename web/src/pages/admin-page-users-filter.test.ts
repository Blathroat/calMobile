/**
 * 管理后台用户分区筛选（需求 3）：页面层把身份 / 状态写进地址栏并随关键字一起取数。
 *
 * 筛选控件本身的渲染与事件回抛在 `admin-users-section.test.ts` 里测；
 * 这里只验证 AdminPage 的取数与地址栏同步，以及筛选不会覆盖搜索防抖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import AdminPage from './AdminPage.vue';

const mocks = vi.hoisted(() => ({
  usersList: vi.fn(),
  exhibitionsList: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: mocks.usersList },
    exhibitions: { list: mocks.exhibitionsList },
    settings: { get: mocks.settingsGet },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: vi.fn(),
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));

let app: App | undefined;
let router: Router | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usersList.mockResolvedValue([]);
  mocks.exhibitionsList.mockResolvedValue([]);
  mocks.settingsGet.mockResolvedValue({});
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  router = undefined;
  document.body.replaceChildren();
  document.getElementById('app-foot')?.remove();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountAdmin(path = '/admin?tab=users'): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({
    id: 'u1',
    username: 'admin',
    nickname: '管理员',
    role: 'admin',
    loggedIn: true,
    guest: false,
    can: { admin: true },
  });
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin', component: AdminPage }],
  });
  await router.push(path);
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp({ render: () => h(AdminPage) });
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await flush();
  return container;
}

/** 按 `data-value` 点某一组筛选里的按钮；身份 / 状态取值和分区 id 不重名。 */
function segButton(container: HTMLElement, value: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(`.seg button[data-value="${value}"]`)!;
}

/** 按分组名取筛选控件（分区切换组也带 aria-label，用「身份」「状态」区分）。 */
function filterGroup(container: HTMLElement, label: string): HTMLElement {
  return container.querySelector<HTMLElement>(`.seg[aria-label="${label}"]`)!;
}

describe('管理-用户筛选', () => {
  it('默认不带筛选取数，切到「全部」时也不把空值发给服务端', async () => {
    await mountAdmin('/admin?tab=users&role=&status=');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledTimes(1));
    expect(mocks.usersList).toHaveBeenCalledWith({ query: '' });
    expect(router!.currentRoute.value.query.tab).toBe('users');
  });

  it('进页面时从地址栏读筛选值并带进取数', async () => {
    const container = await mountAdmin('/admin?tab=users&role=exhibitor&status=banned');
    await vi.waitFor(() =>
      expect(mocks.usersList).toHaveBeenCalledWith({ query: '', role: 'exhibitor', status: 'banned' }),
    );
    const pressed = [...container.querySelectorAll('.seg button[aria-pressed="true"]')].map((node) =>
      node.textContent?.trim(),
    );
    expect(pressed).toContain('展商');
    expect(pressed).toContain('封禁');
  });

  it('改筛选写回地址栏（保留 tab）并重新取数', async () => {
    const container = await mountAdmin('/admin?tab=users');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledTimes(1));

    segButton(container, 'exhibitor').click();
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '', role: 'exhibitor' }));
    expect(router!.currentRoute.value.query.tab).toBe('users');
    expect(router!.currentRoute.value.query.role).toBe('exhibitor');

    segButton(container, 'banned').click();
    await vi.waitFor(() =>
      expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '', role: 'exhibitor', status: 'banned' }),
    );
    expect(router!.currentRoute.value.query.tab).toBe('users');
    expect(router!.currentRoute.value.query.status).toBe('banned');
  });

  it('切回「全部」时地址栏留下空串，但取数不再带该参数', async () => {
    const container = await mountAdmin('/admin?tab=users&role=user&status=banned');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledWith({ query: '', role: 'user', status: 'banned' }));

    // 身份 / 状态两组筛选项里的「全部」都是第一颗按钮，按钮的 value 是空串。
    filterGroup(container, '身份').querySelector('button')!.click();
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '', status: 'banned' }));
    expect(router!.currentRoute.value.query.role).toBe('');
    expect(router!.currentRoute.value.query.status).toBe('banned');

    filterGroup(container, '状态').querySelector('button')!.click();
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '' }));
    expect(router!.currentRoute.value.query.role).toBe('');
    expect(router!.currentRoute.value.query.status).toBe('');
  });

  it('改筛选不会丢掉正在防抖的搜索关键字，最终取数同时带搜索与筛选', async () => {
    const container = await mountAdmin('/admin?tab=users');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledTimes(1));

    // 输入后立刻点筛选：搜索要等 220ms 才发请求，筛选则马上写地址栏并取数。
    const input = container.querySelector<HTMLInputElement>('#admin-user-search')!;
    input.value = 'demo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    segButton(container, 'admin').click();

    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: 'demo', role: 'admin' }), {
      timeout: 2000,
    });
    // 关键字不进地址栏（沿用原有行为），筛选值在。
    expect(router!.currentRoute.value.query.role).toBe('admin');
    expect(router!.currentRoute.value.query.query).toBeUndefined();
  });
});
