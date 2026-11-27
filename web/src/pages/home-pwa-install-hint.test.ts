/**
 * 首页的 PWA 安装引导：每次访问 /app（页面加载 / 刷新）都在首屏之后弹一次；
 * **同一次页面会话里只弹一次**——底部导航切走再切回首页（页面重新挂载）不重复；
 * 关闭不写任何本机状态，刷新后模块重建，于是下次访问又会提示。
 * 原生 App（有桥）、已装到主屏幕的独立窗口、用户协议待确认、别的抽屉开着时不弹；
 * 离开首页要清掉定时器，不能在别的页面上弹。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, bootApp } from '@/app/runtime';
import { agreementConsentPending } from '@/services/agreement-prompt';
import { nativeBridge } from '@/services/native-bridge';
import { closeSheet, openSheet, sheet } from '@/services/sheet';
import { resetInstallHintVisitForTests } from './HomePage.vue';
import { mountHomePage, unmountHomePages } from './home-test-utils';

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn() },
    exhibitions: { list: vi.fn(), month: vi.fn(), get: vi.fn(async () => ({})) },
    settings: { get: vi.fn(async () => ({})) },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: vi.fn(),
}));
vi.mock('@/app/preload', () => ({ preloadAdjacentMonths: vi.fn() }));
// 安装引导的真实判断只看「独立 PWA / 原生桥」；协议确认也要能单独控制。
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => false) } }));
vi.mock('@/services/agreement-prompt', () => ({ agreementConsentPending: vi.fn(() => false) }));

const stubs: { target: object; key: string; original: PropertyDescriptor | undefined }[] = [];

/** 改一个全局属性并记下原状；afterEach 逆序还原。 */
function stubProperty(target: object, key: string, value: unknown): void {
  stubs.push({ target, key, original: Object.getOwnPropertyDescriptor(target, key) });
  Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true });
}

beforeEach(() => {
  // 首页默认落在当前自然月：把「今天」固定在 2026-06-05，用例里的 6 月数据才是当前月。
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-05T10:00:00'));
  vi.clearAllMocks();
  localStorage.clear();
  // 每个用例从一个新的「页面访问」开始：模块级标记清空，等同刷新页面。
  resetInstallHintVisitForTests();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  vi.mocked(api.exhibitions.month).mockResolvedValue({ day: 0, exhibitions: [], meetings: [] });
  vi.mocked(nativeBridge.hasNative).mockReturnValue(false);
  vi.mocked(agreementConsentPending).mockReturnValue(false);
});

afterEach(() => {
  unmountHomePages();
  if (sheet.current) closeSheet();
  document.body.innerHTML = '';
  for (let index = stubs.length - 1; index >= 0; index -= 1) {
    const stub = stubs[index];
    if (!stub) continue;
    if (stub.original) Object.defineProperty(stub.target, stub.key, stub.original);
    else Reflect.deleteProperty(stub.target, stub.key);
  }
  stubs.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('首页 PWA 安装引导', () => {
  it('每次访问都在首屏之后弹出，关闭不写任何本机状态', async () => {
    await mountHomePage();
    // 首帧不该立刻盖住页面
    expect(sheet.current).toBeNull();

    await vi.waitFor(() => expect(sheet.current?.title).toBe('安装到主屏幕'), { timeout: 2000 });
    expect(sheet.current?.props).toEqual({ mode: 'app' });

    closeSheet();
    await vi.waitFor(() => expect(sheet.current).toBeNull(), { timeout: 2000 });
    // 关闭只是收起抽屉：本机不记「已关闭」，刷新或下次进入仍会提示。
    expect(localStorage.length).toBe(0);
  });

  it('同一次页面会话里切走再切回首页不重复弹', async () => {
    await mountHomePage();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('安装到主屏幕'), { timeout: 2000 });
    closeSheet();
    await vi.waitFor(() => expect(sheet.current).toBeNull(), { timeout: 2000 });
    unmountHomePages();

    // 底部导航切回首页：页面重新挂载，但模块没重建，本次访问已经提示过。
    await mountHomePage();
    await wait(700);
    expect(sheet.current).toBeNull();
  });

  it('刷新 / 重新打开页面（模块重建）后下次访问仍会弹', async () => {
    await mountHomePage();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('安装到主屏幕'), { timeout: 2000 });
    unmountHomePages();

    resetInstallHintVisitForTests();
    await mountHomePage();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('安装到主屏幕'), { timeout: 2000 });
  });

  it('原生 App（有原生桥）里不弹', async () => {
    vi.mocked(nativeBridge.hasNative).mockReturnValue(true);
    await mountHomePage();
    await wait(700);
    expect(sheet.current).toBeNull();
  });

  it('已经从主屏幕启动的独立窗口不弹', async () => {
    stubProperty(navigator, 'standalone', true);
    await mountHomePage();
    await wait(700);
    expect(sheet.current).toBeNull();
  });

  it('用户协议待确认时不抢在它前面', async () => {
    vi.mocked(agreementConsentPending).mockReturnValue(true);
    await mountHomePage();
    await wait(700);
    expect(sheet.current).toBeNull();
  });

  it('别的抽屉开着时不叠第二层', async () => {
    openSheet({ title: '用户协议更新', message: '先处理这个' });
    await mountHomePage();
    await wait(700);
    expect(sheet.current?.title).toBe('用户协议更新');
  });

  it('离开首页后定时器被清掉，不会在别的页面上弹', async () => {
    await mountHomePage();
    unmountHomePages();
    await wait(700);
    expect(sheet.current).toBeNull();
  });
});
