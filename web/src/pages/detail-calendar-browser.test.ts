/**
 * 浏览器 / iOS PWA 的「加入日历」（应用构建、没有原生桥）：
 *
 * - 不请求系统日历状态，按钮固定显示「加入日历」，永远不出现「移出日历」；
 * - 点击后把展会交给 `addExhibitionToCalendar` 生成 .ics；
 * - 分享成功 / 退回下载 / 用户取消 / 失败各自对应一条提示，取消保持静默。
 *
 * 原生日历（有桥）那条链路见 device-actions.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import DetailPage from './DetailPage.vue';
import { api } from '@/app/runtime';
import { device } from '@/services/device-services';
import { addExhibitionToCalendar } from '@/services/calendar-ics';
import { toast } from '@/services/toast';
import { useSessionStore } from '@/stores/session';
import type { ExhibitionDetail } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { get: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
// 本文件锁浏览器通道：没有原生桥。
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => false) } }));
vi.mock('@/services/calendar-ics', () => ({ addExhibitionToCalendar: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { calendarStatus: vi.fn(), toggleCalendar: vi.fn() },
}));
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
    '<div id="app-foot"></div><div id="app-top-actions"></div><div id="detail-browser-test"></div>';
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

/** 底部左侧那颗次按钮：浏览器里固定的「加入日历」。 */
function calendarButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].find((button) =>
    button.classList.contains('ghost'),
  );
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
  app.mount('#detail-browser-test');
  await vi.waitFor(() => expect(calendarButton()).not.toBeUndefined());
  await flush();
}

const EXPECTED_INPUT = {
  title: '秋季展会',
  date: '2026-11-17',
  endDate: '2026-11-22',
  time: '09:00-17:00',
  venue: '会展中心',
  description: '',
  id: 'exh-1',
};

describe('浏览器里的加入日历', () => {
  it('没有原生桥时不请求系统日历状态，按钮固定显示「加入日历」', async () => {
    await mountDetail();

    expect(calendarButton()?.textContent?.trim()).toBe('加入日历');
    expect(calendarButton()?.disabled).toBe(false);
    expect(device.calendarStatus).not.toHaveBeenCalled();
    expect(device.toggleCalendar).not.toHaveBeenCalled();
  });

  it('点击后把展会交给 addExhibitionToCalendar，分享成功提示已打开分享', async () => {
    vi.mocked(addExhibitionToCalendar).mockResolvedValue('shared');
    await mountDetail();

    calendarButton()!.click();

    await vi.waitFor(() => expect(addExhibitionToCalendar).toHaveBeenCalledOnce());
    expect(addExhibitionToCalendar).toHaveBeenCalledWith(EXPECTED_INPUT);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('已打开分享，请选择“日历”', 'success'));
    // 浏览器里没有「移出日历」：点击不会把按钮改文案。
    expect(calendarButton()?.textContent?.trim()).toBe('加入日历');
  });

  it('分享不可用退回下载时提示已生成日历文件', async () => {
    vi.mocked(addExhibitionToCalendar).mockResolvedValue('downloaded');
    await mountDetail();

    calendarButton()!.click();

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('已生成日历文件，请用“文件”打开并加入日历', 'success'));
  });

  it('用户在分享面板里取消时保持静默', async () => {
    vi.mocked(addExhibitionToCalendar).mockResolvedValue('cancelled');
    await mountDetail();

    calendarButton()!.click();

    await vi.waitFor(() => expect(addExhibitionToCalendar).toHaveBeenCalledOnce());
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it('生成 / 分享失败给统一提示，按钮仍是「加入日历」', async () => {
    vi.mocked(addExhibitionToCalendar).mockRejectedValue(new Error('share failed'));
    await mountDetail();

    calendarButton()!.click();

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('生成日历文件失败，请稍后重试', 'error'));
    expect(calendarButton()?.textContent?.trim()).toBe('加入日历');
  });

  it('展会时间留空时信息行只显示日期，不带行尾空格', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      ...DETAIL,
      exhibition: { ...DETAIL.exhibition!, time: '' },
    });
    await mountDetail();

    const rows = [...document.querySelectorAll<HTMLElement>('#detail-browser-test .card .row-meta')];
    expect(rows[0]?.textContent).toBe('11月17日（周二） - 11月22日（周日）');
    expect(rows[0]?.textContent?.endsWith(' ')).toBe(false);
  });
});
