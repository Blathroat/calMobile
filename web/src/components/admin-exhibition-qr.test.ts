/**
 * 管理后台「展会」卡片的二维码分享按钮。
 *
 * 卡片右侧状态灯下面那枚按钮与展商后台同款：打开「分享展会」抽屉，二维码内容是报名站链接；
 * 没配报名站地址时只提示原因，不打开空二维码。抽屉本身的渲染由 `exhibitor-qr.test.ts` 覆盖，
 * 这里只锁「按钮在哪、点了传什么」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import AdminExhibitionCard from './AdminExhibitionCard.vue';
import ShareQrSheet from './ShareQrSheet.vue';
import { openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { useBootstrapStore } from '@/stores/bootstrap';

vi.mock('@/app/runtime', () => ({ api: { exhibitions: { setStatus: vi.fn() } } }));
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn(), confirmSheet: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const BASE = 'https://expo.example.com';
const ITEM = {
  id: 'exh-1',
  title: '秋季设计展',
  date: '2026-11-20',
  time: '09:00-17:00',
  venue: '国际会展中心',
  statusCode: 'review',
  registrationCount: 12,
};
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="admin-card-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountCard(publicBaseUrl = BASE): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().publicBaseUrl = publicBaseUrl;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  await router.push('/');
  app = createApp({ render: () => h(AdminExhibitionCard, { item: ITEM }) })
    .use(pinia)
    .use(router);
  app.mount('#admin-card-test');
  await nextTick();
}

function qrButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.admin-exh-qr')!;
}

describe('管理后台展会卡的二维码分享', () => {
  it('右侧列在信号灯下面多一枚二维码图标按钮', async () => {
    await mountCard();
    const side = document.querySelector('.admin-exh-side')!;
    expect(side).not.toBeNull();
    expect(side.querySelector('.status-tag')?.textContent?.trim()).toBeTruthy();
    expect(side.querySelector('.admin-exh-qr')).not.toBeNull();
    // 顺序即位置：状态灯在上，按钮在下。
    expect(side.firstElementChild?.classList.contains('status-tag')).toBe(true);
    expect(qrButton().getAttribute('aria-label')).toBe('分享展会二维码');
    expect(qrButton().querySelector('svg')).not.toBeNull();
  });

  it('点按钮打开分享抽屉，二维码内容是报名站链接', async () => {
    await mountCard();
    qrButton().click();
    await nextTick();

    expect(openSheet).toHaveBeenCalledOnce();
    const options = vi.mocked(openSheet).mock.calls[0]![0];
    expect(options.title).toBe('分享展会');
    expect(options.component).toBe(ShareQrSheet);
    expect(options.props).toEqual({
      text: `${BASE}/e/exh-1`,
      title: '秋季设计展',
      fileName: 'exhibition-qr-exh-1.png',
    });
  });

  it('没配报名站地址时只提示，不打开空二维码', async () => {
    await mountCard('');
    qrButton().click();
    await nextTick();

    expect(openSheet).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('报名站地址未配置', 'error');
  });
});
