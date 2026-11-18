/**
 * 首页的 iOS 安装引导：只在「iOS 未安装 + 本机没关过 + 没有别的抽屉开着」时弹一次，
 * 并且延到首屏之后；离开首页要清掉定时器，不能在别的页面上弹。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import { dismissIosInstallHint, iosInstallHintDismissed, isIosInstallOffer } from '@/services/pwa';
import { closeSheet, openSheet, sheet } from '@/services/sheet';
import HomePage from './HomePage.vue';

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
vi.mock('@/services/pwa', () => ({
  isIosInstallOffer: vi.fn(),
  iosInstallHintDismissed: vi.fn(),
  dismissIosInstallHint: vi.fn(),
}));

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  vi.mocked(api.exhibitions.month).mockResolvedValue({ day: 0, exhibitions: [], meetings: [] });
  vi.mocked(isIosInstallOffer).mockReturnValue(true);
  vi.mocked(iosInstallHintDismissed).mockReturnValue(false);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  if (sheet.current) closeSheet();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountHome(): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().apply({ calendar: { landing: { year: 2026, month: 6 } } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: HomePage }],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/home');
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({ render: () => h(HomePage) });
  app.use(pinia).use(router).mount(container);
  await flush();
  return container;
}

describe('首页 iOS 安装引导', () => {
  it('首屏之后才弹一次，关闭后记为看过', async () => {
    await mountHome();
    // 首帧不该立刻盖住页面
    expect(sheet.current).toBeNull();

    await vi.waitFor(() => expect(sheet.current?.title).toBe('安装到主屏幕'), { timeout: 2000 });
    expect(sheet.current?.props).toEqual({ mode: 'app' });
    closeSheet();
    expect(dismissIosInstallHint).toHaveBeenCalledTimes(1);
  });

  it('本机已关过时不再自动弹', async () => {
    vi.mocked(iosInstallHintDismissed).mockReturnValue(true);
    await mountHome();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sheet.current).toBeNull();
  });

  it('别的抽屉开着时不叠第二层', async () => {
    openSheet({ title: '用户协议更新', message: '先处理这个' });
    await mountHome();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sheet.current?.title).toBe('用户协议更新');
  });

  it('离开首页后定时器被清掉，不会在别的页面上弹', async () => {
    await mountHome();
    app!.unmount();
    app = undefined;
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sheet.current).toBeNull();
  });
});
