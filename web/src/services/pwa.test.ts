/**
 * PWA 的两块状态：安装引导的展示条件，与 Service Worker 的注册守卫。
 *
 * 安装引导只看平台与原生桥两个信号：非独立 PWA（不是从主屏幕启动）且没有原生桥（不是 App
 * 里的 WebView）才提示。**没有「本机关过没有」的本机存储**——每次进入应用都会重新判断，
 * 装到主屏幕或从原生 App 打开后条件自然为假。
 *
 * 注册本身不联网：把 `navigator.serviceWorker`、构建环境与 `isSecureContext` 换成目标状态，
 * 只验证「该不该注册、注册到哪个地址、失败会不会把页面带崩」。平台判断与原生桥用 mock 固定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  joinSurface: false,
  hasNative: false,
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
  isStandalonePwa: () => state.standalone,
}));

import { registerPwaServiceWorker, shouldOfferPwaInstall } from './pwa';

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
  state.standalone = false;
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

describe('安装引导的展示条件', () => {
  it('非独立 PWA 且没有原生桥时提供安装引导', () => {
    state.standalone = false;
    state.hasNative = false;
    expect(shouldOfferPwaInstall()).toBe(true);
  });

  it('已经装到主屏幕（独立 PWA）时不再提示', () => {
    state.standalone = true;
    expect(shouldOfferPwaInstall()).toBe(false);
  });

  it('原生 App（有原生桥）里不提示', () => {
    state.hasNative = true;
    expect(shouldOfferPwaInstall()).toBe(false);
  });

  it('独立 PWA 与原生桥同时成立时同样不提示', () => {
    state.standalone = true;
    state.hasNative = true;
    expect(shouldOfferPwaInstall()).toBe(false);
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
