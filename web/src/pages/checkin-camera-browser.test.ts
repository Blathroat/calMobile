/**
 * 浏览器 / iOS PWA 开摄像头取景（应用构建、没有原生桥）：
 *
 * - 不申请原生相机权限，直接 `getUserMedia`，而且请求要留在用户点击的同步栈里，
 *   中间不能先 await（iOS Safari 丢用户手势会直接拒绝）；
 * - `getUserMedia` 的错误名映射成中文提示，不能把英文原文塞进页面；
 * - 有原生桥时仍先走原生权限通道，拿不到权限就不开取景。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import CheckinPage from './CheckinPage.vue';
import { useSessionStore } from '@/stores/session';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';

vi.mock('@/app/runtime', () => ({ api: { checkIn: vi.fn() } }));
vi.mock('@/services/qr-decoder', () => ({ createQrDecoder: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { ensureCameraPermission: vi.fn(), pickImage: vi.fn() },
}));
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => false) } }));
vi.mock('@/composables/useHint', () => ({ useHint: () => ({ dismiss: vi.fn() }) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn() }));

let app: App | undefined;
let decoder: QrDecoder;
const getUserMedia = vi.fn();

function cameraError(name: string): Error {
  // 模拟浏览器给的英文原名：页面不能把它显示出来。
  return Object.assign(new Error(`English getUserMedia detail: ${name}`), { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  decoder = { ready: Promise.resolve(), decode: vi.fn().mockResolvedValue(null), dispose: vi.fn() };
  vi.mocked(createQrDecoder).mockReturnValue(decoder);
  vi.mocked(nativeBridge.hasNative).mockReturnValue(false);
  getUserMedia.mockReset();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
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

function startButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('[data-action="start-scan"]')!;
}

describe('浏览器里的摄像头取景', () => {
  it('直接 getUserMedia，不经原生权限通道，且在点击的同步栈里发起', async () => {
    // 请求一直挂着，只关心它有没有被立刻发出。
    getUserMedia.mockReturnValue(new Promise<MediaStream>(() => undefined));
    await mountPage();

    startButton().click();

    // 点击处理函数返回时请求已经发出：中间没有 await 把用户手势弄丢。
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(device.ensureCameraPermission).not.toHaveBeenCalled();
    const constraints = getUserMedia.mock.calls[0]![0] as MediaStreamConstraints;
    expect(constraints.audio).toBe(false);
    expect(constraints.video).toEqual({ facingMode: { ideal: 'environment' }, width: { ideal: 1280 } });
  });

  it.each([
    ['NotAllowedError', '没有获得摄像头权限，请在系统设置里允许后重试，或使用“选择图像扫码”。'],
    ['NotFoundError', '没有找到可用的摄像头，请使用“选择图像扫码”或“手动输入报名码”。'],
    ['OverconstrainedError', '没有找到可用的摄像头，请使用“选择图像扫码”或“手动输入报名码”。'],
    ['NotReadableError', '摄像头被其他应用占用，请关闭后重试，或使用“选择图像扫码”。'],
    ['TypeError', '当前环境不支持摄像头取景，请使用“选择图像扫码”或“手动输入报名码”。'],
  ])('getUserMedia 的 %s 映射成中文提示', async (name, expected) => {
    getUserMedia.mockRejectedValue(cameraError(name));
    await mountPage();

    startButton().click();

    await vi.waitFor(() => expect(document.body.textContent).toContain(expected));
    // 英文错误名与原文都不出现在页面上。
    expect(document.body.textContent).not.toContain(name);
    expect(document.body.textContent).not.toContain('English getUserMedia detail');
    expect(device.ensureCameraPermission).not.toHaveBeenCalled();
  });

  it('有原生桥时仍先申请原生相机权限，被拒绝就不开取景', async () => {
    vi.mocked(nativeBridge.hasNative).mockReturnValue(true);
    vi.mocked(device.ensureCameraPermission).mockResolvedValue(false);
    await mountPage();

    startButton().click();

    await vi.waitFor(() => expect(device.ensureCameraPermission).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('未获得摄像头权限，可在系统设置里开启，或使用“手动输入报名码”。'),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
