/**
 * 报名站的下载 / 安装入口：放在页面顶栏右侧，不再单独占一条横幅。
 *
 * iOS 没有 APK 也出现，点了打开安装说明；其它平台只有管理员配了下载地址才出现，
 * 点击交给系统浏览器下载。外壳同时挂 `AppSheet`，所以点「查看安装方法」后能看到抽屉内容。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppShell from '@/app/App.vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import { isIos } from '@/services/platform';
import { closeSheet, sheet } from '@/services/sheet';

vi.mock('@/app/runtime', () => ({
  api: { auth: { logout: vi.fn() } },
  bootApp: vi.fn(async () => undefined),
}));
vi.mock('@/app/preload', () => ({ preloadTabs: vi.fn(), resetPreload: vi.fn() }));
// 外壳按报名站构建渲染；只换这一个常量，路径仍用真实的。
vi.mock('@/app/surface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/surface')>();
  return { ...actual, isJoinSurface: true };
});
vi.mock('@/services/platform', () => ({
  isIos: vi.fn(() => false),
  isIosSafari: vi.fn(() => true),
  isAndroid: vi.fn(() => false),
  isInAppBrowser: vi.fn(() => false),
  isStandalonePwa: vi.fn(() => false),
}));

let app: App | undefined;

beforeEach(() => {
  document.body.innerHTML = '<div id="app-shell-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  if (sheet.current) closeSheet();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function mountShell(ios: boolean, downloadUrl = ''): Promise<HTMLElement> {
  vi.mocked(isIos).mockReturnValue(ios);
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().apply({ download: downloadUrl ? { url: downloadUrl, version: '9.9.9' } : {} });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/mine');
  app = createApp(AppShell);
  app.use(pinia).use(router);
  app.mount('#app-shell-test');
  await nextTick();
  return document.getElementById('app-shell-test') as HTMLElement;
}

/** 顶栏右侧的图标按钮：下载 / 安装入口与页面级动作共用 `.icon-button`。 */
function topButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('.topbar .icon-button')].find(
    (item) => item.getAttribute('aria-label') === label,
  );
}

describe('报名站下载入口：放在顶栏右侧', () => {
  it('iOS 即使没有下载地址也出现，点击打开安装说明而不是去下载 APK', async () => {
    const container = await mountShell(true);
    // 不再有独立的下载横幅，避免和页面顶栏叠成两层。
    expect(container.querySelector('.join-download')).toBeNull();
    expect(container.querySelectorAll('.topbar')).toHaveLength(1);

    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    topButton(container, '查看安装方法')!.click();
    await nextTick();
    const panel = document.querySelector('.sheet-panel');
    expect(sheet.current?.title).toBe('安装到主屏幕');
    expect(panel?.textContent).toContain('用 Safari 打开后添加到主屏幕');
    expect(open).not.toHaveBeenCalled();
    // 报名站入口多一颗「打开完整应用」，但这里只验证抽屉打开了，不真的跳转。
    expect(panel?.textContent).toContain('打开完整应用');
  });

  it('Android / 其它平台：有地址才出现，按钮走系统浏览器下载', async () => {
    const container = await mountShell(false, 'https://download.example.com/app.apk');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    topButton(container, '下载应用')!.click();
    expect(open).toHaveBeenCalledWith('https://download.example.com/app.apk', '_blank', 'noopener');
  });

  it('非 iOS 且没有下载地址时不显示下载入口', async () => {
    const container = await mountShell(false);
    expect(topButton(container, '下载应用')).toBeUndefined();
  });
});
