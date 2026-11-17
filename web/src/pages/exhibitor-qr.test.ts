/**
 * 展商后台的分享二维码与复制链接。
 *
 * 卡片右侧的小二维码按钮打开「分享展会」抽屉：二维码内容就是报名站链接，
 * 导出画布必须是透明底黑点（白底只属于展示容器）。「复制链接」点击即复制，
 * 失败时不再弹手动复制面板，只提示重试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ExhibitorPage from './ExhibitorPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { useBootstrapStore } from '@/stores/bootstrap';
import { closeSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { copyText } from '@/services/clipboard';

vi.mock('@/app/runtime', () => ({
  api: { exhibitions: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
vi.mock('@/services/device-services', () => ({ device: { saveImage: vi.fn() } }));
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => true) } }));
vi.mock('@/services/clipboard', () => ({ copyText: vi.fn() }));

const BASE = 'https://expo.example.com';
const LINK = `${BASE}/e/exh-1`;
const FILE_NAME = 'exhibition-qr-exh-1.png';
const DATA_URL = 'data:image/png;base64,QR';
const EXHIBITION = {
  id: 'exh-1',
  title: '秋季设计展',
  dateLabel: '2026年11月20日',
  time: '09:00-17:00',
  venue: '国际会展中心',
  statusCode: 'open',
  registrationCount: 12,
  qrEnabled: true,
};
const fills: { style: string; width: number; height: number }[] = [];
let app: App | undefined;

beforeEach(async () => {
  // 面板状态是模块级的：上一个用例留下的面板先收干净，否则会盖住新挂载的页面。
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  vi.clearAllMocks();
  fills.length = 0;
  document.body.innerHTML = '<div id="exhibitor-test"></div>';
  vi.mocked(api.exhibitions.list).mockResolvedValue([EXHIBITION]);
  vi.mocked(api.exhibitions.get).mockResolvedValue({ found: true, exhibition: EXHIBITION });
  vi.mocked(device.saveImage).mockResolvedValue({ saved: true });
  vi.mocked(nativeBridge.hasNative).mockReturnValue(true);
  vi.mocked(copyText).mockResolvedValue(true);
  // jsdom 没有 canvas 实现：给出能记录落点最小替身，并让导出拿到固定 dataURL。
  const context = {
    fillStyle: '',
    fillRect(_x: number, _y: number, width: number, height: number) {
      fills.push({ style: String(context.fillStyle), width, height });
    },
    clearRect() {
      // drawQr 会先清空画布；本用例只关心随后 fillRect 的颜色与尺寸。
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(DATA_URL);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(publicBaseUrl = BASE): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({
    id: 'exhibitor-1',
    role: 'exhibitor',
    can: { limited: false },
    seenHints: ['exhibitor-checkin'],
  });
  useBootstrapStore().publicBaseUrl = publicBaseUrl;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibitor', component: ExhibitorPage },
      { path: '/detail/:id', component: { template: '<div />' } },
      { path: '/exhibition-form/:id', component: { template: '<div />' } },
      { path: '/review', component: { template: '<div />' } },
      { path: '/checkin', component: { template: '<div />' } },
    ],
  });
  await router.push('/exhibitor');
  app = createApp({ render: () => [h(ExhibitorPage), h(AppSheet)] })
    .use(pinia)
    .use(router);
  app.mount('#exhibitor-test');
  await vi.waitFor(() => expect(document.querySelector('.exh-qr')).not.toBeNull());
}

function qrButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.exh-qr')!;
}

function sheetButton(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('.sheet-panel button')].find(
    (button) => button.textContent?.trim() === label,
  )!;
}

async function openShareSheet(): Promise<void> {
  qrButton().click();
  await nextTick();
  await nextTick();
  // 等二维码真正画出来再结束用例：异步绘制落在卸载之后会碰 jsdom 未实现的 canvas，刷出噪音日志。
  await vi.waitFor(() => expect(fills.length).toBeGreaterThan(0));
}

describe('展商卡分享二维码', () => {
  it('卡片右侧是 44px 命中区的二维码图标按钮', async () => {
    await mountPage();
    const button = qrButton();
    expect(button.getAttribute('aria-label')).toBe('分享展会二维码');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3);
  });

  it('点按钮打开抽屉：二维码、展会名称、链接与保存按钮都在', async () => {
    await mountPage();
    await openShareSheet();

    expect(document.querySelector('.sheet-title')?.textContent).toBe('分享展会');
    const canvas = document.querySelector<HTMLCanvasElement>('.sheet-panel canvas')!;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('width')).toBe('480');
    expect(document.querySelector('.share-qr-title')?.textContent).toBe('秋季设计展');
    expect(document.querySelector('.share-qr-link')?.textContent).toBe(LINK);
    expect(sheetButton('保存到本地')).toBeTruthy();
  });

  it('导出画布只有透明底黑点，不铺白底', async () => {
    await mountPage();
    await openShareSheet();
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(0));

    expect(fills.some((fill) => fill.style === '#ffffff')).toBe(false);
    expect(fills.some((fill) => fill.style === '#000000')).toBe(true);
  });

  it('二维码画不出来时说明原因并禁用保存', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await mountPage();
    qrButton().click();
    await nextTick();
    await nextTick();

    await vi.waitFor(() => expect(document.querySelector('.share-qr-card')).not.toBeNull());
    await vi.waitFor(() =>
      expect(document.querySelector('.sheet-panel .field-hint')?.textContent).toContain('二维码生成失败，请关闭后重试'),
    );
    expect(sheetButton('保存到本地').disabled).toBe(true);
    expect(device.saveImage).not.toHaveBeenCalled();
  });

  it('保存到本地走原生相册，文件名带展会 id', async () => {
    await mountPage();
    await openShareSheet();
    sheetButton('保存到本地').click();

    await vi.waitFor(() => expect(device.saveImage).toHaveBeenCalledWith(DATA_URL, FILE_NAME));
    expect(toast).toHaveBeenCalledWith('展会二维码已保存', 'success');
  });

  it('没有原生桥时退回浏览器下载', async () => {
    vi.mocked(nativeBridge.hasNative).mockReturnValue(false);
    await mountPage();
    await openShareSheet();
    const clicked: HTMLAnchorElement[] = [];
    // click 定义在 HTMLElement.prototype 上：拦下 <a> 的下载点击，其它元素的点击照常派发，
    // 否则连「保存到本地」按钮的点击也会被吞掉。
    const nativeClick = HTMLElement.prototype.click;
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLAnchorElement) {
        clicked.push(this);
        return;
      }
      nativeClick.call(this);
    });
    sheetButton('保存到本地').click();

    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.download).toBe(FILE_NAME);
    expect(clicked[0]!.href).toContain('data:image/png');
    expect(device.saveImage).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('展会二维码已保存', 'success');
  });

  it('原生落盘失败时提示保存失败', async () => {
    vi.mocked(device.saveImage).mockResolvedValue({ saved: false });
    await mountPage();
    await openShareSheet();
    sheetButton('保存到本地').click();

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('保存失败，请稍后重试', 'error'));
  });

  it('用户取消系统面板时不弹失败提示', async () => {
    vi.mocked(device.saveImage).mockRejectedValue(Object.assign(new Error('用户取消'), { code: 'cancelled' }));
    await mountPage();
    await openShareSheet();
    sheetButton('保存到本地').click();

    await vi.waitFor(() => expect(device.saveImage).toHaveBeenCalledOnce());
    await nextTick();
    expect(toast).not.toHaveBeenCalled();
  });

  it('没配报名站地址时只提示，不打开空二维码', async () => {
    await mountPage('');
    qrButton().click();
    await nextTick();
    await nextTick();

    expect(document.querySelector('.sheet-panel')).toBeNull();
    expect(toast).toHaveBeenCalledWith('报名站地址未配置', 'error');
  });
});

describe('展商卡复制链接直连', () => {
  function copyButton(): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLButtonElement>('.action-row button')].find(
      (button) => button.textContent?.trim() === '复制链接',
    )!;
  }

  it('点击即复制报名链接并提示成功', async () => {
    await mountPage();
    copyButton().click();

    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith(LINK));
    expect(toast).toHaveBeenCalledWith('已复制报名链接');
    expect(document.querySelector('.sheet-panel')).toBeNull();
  });

  it('复制失败时提示重试，不弹手动复制面板', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    await mountPage();
    copyButton().click();

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('复制失败，请稍后重试', 'error'));
    expect(document.querySelector('.sheet-panel')).toBeNull();
  });

  it('没配报名站地址时不尝试复制，直接说明原因', async () => {
    await mountPage('');
    copyButton().click();
    await nextTick();

    expect(copyText).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('报名站地址未配置', 'error');
  });
});
