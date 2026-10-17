/**
 * 「选择图像扫码」在没有原生桥时的识别链路（浏览器预览 / 报名站）：file input 选文件 →
 * 缩放 / 读像素 → 同一个解码器 → 与摄像头同一条核销路径。
 * 应用里有原生桥时走 device.pickImage，那一条见 checkin-lifecycle.test.ts。
 * 失败分三种：没识别到给行内提示、图片读不出来给错误提示、取消选择保持静默。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import CheckinPage from './CheckinPage.vue';
import { useSessionStore } from '@/stores/session';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { api } from '@/app/runtime';

vi.mock('@/app/runtime', () => ({ api: { checkIn: vi.fn() } }));
vi.mock('@/services/qr-decoder', () => ({ createQrDecoder: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { ensureCameraPermission: vi.fn().mockResolvedValue(true), pickImage: vi.fn() },
}));
// 本文件锁的是「没有原生桥」时的 file input 通道（应用里的原生通道见 checkin-lifecycle.test.ts）。
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => false) } }));
vi.mock('@/composables/useHint', () => ({ useHint: () => ({ dismiss: vi.fn() }) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
// 本文件不关心底部面板，只锁选图链路。
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn() }));

const CODE = 'CALMOBILE-CHECKIN|秋季展会|报名-1';
let app: App | undefined;
let decoder: QrDecoder;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let drawImage: ReturnType<typeof vi.fn>;
let getImageData: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  bitmap = { width: 2400, height: 1200, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  drawImage = vi.fn();
  getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(16), width: 1600, height: 800 }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    getImageData,
  } as unknown as CanvasRenderingContext2D);
  decoder = { ready: Promise.resolve(), decode: vi.fn().mockResolvedValue(null), dispose: vi.fn() };
  vi.mocked(createQrDecoder).mockReturnValue(decoder);
  vi.mocked(api.checkIn).mockResolvedValue({ ok: true });
  document.body.innerHTML = '<div id="checkin-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function mountPage(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor', can: { limited: false } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/checkin', component: CheckinPage }],
  });
  await router.push('/checkin');
  app = createApp(CheckinPage).use(pinia).use(router);
  app.mount('#checkin-test');
  await nextTick();
}

/** 模拟系统选择器回文件：files 在 jsdom 里是只读的，用 defineProperty 直接换掉。 */
function chooseFile(file: File | null): void {
  const input = document.querySelector<HTMLInputElement>('[data-action="pick-image-input"]')!;
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pickButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('[data-action="pick-image"]')!;
}

describe('选择图像扫码', () => {
  it('识别成功走与摄像头相同的核销路径，长边缩到 1600 以内', async () => {
    vi.mocked(decoder.decode).mockResolvedValue(CODE);
    await mountPage();
    pickButton().click();
    chooseFile(new File(['x'], 'qr.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(api.checkIn).toHaveBeenCalledWith(CODE));
    // 2400x1200 等比缩到 1600x800，再交给解码器
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 800);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('没识别到给行内提示，不弹错误块也不核销', async () => {
    await mountPage();
    pickButton().click();
    chooseFile(new File(['x'], 'qr.png', { type: 'image/png' }));

    await vi.waitFor(() =>
      expect(document.querySelector('.notice')?.textContent).toContain('这张图片里没有识别到报名码'),
    );
    expect(document.querySelector('.notice[data-tone="error"]')).toBeNull();
    expect(api.checkIn).not.toHaveBeenCalled();
  });

  it('图片读不出来给错误提示，不核销', async () => {
    // 内核解出了图但拿不到尺寸，等价于这张图读不出来
    bitmap.width = 0;
    bitmap.height = 0;
    await mountPage();
    pickButton().click();
    chooseFile(new File(['x'], 'broken.png', { type: 'image/png' }));

    await vi.waitFor(() =>
      expect(document.querySelector('.notice[data-tone="error"]')?.textContent).toContain('无法读取这张图片'),
    );
    expect(decoder.decode).not.toHaveBeenCalled();
    expect(api.checkIn).not.toHaveBeenCalled();
  });

  it('内核没有 createImageBitmap 时退回 Image + object URL', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const createObjectURL = vi.fn(() => 'blob:qr');
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 160;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.mocked(decoder.decode).mockResolvedValue(CODE);
    try {
      await mountPage();
      pickButton().click();
      chooseFile(new File(['x'], 'qr.png', { type: 'image/png' }));

      await vi.waitFor(() => expect(api.checkIn).toHaveBeenCalledWith(CODE));
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 320, 160);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('用户取消选择时保持静默', async () => {
    await mountPage();
    pickButton().click();
    chooseFile(null);
    await nextTick();

    expect(decoder.decode).not.toHaveBeenCalled();
    expect(api.checkIn).not.toHaveBeenCalled();
    expect(document.querySelector('.notice')).toBeNull();
  });

  it('选图前停掉摄像头取景，解码期间按钮禁用', async () => {
    const stopTrack = vi.fn();
    const media = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(media);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(960);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let finish!: (text: string | null) => void;
    vi.mocked(decoder.decode).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mountPage();
    document.querySelector<HTMLButtonElement>('[data-action="start-scan"]')!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('.notice')?.textContent).toContain('正在识别，请把报名码放进取景框。'),
    );

    pickButton().click();
    expect(stopTrack).toHaveBeenCalledOnce();
    chooseFile(new File(['x'], 'qr.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(decoder.decode).toHaveBeenCalledOnce());
    await nextTick();
    expect(pickButton().disabled).toBe(true);

    finish(CODE);
    await vi.waitFor(() => expect(api.checkIn).toHaveBeenCalledWith(CODE));
  });
});
