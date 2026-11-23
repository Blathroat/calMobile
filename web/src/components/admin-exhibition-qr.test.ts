/**
 * 管理后台「展会」卡片：版式与展商后台的展会卡一致。
 *
 * 锁四件事：卡片结构和展商卡一样（状态灯在内容里、二维码按钮在右侧、操作行是 ghost 小按钮）；
 * 「暂停 / 恢复报名」只在有管理权限时出现；二维码按钮打开与展商后台相同的分享抽屉；
 * 没配报名站地址时只提示原因，不打开空二维码。
 *
 * 抽屉本身的渲染由 `exhibitor-qr.test.ts` 覆盖，这里只锁「按钮在哪、点了传什么」。
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
import { useSessionStore } from '@/stores/session';

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
  qrEnabled: true,
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

/** 挂载卡片；`admin` 控制当前会话有没有管理权限。 */
async function mountCard({ publicBaseUrl = BASE, admin = true } = {}): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser(
    admin ? { id: 'admin-1', role: 'admin', can: { admin: true } } : { id: 'u1', role: 'user' },
  );
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

function actionLabels(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.action-row button')].map(
    (button) => button.textContent?.trim() ?? '',
  );
}

describe('管理后台展会卡的版式', () => {
  it('和展商卡一样：状态灯在内容里，二维码按钮在右侧，操作行在下方', async () => {
    await mountCard();

    const head = document.querySelector('.admin-exh-head')!;
    const main = head.querySelector('.admin-exh-main')!;
    expect(main).not.toBeNull();
    // 状态灯是内容区的一部分（状态 + 报名数合成一条），不是右侧单独一列。
    expect(main.querySelector('.row-copy .status-tag')?.textContent?.trim()).toBe('报名中 · 需审核 · 12 条报名');
    expect(main.textContent).toContain('已启用报名二维码');
    // 二维码按钮在主体按钮外面、同一块定位区域里，命中区 44px。
    expect(main.contains(qrButton())).toBe(false);
    expect(qrButton().parentElement).toBe(head);
    expect(qrButton().getAttribute('aria-label')).toBe('分享展会二维码');
    expect(qrButton().querySelector('svg')).not.toBeNull();
    expect(document.querySelector('.action-row')).not.toBeNull();
  });

  it('有管理权限时操作行多一颗暂停 / 恢复报名按钮', async () => {
    await mountCard();
    expect(actionLabels()).toEqual(['查看报名', '编辑展会', '暂停报名']);
  });

  it('没有管理权限时不显示暂停 / 恢复报名', async () => {
    await mountCard({ admin: false });
    expect(actionLabels()).toEqual(['查看报名', '编辑展会']);
  });
});

describe('管理后台展会卡的二维码分享', () => {
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
    await mountCard({ publicBaseUrl: '' });
    qrButton().click();
    await nextTick();

    expect(openSheet).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('报名站地址未配置', 'error');
  });
});
