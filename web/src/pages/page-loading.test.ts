import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App, type Component } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import HomePage from './HomePage.vue';
import AdminPage from './AdminPage.vue';
import type { JsonObject } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn() },
    exhibitions: { list: vi.fn(), month: vi.fn(), get: vi.fn(async () => ({})) },
    settings: { get: vi.fn(async () => ({})) },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: vi.fn(),
}));
vi.mock('@/app/preload', () => ({ preloadAdjacentMonths: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

const mounted: App[] = [];
async function mount(page: Component, path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().apply({ calendar: { landing: { year: 2026, month: 6 } } });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: page }] });
  router.beforeEach(() => { navigation.begin(); });
  await router.push(path);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({ render: () => h(page) });
  app.use(pinia).use(router).mount(container);
  mounted.push(app);
  await flush();
  return { container, router, app };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  vi.mocked(api.users.list).mockResolvedValue([]);
  vi.mocked(api.exhibitions.list).mockResolvedValue([]);
  vi.mocked(api.settings.get).mockResolvedValue({});
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
});
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  navigation.cancel();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('首页加载', () => {
  it('连续切月后，晚到的上月响应不会覆盖当前月份展会', async () => {
    const pending: ReturnType<typeof deferred<JsonObject>>[] = [];
    vi.mocked(api.exhibitions.month).mockImplementation(() => {
      const request = deferred<JsonObject>();
      pending.push(request);
      return request.promise;
    });
    const { container } = await mount(HomePage, '/home');
    pending[0]!.resolve({ day: 1, exhibitions: [{ id: 'june', day: 1, title: '六月展会' }] });
    await flush();
    const next = container.querySelector<HTMLButtonElement>('button[title="下一个月"]')!;
    next.click();
    await flush();
    next.click();
    await flush();
    pending[2]!.resolve({ day: 3, exhibitions: [{ id: 'august', day: 3, title: '八月展会' }] });
    await flush();
    pending[1]!.resolve({ day: 3, exhibitions: [{ id: 'july', day: 3, title: '七月展会' }] });
    await flush();
    expect(container.textContent).toContain('八月展会');
    expect(container.textContent).not.toContain('七月展会');
  });

  it('启动期间离开首页后，不再发月份请求或预热详情', async () => {
    const boot = deferred<void>();
    vi.mocked(bootApp).mockReturnValue(boot.promise);
    const { app } = await mount(HomePage, '/home');
    app.unmount();
    mounted.splice(mounted.indexOf(app), 1);
    boot.resolve();
    await flush();
    expect(api.exhibitions.month).not.toHaveBeenCalled();
    expect(api.exhibitions.get).not.toHaveBeenCalled();
  });
});

describe('管理页搜索', () => {
  it('查看同名用户时保留所选用户的 ID', async () => {
    vi.mocked(api.users.list).mockResolvedValue([
      { id: 'first', nickname: '同名' },
      { id: 'second', nickname: '同名' },
    ]);
    const { container, router } = await mount(AdminPage, '/admin?tab=users');
    const links = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.getAttribute('aria-label') === '查看 同名 的公开页');
    const navigated = new Promise<void>((resolve) => router.afterEach(() => resolve()));
    links[1]!.click();
    await navigated;
    expect(router.currentRoute.value.query.userId).toBe('second');
  });

  it('展会分区的搜索读取展会并更新实际列表', async () => {
    vi.mocked(api.exhibitions.list).mockImplementation(async (params) => params?.query === '目标'
      ? [{ id: 'match', title: '目标展会' }]
      : [{ id: 'other', title: '其他展会' }]);
    const { container } = await mount(AdminPage, '/admin?tab=exhibitions');
    await vi.advanceTimersByTimeAsync(0);
    const input = container.querySelector<HTMLInputElement>('#admin-exhibition-search')!;
    input.value = '目标';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(220);
    await flush();
    expect(api.exhibitions.list).toHaveBeenLastCalledWith({ query: '目标' });
    expect(container.textContent).toContain('目标展会');
    expect(container.textContent).not.toContain('其他展会');
  });

  it('切分区取消旧搜索防抖，旧用户词不会进入展会分区', async () => {
    const { container, router } = await mount(AdminPage, '/admin?tab=users');
    await vi.advanceTimersByTimeAsync(0);
    const input = container.querySelector<HTMLInputElement>('#admin-user-search')!;
    input.value = '旧用户';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await router.replace('/admin?tab=exhibitions');
    await vi.advanceTimersByTimeAsync(220);
    await flush();
    expect(container.textContent).not.toContain('旧用户');
    expect(api.users.list).not.toHaveBeenCalledWith({ query: '旧用户' });
  });

  it('预热晚到不会覆盖设置分区里已经编辑的表单', async () => {
    const preload = deferred<JsonObject>();
    vi.mocked(api.settings.get).mockReturnValueOnce(preload.promise)
      .mockResolvedValue({ brand: { zh: '当前品牌' } });
    const { container, router } = await mount(AdminPage, '/admin?tab=users');
    await vi.advanceTimersByTimeAsync(0);
    await router.replace('/admin?tab=settings');
    await flush();
    const input = container.querySelector<HTMLInputElement>('#settings-title-zh')!;
    input.value = '正在编辑';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    preload.resolve({ brand: { zh: '旧品牌' } });
    await flush();
    expect(input.value).toBe('正在编辑');
  });
});
