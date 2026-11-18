/**
 * PWA 的两块状态：iOS 安装提示的「已关闭」记录，与 Service Worker 的注册守卫。
 *
 * 注册本身不联网：把 `navigator.serviceWorker`、构建环境与 `isSecureContext` 换成目标状态，
 * 只验证「该不该注册、注册到哪个地址、失败会不会把页面带崩」。平台判断与原生桥用 mock
 * 固定，安装提示的展示条件不依赖真实 UA。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  joinSurface: false,
  hasNative: false,
  ios: false,
  standalone: false,
}));

vi.mock('@/app/surface', () => ({
  get isJoinSurface() {
    return state.joinSurface;
  },
}));

vi.mock('@/services/native-bridge', () => ({
  nativeBridge: { hasNative: () => state.hasNative },
}));

vi.mock('./platform', () => ({
  isIos: () => state.ios,
  isStandalonePwa: () => state.standalone,
}));

import {
  IOS_INSTALL_HINT_KEY,
  dismissIosInstallHint,
  iosInstallHintDismissed,
  isIosInstallOffer,
  registerPwaServiceWorker,
} from './pwa';

interface Stub {
  target: object;
  key: string;
  original: PropertyDescriptor | undefined;
}

const stubs: Stub[] = [];

/** 改一个全局属性并记下原状；afterEach 逆序还原。 */
function stubProperty(target: object, key: string, value: unknown): void {
  stubs.push({ target, key, original: Object.getOwnPropertyDescriptor(target, key) });
  Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true });
}

function stubServiceWorker(register: unknown): void {
  stubProperty(navigator, 'serviceWorker', { register });
}

function stubSecureContext(secure: boolean): void {
  stubProperty(window, 'isSecureContext', secure);
}

function stubReadyState(readyState: DocumentReadyState): void {
  stubProperty(document, 'readyState', readyState);
}

function stubPersist(persist: unknown): void {
  stubProperty(navigator, 'storage', { persist });
}

/** 把「生产构建的浏览器环境」一次摆好，单个用例只改自己要验证的那一条。 */
function readyBrowser(register: ReturnType<typeof vi.fn>): void {
  vi.stubEnv('PROD', true);
  stubSecureContext(true);
  stubReadyState('complete');
  stubServiceWorker(register);
  stubPersist(vi.fn().mockResolvedValue(true));
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

beforeEach(() => {
  state.joinSurface = false;
  state.hasNative = false;
  state.ios = false;
  state.standalone = false;
  localStorage.removeItem(IOS_INSTALL_HINT_KEY);
});

afterEach(() => {
  for (let index = stubs.length - 1; index >= 0; index -= 1) {
    const stub = stubs[index];
    if (!stub) continue;
    if (stub.original) Object.defineProperty(stub.target, stub.key, stub.original);
    else Reflect.deleteProperty(stub.target, stub.key);
  }
  stubs.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('iOS 安装提示', () => {
  it('存储键固定为本机约定的名字', () => {
    expect(IOS_INSTALL_HINT_KEY).toBe('calmobile.iosInstallHint');
  });

  it('关掉后记在本机，之后读到的是已关掉', () => {
    expect(iosInstallHintDismissed()).toBe(false);

    dismissIosInstallHint();

    expect(localStorage.getItem(IOS_INSTALL_HINT_KEY)).toBe('1');
    expect(iosInstallHintDismissed()).toBe(true);
  });

  it('localStorage 读写抛错时安全降级', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('存储被禁用');
    });
    expect(iosInstallHintDismissed()).toBe(false);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('配额已满');
    });
    expect(() => dismissIosInstallHint()).not.toThrow();
    setItem.mockRestore();
  });

  it('是 iOS 且还没安装时才给安装引导', () => {
    state.ios = true;
    state.standalone = false;
    expect(isIosInstallOffer()).toBe(true);

    state.standalone = true;
    expect(isIosInstallOffer()).toBe(false);

    state.ios = false;
    state.standalone = false;
    expect(isIosInstallOffer()).toBe(false);
  });
});

describe('registerPwaServiceWorker', () => {
  it('开发构建不注册：开发服务器没有生成的 sw.js', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    stubSecureContext(true);
    stubReadyState('complete');
    stubServiceWorker(register);

    registerPwaServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it('生产构建的浏览器里注册 base 下的 sw.js 与 scope，并申请持久存储', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubEnv('PROD', true);
    stubSecureContext(true);
    stubReadyState('complete');
    stubServiceWorker(register);
    stubPersist(persist);

    registerPwaServiceWorker();

    const base = import.meta.env.BASE_URL;
    expect(register).toHaveBeenCalledWith(`${base}sw.js`, { scope: base });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('报名站构建不注册', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    state.joinSurface = true;
    readyBrowser(register);

    registerPwaServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it('App 内置 WebView（有原生桥）不注册', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    state.hasNative = true;
    readyBrowser(register);

    registerPwaServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it('非安全上下文不注册', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    readyBrowser(register);
    stubSecureContext(false);

    registerPwaServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it('没有 Service Worker 支持时不注册也不抛错', () => {
    vi.stubEnv('PROD', true);
    stubSecureContext(true);
    stubReadyState('complete');
    stubPersist(vi.fn().mockResolvedValue(true));
    // jsdom 默认没有 navigator.serviceWorker，正好等于老浏览器。
    expect(() => registerPwaServiceWorker()).not.toThrow();
  });

  it('load 还没结束时等 load 再注册', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv('PROD', true);
    stubSecureContext(true);
    stubReadyState('loading');
    stubServiceWorker(register);
    stubPersist(vi.fn().mockResolvedValue(true));

    registerPwaServiceWorker();
    expect(register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledOnce();
  });

  it('注册被拒绝时只记日志，不打断页面也不留未处理的 rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const register = vi.fn().mockRejectedValue(new Error('注册被拒绝'));
    readyBrowser(register);

    expect(() => registerPwaServiceWorker()).not.toThrow();
    await flush();

    expect(warn).toHaveBeenCalled();
  });

  it('注册同步抛错时同样只记日志', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const register = vi.fn(() => {
      throw new Error('Service Worker 被策略禁用');
    });
    readyBrowser(register);

    expect(() => registerPwaServiceWorker()).not.toThrow();
    await flush();

    expect(warn).toHaveBeenCalled();
  });

  it('持久存储申请失败不影响注册', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    readyBrowser(register);
    stubPersist(vi.fn().mockRejectedValue(new Error('配额不可用')));

    registerPwaServiceWorker();
    await flush();

    expect(register).toHaveBeenCalledOnce();
  });
});
