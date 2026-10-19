/**
 * 报名二维码长按保存：550ms 触发 device.saveImage，拖动 / 抬起取消；
 * 失败与取消按稳定错误码分流，浏览器里没有原生桥时退回下载。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import RegistrationDetailPage from './RegistrationDetailPage.vue';
import { api } from '@/app/runtime';
import { toast } from '@/services/toast';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';

vi.mock('@/app/runtime', () => ({ api: { registrations: { get: vi.fn() } } }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
vi.mock('@/services/device-services', () => ({ device: { saveImage: vi.fn() } }));
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => true) } }));

const DATA_URL = 'data:image/png;base64,QR';
const FILE_NAME = 'calmobile-qr.png';
const HOLD_WAIT_MS = 650;
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.registrations.get).mockResolvedValue({
    found: true,
    registration: {
      id: 'reg-1',
      exhibitionId: 'exh-1',
      exhibitionTitle: '秋季展会',
      visitorName: '张三',
      statusCode: 'approved',
      checkInCode: 'CALMOBILE-CHECKIN|秋季展会|报名-1',
    },
  });
  vi.mocked(device.saveImage).mockResolvedValue({ saved: true });
  vi.mocked(nativeBridge.hasNative).mockReturnValue(true);
  // 二维码绘制与导出：jsdom 没有 canvas 实现，这里给出可用的最小替身。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(DATA_URL);
  document.body.innerHTML = '<div id="app-foot"></div><div id="qr-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/registration-detail/:id', component: RegistrationDetailPage },
      { path: '/registration-form/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/registration-detail/reg-1');
  app = createApp(RegistrationDetailPage).use(pinia).use(router);
  app.mount('#qr-test');
  await vi.waitFor(() => expect(document.querySelector('[data-action="check-in-qr"]')).not.toBeNull());
  return document.querySelector<HTMLElement>('[data-action="check-in-qr"]')!;
}

function pointer(node: Element, type: string, clientX = 20, clientY = 20): void {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
}

/** 按住不动到超时后再抬起：抬手只在定时器之后，不会取消这次长按。 */
async function hold(node: Element): Promise<void> {
  pointer(node, 'pointerdown');
  await new Promise((resolve) => setTimeout(resolve, HOLD_WAIT_MS));
  pointer(node, 'pointerup');
  await nextTick();
}

describe('报名二维码长按保存', () => {
  it('状态按 code 查表显示中文文案', async () => {
    await mountPage();
    expect(document.body.textContent).toContain('已通过');
  });

  it('二维码下方给出长按提示', async () => {
    await mountPage();
    const hints = [...document.querySelectorAll<HTMLElement>('.field-hint')].map((node) => node.textContent ?? '');
    expect(hints.some((text) => text.includes('长按二维码可保存图片'))).toBe(true);
  });

  it('长按约 550ms 调 device.saveImage 并提示已保存', async () => {
    const node = await mountPage();
    await hold(node);

    await vi.waitFor(() => expect(device.saveImage).toHaveBeenCalledWith(DATA_URL, FILE_NAME));
    expect(toast).toHaveBeenCalledWith('报名码图片已保存', 'success');
  });

  it('抬手太早不触发保存', async () => {
    const node = await mountPage();
    pointer(node, 'pointerdown');
    pointer(node, 'pointerup');
    await new Promise((resolve) => setTimeout(resolve, HOLD_WAIT_MS));
    expect(device.saveImage).not.toHaveBeenCalled();
  });

  it('按住后手指挪动超过阈值视为滚动，取消长按', async () => {
    const node = await mountPage();
    pointer(node, 'pointerdown', 20, 20);
    pointer(node, 'pointermove', 80, 20);
    await new Promise((resolve) => setTimeout(resolve, HOLD_WAIT_MS));
    expect(device.saveImage).not.toHaveBeenCalled();
  });

  it('原生未能落盘时提示保存失败', async () => {
    vi.mocked(device.saveImage).mockResolvedValue({ saved: false });
    const node = await mountPage();
    await hold(node);

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('保存失败，请稍后重试', 'error'));
  });

  it('用户取消按稳定错误码静默，不弹失败提示', async () => {
    vi.mocked(device.saveImage).mockRejectedValue(Object.assign(new Error('用户取消'), { code: 'cancelled' }));
    const node = await mountPage();
    await hold(node);

    await vi.waitFor(() => expect(device.saveImage).toHaveBeenCalledOnce());
    await nextTick();
    expect(toast).not.toHaveBeenCalled();
  });

  it('二维码没画出来时不保存空白图，提示失败', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const node = await mountPage();
    await hold(node);

    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('保存失败，请稍后重试', 'error'));
    expect(device.saveImage).not.toHaveBeenCalled();
  });

  it('没有原生桥时退回浏览器下载，并如实提示', async () => {
    vi.mocked(nativeBridge.hasNative).mockReturnValue(false);
    const clicked: HTMLAnchorElement[] = [];
    // click 定义在 HTMLElement.prototype 上，从那里替换才能拦住 <a> 的下载点击。
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
      clicked.push(this as HTMLAnchorElement);
    });
    const node = await mountPage();
    await hold(node);

    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.download).toBe(FILE_NAME);
    expect(clicked[0]!.href).toContain('data:image/png');
    expect(device.saveImage).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('报名码图片已保存', 'success');
  });
});
