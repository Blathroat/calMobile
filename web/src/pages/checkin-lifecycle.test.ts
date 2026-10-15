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
vi.mock('@/services/device-services', () => ({ device: { ensureCameraPermission: vi.fn().mockResolvedValue(true) } }));
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

function scanButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('button.cta')!;
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
    scanButton().click();
    await vi.waitFor(() => expect(nextFrame).toBeDefined());
    nextFrame!(120);
    await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce());
    nextFrame!(240);
    expect(decoder.decode).toHaveBeenCalledTimes(1);
    if (action === 'stop') scanButton().click();
    else if (action === 'manual') document.querySelector<HTMLButtonElement>('button.cta.ghost')!.click();
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
    scanButton().click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    expect(scanButton().disabled).toBe(true);
    scanButton().click();
    expect(device.ensureCameraPermission).toHaveBeenCalledOnce();
    if (action === 'unmount') {
      app?.unmount();
      app = undefined;
    } else document.querySelector<HTMLButtonElement>('button.cta.ghost')!.click();
    finish(media);
    await nextTick();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    if (action === 'unmount') expect(decoder.dispose).toHaveBeenCalledOnce();
  });

  it('识别失败会释放相机并显示手动输入提示', async () => {
    vi.mocked(decoder.decode).mockRejectedValue(new Error('WASM failed'));
    await mountPage();
    scanButton().click();
    await vi.waitFor(() => expect(nextFrame).toBeDefined());
    nextFrame!(120);
    await vi.waitFor(() => expect(document.querySelector('.notice[data-tone="error"]')).not.toBeNull());
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(api.checkIn).not.toHaveBeenCalled();
  });
});
