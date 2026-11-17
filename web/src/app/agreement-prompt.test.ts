/**
 * 全局「用户协议更新」确认：由外壳的 watch 判定——
 * 已登录 + 协议开启 + 当前版本高于已同意版本时弹出不可关闭的抽屉。
 *
 * 这里真实挂载 `App.vue`（外壳本身就是判定逻辑所在），只把网络与原生两层换成 mock：
 * - 「同意」调 `api.profile.agree(version)` 并重拉启动数据，条件消失后抽屉收起；
 * - 「不同意并退出」走 `device.exitApp()`；
 * - 「查看用户协议」去 `/agreement`，在协议页上不叠弹窗，返回其它页面仍未同意会重新弹。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import App from './App.vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { closeSheet, sheet } from '@/services/sheet';

const mocks = vi.hoisted(() => ({
  agree: vi.fn(),
  refresh: vi.fn(),
  exitApp: vi.fn(),
  preloadTabs: vi.fn(),
  resetPreload: vi.fn(),
}));

vi.mock('@/app/runtime', () => ({
  api: {
    profile: { agree: mocks.agree },
    auth: { logout: vi.fn(async () => undefined) },
  },
  bootApp: vi.fn(async () => undefined),
  refreshRuntimeBootstrap: mocks.refresh,
  applyRuntimeBootstrap: vi.fn(),
}));
vi.mock('@/app/preload', () => ({ preloadTabs: mocks.preloadTabs, resetPreload: mocks.resetPreload }));
vi.mock('@/services/device-services', () => ({ device: { exitApp: mocks.exitApp } }));

let app: VueApp | undefined;

/** 协议关闭 / 已同意时不该弹：每个用例先按默认配置开好环境，个别用例再改。 */
function configureAgreement(options: { enabled?: boolean; version?: number; agreedVersion?: number } = {}): void {
  const { enabled = true, version = 2, agreedVersion = 1 } = options;
  useSessionStore().applyUser({
    id: 'u1',
    username: 'user',
    nickname: '用户',
    role: 'user',
    loggedIn: true,
    guest: false,
    agreedTermsVersion: agreedVersion,
  });
  useBootstrapStore().apply({
    agreement: { enabled, version, updatedAt: '2026-11-17T08:00:00.000Z' },
  });
}

async function mountApp(path = '/settings'): Promise<{ container: HTMLElement; router: Router }> {
  const pinia = createPinia();
  setActivePinia(pinia);
  configureAgreement();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', component: { template: '<div />' }, meta: { title: 'nav.home', tab: 'home' } },
      { path: '/my-registrations', component: { template: '<div />' }, meta: { title: 'registration.list.title' } },
      { path: '/profile', component: { template: '<div />' }, meta: { title: 'profile.title' } },
      { path: '/settings', component: { template: '<div />' }, meta: { title: 'settings.title', back: true } },
      { path: '/agreement', component: { template: '<div />' }, meta: { title: 'agreement.title', back: true } },
    ],
  });
  await router.push(path);
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(App);
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await nextTick();
  return { container, router };
}

function sheetButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.sheet .cta')].find(
    (button) => button.textContent?.trim() === label,
  );
}

beforeEach(async () => {
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(async () => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  vi.unstubAllGlobals();
});

describe('用户协议更新确认', () => {
  it('已登录且版本落后时弹出不可关闭的抽屉', async () => {
    await mountApp();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('用户协议更新'));
    expect(sheet.current?.dismissible).toBe(false);
    expect(sheet.current?.layout).toBe('stack');
    expect(sheet.current?.actions.map((action) => action.label)).toEqual(['查看用户协议', '不同意并退出', '同意']);
    expect(sheet.current?.message).toContain('第 2 版');
  });

  it('协议关闭或已同意当前版本时不弹', async () => {
    const { router } = await mountApp();
    // 默认配置会弹；先确认条件成立，再分别验证两种「不弹」的分支。
    await vi.waitFor(() => expect(sheet.current).not.toBeNull());
    // 先关条件再收抽屉：条件还在时手动关闭会被 watch 重新弹出来。
    configureAgreement({ enabled: false, agreedVersion: 1 });
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));

    await router.push('/home');
    await nextTick();
    expect(sheet.current).toBeNull();

    configureAgreement({ enabled: true, version: 2, agreedVersion: 2 });
    await router.push('/settings');
    await nextTick();
    expect(sheet.current).toBeNull();
  });

  it('点「同意」写入版本并重拉启动数据后抽屉消失', async () => {
    const { router } = await mountApp();
    await vi.waitFor(() => expect(sheet.current).not.toBeNull());
    mocks.agree.mockResolvedValue({ ok: true, agreedTermsVersion: 2, agreedTermsAt: '2026-11-17T00:00:00.000Z' });
    mocks.refresh.mockImplementation(async () => {
      configureAgreement({ enabled: true, version: 2, agreedVersion: 2 });
    });
    sheetButton('同意')!.click();
    await vi.waitFor(() => expect(mocks.agree).toHaveBeenCalledWith(2));
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    await vi.waitFor(() => expect(sheet.current).toBeNull());
    expect(router.currentRoute.value.path).toBe('/settings');
  });

  it('同意失败时提示并保留抽屉', async () => {
    await mountApp();
    await vi.waitFor(() => expect(sheet.current).not.toBeNull());
    mocks.agree.mockRejectedValue(new Error('网络不可用'));
    sheetButton('同意')!.click();
    await vi.waitFor(() => expect(mocks.agree).toHaveBeenCalled());
    await nextTick();
    expect(sheet.current?.closing).toBe(false);
    expect(sheet.current?.title).toBe('用户协议更新');
  });

  it('点「不同意并退出」调用 device.exitApp', async () => {
    await mountApp();
    await vi.waitFor(() => expect(sheet.current).not.toBeNull());
    mocks.exitApp.mockResolvedValue({ closed: true });
    sheetButton('不同意并退出')!.click();
    await vi.waitFor(() => expect(mocks.exitApp).toHaveBeenCalledTimes(1));
    // 原生关闭软件；浏览器里关闭失败时抽屉还在，让用户还能改选「同意」。
    expect(sheet.current).not.toBeNull();
  });

  it('点「查看用户协议」进入协议页，返回后仍未同意会重新弹', async () => {
    const { router } = await mountApp();
    await vi.waitFor(() => expect(sheet.current).not.toBeNull());
    sheetButton('查看用户协议')!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/agreement'));
    await vi.waitFor(() => expect(sheet.current).toBeNull());
    // 在协议页上不再叠弹窗。
    await nextTick();
    expect(sheet.current).toBeNull();
    // 返回其它页面：条件仍然成立，重新弹。
    await router.push('/settings');
    await vi.waitFor(() => expect(sheet.current?.title).toBe('用户协议更新'));
  });
});
