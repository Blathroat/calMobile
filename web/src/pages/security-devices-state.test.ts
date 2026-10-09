import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { api } from '@/app/runtime';
import SecurityDevicesPage from './SecurityDevicesPage.vue';

vi.mock('@/app/runtime', () => ({
  api: { security: { sessions: vi.fn() } },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/stores/session', () => ({ useSessionStore: () => ({ clear: vi.fn() }) }));
vi.mock('@/services/sheet', () => ({ confirmSheet: vi.fn() }));

let app: App | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.security.sessions).mockResolvedValue({ sessions: [{
    id: 'device-1', deviceName: '测试设备', current: true, activeSessions: 1,
    firstSeen: '2024-01-02T03:04:00.000Z', lastActive: '2024-01-02T03:04:00.000Z',
  }] });
  document.body.innerHTML = '<div id="security-devices-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

describe('登录设备日期格式', () => {
  it('始终按中文年月日和中国标准时间显示', async () => {
    app = createApp({ render: () => h(SecurityDevicesPage) });
    app.mount('#security-devices-test');
    await nextTick();
    await vi.waitFor(() => expect(document.querySelectorAll('.row-meta')).not.toHaveLength(0));
    const dates = [...document.querySelectorAll<HTMLElement>('.row-meta')].map((node) => node.textContent || '');
    expect(dates.some((value) => value.includes('2024/01/02') && value.includes('11:04'))).toBe(true);
  });
});
