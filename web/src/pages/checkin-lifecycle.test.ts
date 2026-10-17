import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import CheckinPage from './CheckinPage.vue';
import { useSessionStore } from '@/stores/session';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { device } from '@/services/device-services';
import { api } from '@/app/runtime';

vi.mock('@/app/runtime', () => ({ api: { checkIn: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('@/services/qr-decoder', () => ({ createQrDecoder: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { ensureCameraPermission: vi.fn().mockResolvedValue(true), pickImage: vi.fn() },
}));
vi.mock('@/composables/useHint', () => ({ useHint: () => ({ dismiss: vi.fn() }) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn() }));

let app: App | undefined;
let decoder: QrDecoder;
let nextFrame: FrameRequestCallback | undefined;
let frameId = 0;
const stopTrack = vi.fn();
const media = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const getUserMedia = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  nextFrame = undefined;
  decoder = { ready: Promise.resolve(), decode: vi.fn().mockResolvedValue(null), dispose: vi.fn() };
  vi.mocked(createQrDecoder).mockReturnValue(decoder);
  getUserMedia.mockResolvedValue(media);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return ++frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    nextFrame = undefined;
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(960);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(640 * 480 * 4), width: 640, height: 480 }),
  } as unknown as CanvasRenderingContext2D);
  document.body.innerHTML = '<div id="checkin-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function mountPage(limited = false): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor', can: { limited } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/checkin', component: CheckinPage }],
  });
  await router.push('/checkin');
  app = createApp(CheckinPage).use(pinia).use(router);
  app.mount('#checkin-test');
  await nextTick();
}

/** 按钮用 data-action 定位：并排按钮的类名相同，靠 .cta / .cta.ghost 取会串到别的按钮上。 */
function actionButton(action: 'start-scan' | 'pick-image' | 'manual'): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
}

describe('核销页面的异步识别与相机生命周期', () => {
  it('受限账号不创建解码 Worker 或申请相机', async () => {
    await mountPage(true);
    expect(createQrDecoder).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each(['stop', 'unmount', 'manual'] as const)('%s 之后的旧帧不会发起核销，解码期间不重复取帧', async (action) => {
    let finish!: (text: string | null) => void;
    vi.mocked(decoder.decode).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mountPage();
    actionButton('start-scan').click();
    await vi.waitFor(() => expect(nextFrame).toBeDefined());
    nextFrame!(120);
    await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce());
    nextFrame!(240);
    expect(decoder.decode).toHaveBeenCalledTimes(1);
    if (action === 'stop') actionButton('start-scan').click();
    else if (action === 'manual') actionButton('manual').click();
    else {
      app?.unmount();
      app = undefined;
    }
    finish('CALMOBILE-CHECKIN|late-frame');
    await nextTick();
    await Promise.resolve();
    expect(api.checkIn).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    if (action === 'unmount') expect(decoder.dispose).toHaveBeenCalledOnce();
  });

  it.each(['unmount', 'manual'] as const)('相机尚未返回时保持忙碌；%s 后新返回的媒体立即释放', async (action) => {
    let finish!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mountPage();
    actionButton('start-scan').click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    expect(actionButton('start-scan').disabled).toBe(true);
    actionButton('start-scan').click();
    expect(device.ensureCameraPermission).toHaveBeenCalledOnce();
    if (action === 'unmount') {
      app?.unmount();
      app = undefined;
    } else actionButton('manual').click();
    finish(media);
    await nextTick();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    if (action === 'unmount') expect(decoder.dispose).toHaveBeenCalledOnce();
  });

  it('识别失败会释放相机并显示手动输入提示', async () => {
    vi.mocked(decoder.decode).mockRejectedValue(new Error('WASM failed'));
    await mountPage();
    actionButton('start-scan').click();
    await vi.waitFor(() => expect(nextFrame).toBeDefined());
    nextFrame!(120);
    await vi.waitFor(() => expect(document.querySelector('.notice[data-tone="error"]')).not.toBeNull());
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(api.checkIn).not.toHaveBeenCalled();
  });

  // ── 选择图像扫码：应用里走原生 device.pickImage（WebView 关着文件访问，<input type=file> 读不到 content://） ──

  /** 原生桥存在时按钮走 device.pickImage；这里只放一个假的 Image，让 dataUrl 能解出尺寸。 */
  function stubNativeBridge(): void {
    vi.stubGlobal('CalMobileNative', { invoke: vi.fn() });
  }

  function stubImage(width: number, height: number): void {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = width;
      naturalHeight = height;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
  }

  it('应用里选图解码到报名码后发起核销', async () => {
    stubNativeBridge();
    stubImage(1080, 720);
    vi.mocked(device.pickImage).mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,native' });
    vi.mocked(decoder.decode).mockResolvedValue('CALMOBILE-CHECKIN|native-pick');
    await mountPage();

    actionButton('pick-image').click();

    await vi.waitFor(() => expect(api.checkIn).toHaveBeenCalledWith('CALMOBILE-CHECKIN|native-pick'));
    expect(device.pickImage).toHaveBeenCalledOnce();
    // 走的是同一条核销路径：识别后停在已识别状态，不再继续取景。
    expect(document.body.textContent).toContain('已识别报名码');
  });

  it('应用里选图没有识别到码时给行内提示，不核销', async () => {
    stubNativeBridge();
    stubImage(1080, 720);
    vi.mocked(device.pickImage).mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,native' });
    vi.mocked(decoder.decode).mockResolvedValue(null);
    await mountPage();

    actionButton('pick-image').click();

    await vi.waitFor(() =>
      expect(document.querySelector('.notice')?.textContent).toContain('这张图片里没有识别到报名码'),
    );
    expect(document.querySelector('.notice[data-tone="error"]')).toBeNull();
    expect(api.checkIn).not.toHaveBeenCalled();
  });

  it('应用里选图被取消时保持静默', async () => {
    stubNativeBridge();
    vi.mocked(device.pickImage).mockRejectedValue(Object.assign(new Error('用户取消'), { code: 'cancelled' }));
    await mountPage();

    actionButton('pick-image').click();

    await vi.waitFor(() => expect(device.pickImage).toHaveBeenCalledOnce());
    await nextTick();
    expect(api.checkIn).not.toHaveBeenCalled();
    expect(document.querySelector('.notice')).toBeNull();
  });
});
