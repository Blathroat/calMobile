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
import AppSheet from '@/components/AppSheet.vue';
import { closeSheet, sheet } from '@/services/sheet';

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
  // 减少动效：抽屉关闭的退场计时器直接落 0，断言不用等动画时长。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  router = undefined;
  if (sheet.current) closeSheet();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.getElementById('app-foot')?.remove();
});

/** 等响应式重渲染、路由替换与抽屉关闭的 0ms 计时器都跑完。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
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
  // 筛选抽屉由外壳统一渲染：挂上 AppSheet 才能点开选择栏选值。
  app = createApp({ render: () => [h(AdminPage), h(AppSheet)] });
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await flush();
  return container;
}

/**
 * 通过选择栏改一次筛选：点开触发按钮，再在带对勾的列表抽屉里选一项。
 * 触发按钮的 id 与编辑展会页的分类选择栏同一套语义。
 */
async function pickFilter(triggerId: string, label: string): Promise<void> {
  document.querySelector<HTMLButtonElement>(`#${triggerId}`)?.click();
  await flush();
  const option = [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!option) throw new Error(`抽屉里没有「${label}」选项`);
  option.click();
  await flush();
}

/** 选择栏上当前显示的文案。 */
function filterLabelText(triggerId: string): string {
  return document.querySelector<HTMLButtonElement>(`#${triggerId}`)?.textContent?.trim() ?? '';
}

describe('管理-用户筛选', () => {
  it('默认不带筛选取数，切到「全部」时也不把空值发给服务端', async () => {
    await mountAdmin('/admin?tab=users&role=&status=');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledTimes(1));
    expect(mocks.usersList).toHaveBeenCalledWith({ query: '' });
    expect(router!.currentRoute.value.query.tab).toBe('users');
  });

  it('进页面时从地址栏读筛选值并带进取数', async () => {
    await mountAdmin('/admin?tab=users&role=exhibitor&status=banned');
    await vi.waitFor(() =>
      expect(mocks.usersList).toHaveBeenCalledWith({ query: '', role: 'exhibitor', status: 'banned' }),
    );
    // 两个选择栏分别显示带过来的筛选值。
    expect(filterLabelText('admin-user-role-filter')).toBe('展商');
    expect(filterLabelText('admin-user-status-filter')).toBe('封禁');
  });

  it('改筛选写回地址栏（保留 tab）并重新取数', async () => {
    await mountAdmin('/admin?tab=users');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledTimes(1));

    await pickFilter('admin-user-role-filter', '展商');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '', role: 'exhibitor' }));
    expect(router!.currentRoute.value.query.tab).toBe('users');
    expect(router!.currentRoute.value.query.role).toBe('exhibitor');
    expect(filterLabelText('admin-user-role-filter')).toBe('展商');

    await pickFilter('admin-user-status-filter', '封禁');
    await vi.waitFor(() =>
      expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '', role: 'exhibitor', status: 'banned' }),
    );
    expect(router!.currentRoute.value.query.tab).toBe('users');
    expect(router!.currentRoute.value.query.status).toBe('banned');
  });

  it('切回「全部」时地址栏留下空串，但取数不再带该参数', async () => {
    await mountAdmin('/admin?tab=users&role=user&status=banned');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenCalledWith({ query: '', role: 'user', status: 'banned' }));

    // 「全部」对应空串：地址栏留着空串，但取数不再带该参数。
    await pickFilter('admin-user-role-filter', '全部');
    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: '', status: 'banned' }));
    expect(router!.currentRoute.value.query.role).toBe('');
    expect(router!.currentRoute.value.query.status).toBe('banned');
    expect(filterLabelText('admin-user-role-filter')).toBe('全部');

    await pickFilter('admin-user-status-filter', '全部');
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
    await pickFilter('admin-user-role-filter', '管理员');

    await vi.waitFor(() => expect(mocks.usersList).toHaveBeenLastCalledWith({ query: 'demo', role: 'admin' }), {
      timeout: 2000,
    });
    // 关键字不进地址栏（沿用原有行为），筛选值在。
    expect(router!.currentRoute.value.query.role).toBe('admin');
    expect(router!.currentRoute.value.query.query).toBeUndefined();
  });
});
