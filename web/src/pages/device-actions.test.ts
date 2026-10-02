import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App, type Component } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import DetailPage from './DetailPage.vue';
import UserSettingsPage from './UserSettingsPage.vue';
import { useSessionStore } from '@/stores/session';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  bootApp: vi.fn().mockResolvedValue(undefined),
  api: {
    exhibitions: { get: vi.fn().mockResolvedValue({
      found: true,
      exhibition: { id: 'exh-1', title: '秋季展会', date: '2026-09-20' },
    }) },
    profile: {
      get: vi.fn().mockResolvedValue({ id: 'u1', username: 'user' }),
      notifications: vi.fn().mockResolvedValue({ granted: false }),
    },
  },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

let app: App | undefined;

beforeEach(() => {
  document.body.innerHTML = '<div id="app-foot"></div><div id="device-test"></div>';
  window.CalMobileStrings = {
    s_dvh8t7: '移出日历',
    s_1prtpth: '加入日历',
    s_1splm64: '开启通知',
    s_j5c9oy: '通知已开启',
    s_1ya7561: '未获得通知权限',
  };
  vi.clearAllMocks();
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  delete window.CalMobileNative;
});

async function mountPage(page: Component, path: string): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'u1', username: 'user', can: { register: true } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: page === DetailPage ? '/detail/:id' : path, component: page }],
  });
  await router.push(path);
  app = createApp(page).use(pinia).use(router);
  app.mount('#device-test');
  await nextTick();
}

describe('页面与 Android 设备动作的契约', () => {
  it('重新打开已加入日历的展会时显示移出日历', async () => {
    window.CalMobileNative = {
      invoke(action, payloadJson, callbackId) {
        expect(action).toBe('calendar.status');
        const payload = JSON.parse(payloadJson);
        // SystemActions.calendarStatus 以标题和日期共同定位；没有标题就返回 false。
        const inCalendar = payload.title === '秋季展会' && payload.date === '2026-09-20';
        window.CalMobileBridge?.onResult(callbackId, true, { granted: true, inCalendar }, null, null);
      },
    };
    await mountPage(DetailPage, '/detail/exh-1');
    await vi.waitFor(() => {
      expect(document.querySelector('#app-foot button')?.textContent?.trim()).toBe('移出日历');
    });
  });

  it.each([true, false])('通知权限回调 %s 与页面授权状态一致', async (granted) => {
    window.CalMobileNative = {
      invoke(action, _payloadJson, callbackId) {
        expect(action).toBe('notify.requestPermission');
        // SystemActions 的已授权分支和权限回调都直接返回 boolean。
        window.CalMobileBridge?.onResult(callbackId, true, granted, null, null);
      },
    };
    await mountPage(UserSettingsPage, '/settings');
    const findButton = () => [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '开启通知');
    await vi.waitFor(() => expect(findButton()).toBeDefined());
    findButton()!.click();
    await vi.waitFor(() => {
      expect(useCapabilitiesStore().values.notifications).toBe(granted);
      expect(toast).toHaveBeenCalledWith(granted ? '通知已开启' : '未获得通知权限', granted ? 'success' : 'error');
      expect(Boolean(findButton())).toBe(!granted);
    });
  });
});
