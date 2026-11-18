/**
 * 浏览器里的「分享展会」：没有原生桥 / 系统分享时 `device.shareText` 会退回剪贴板，
 * 页面要把结果反馈出来 —— 内容已复制就提示「已复制」，系统分享成功或用户取消都不再打扰。
 *
 * 这里 mock 掉底部面板：只锁分享动作本身，面板渲染由 components/app-sheet.test.ts 管。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import DetailPage from './DetailPage.vue';
import { api } from '@/app/runtime';
import { device } from '@/services/device-services';
import { openSheet, type SheetAction } from '@/services/sheet';
import { toast } from '@/services/toast';
import { useSessionStore } from '@/stores/session';
import type { ExhibitionDetail } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { get: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => false) } }));
vi.mock('@/services/calendar-ics', () => ({ addExhibitionToCalendar: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { calendarStatus: vi.fn(), toggleCalendar: vi.fn(), shareText: vi.fn() },
}));
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

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

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML =
    '<div id="app-foot"></div><div id="app-top-actions"></div><div id="detail-share-test"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue(DETAIL);
  vi.mocked(api.registrations.list).mockResolvedValue([]);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountDetail(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'u1', username: 'user', can: { register: true } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/detail/:id', component: DetailPage }],
  });
  await router.push('/detail/exh-1');
  app = createApp(DetailPage).use(pinia).use(router);
  app.mount('#detail-share-test');
  await vi.waitFor(() => expect(document.querySelector('#app-top-actions .icon-button')).not.toBeNull());
  await flush();
}

/** 点顶栏分享按钮，取面板里的「分享」动作并执行（面板由 mock 收走）。 */
async function runShareAction(): Promise<void> {
  document.querySelector<HTMLButtonElement>('#app-top-actions .icon-button')!.click();
  await vi.waitFor(() => expect(openSheet).toHaveBeenCalledOnce());
  const options = vi.mocked(openSheet).mock.calls[0]![0];
  const action = options.actions?.find((item: SheetAction) => item.label === '分享');
  expect(action).toBeDefined();
  const close = vi.fn();
  await action!.onClick!(close);
  expect(close).toHaveBeenCalledOnce();
}

describe('浏览器里的分享展会', () => {
  it('退回剪贴板复制成功时提示「已复制」', async () => {
    vi.mocked(device.shareText).mockResolvedValue({ shared: false, copied: true });
    await mountDetail();

    await runShareAction();

    await vi.waitFor(() => expect(device.shareText).toHaveBeenCalledOnce());
    const call = vi.mocked(device.shareText).mock.calls[0]!;
    expect(call[0]).toBe('秋季展会');
    expect(call[1]).toContain('秋季展会');
    expect(call[1]).toContain('会展中心');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('已复制', 'success'));
  });

  it('系统分享成功时不再多弹一条提示', async () => {
    vi.mocked(device.shareText).mockResolvedValue({ shared: true, copied: false });
    await mountDetail();

    await runShareAction();
    await flush();

    expect(device.shareText).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it('用户取消分享时保持静默', async () => {
    vi.mocked(device.shareText).mockResolvedValue({ shared: false, copied: false });
    await mountDetail();

    await runShareAction();
    await flush();

    expect(toast).not.toHaveBeenCalled();
  });

  it('分享失败时显示错误文案', async () => {
    vi.mocked(device.shareText).mockRejectedValue(new Error('当前环境不支持分享，请手动复制内容'));
    await mountDetail();

    await runShareAction();

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('当前环境不支持分享，请手动复制内容', 'error'));
  });
});
