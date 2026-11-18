/**
 * 平台判断的两层：`detectPlatform()` 是纯函数，直接喂 UA 快照；`currentPlatform()` 及其便捷入口
 * 再从 navigator / matchMedia 取一次快照，确认这一层没把字段接错。
 *
 * 重点覆盖几类会被误判的真实 UA：iPadOS 桌面版（长得像 Mac）、iOS 上的第三方浏览器
 * （UA 里带 Safari 字样）、微信等内置浏览器、主屏幕应用的两种 standalone 线索。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentPlatform, detectPlatform, isInAppBrowser, isIos, isIosSafari, isStandalonePwa } from './platform';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPOD_SAFARI =
  'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
// iPadOS 13+ 默认报桌面版 UA：只有 Macintosh 字样，靠触点数区分。
const IPADOS_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15';
const IPHONE_EDGE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.2478.71 Mobile/15E148 Safari/605.1.15';
const IPHONE_OPERA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/2.2.0.11280 Mobile/15E148 Safari/9537.53';
const IPHONE_GOOGLE_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/312.0.0.0 Mobile/15E148 Safari/604.1';
// 微信内置浏览器：没有 Safari 字样。
const IPHONE_WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x1800317d) NetType/WIFI Language/zh_CN';
// 构造的对照 UA：带 Safari 字样但确实是微信，验证「内置浏览器优先于 Safari」。
const IPHONE_WECHAT_WITH_SAFARI = `${IPHONE_SAFARI} MicroMessenger/8.0.49`;
const IPHONE_DINGTALK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 DingTalk/7.6.0';
const IPHONE_ALIPAY =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AlipayClient/10.5.60.8000';
const IPHONE_FEISHU =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Lark/7.5.0';
// iOS 上的裸 WKWebView：WebKit 外壳，但没有 Safari 字样。
const IPHONE_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
const ANDROID_WECHAT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49';

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

/** 伪造 `matchMedia`：只关心是不是 standalone 查询。 */
function stubMatchMedia(standalone: boolean): void {
  stubProperty(window, 'matchMedia', (query: string) => ({
    matches: standalone && query.includes('display-mode: standalone'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  for (let index = stubs.length - 1; index >= 0; index -= 1) {
    const stub = stubs[index];
    if (!stub) continue;
    if (stub.original) Object.defineProperty(stub.target, stub.key, stub.original);
    else Reflect.deleteProperty(stub.target, stub.key);
  }
  stubs.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('detectPlatform', () => {
  it('iPhone Safari：iOS + iPhone + Safari，不是内置浏览器', () => {
    expect(detectPlatform({ userAgent: IPHONE_SAFARI })).toEqual({
      ios: true,
      iphone: true,
      ipad: false,
      safari: true,
      inAppBrowser: false,
      standalone: false,
    });
  });

  it('iPad Safari 归到 ipad，iPod touch 只算 ios', () => {
    expect(detectPlatform({ userAgent: IPAD_SAFARI })).toMatchObject({ ios: true, ipad: true, iphone: false });
    expect(detectPlatform({ userAgent: IPOD_SAFARI })).toMatchObject({ ios: true, ipad: false, iphone: false });
  });

  it('Macintosh UA + 多点触控算 iPadOS，没有触点的 Mac 不算 iOS', () => {
    expect(detectPlatform({ userAgent: IPADOS_DESKTOP, maxTouchPoints: 5 })).toMatchObject({
      ios: true,
      ipad: true,
      iphone: false,
      safari: true,
    });
    expect(detectPlatform({ userAgent: IPADOS_DESKTOP, maxTouchPoints: 0 })).toMatchObject({
      ios: false,
      ipad: false,
      safari: true,
    });
    // 只有 1 个触点也不足以证明是 iPad（真 Mac 没有触摸屏，这条是保守下限）。
    expect(detectPlatform({ userAgent: IPADOS_DESKTOP, maxTouchPoints: 1 }).ios).toBe(false);
  });

  it('iOS 上的 Chrome / Firefox / Edge / Opera / Google App 不算 Safari', () => {
    for (const userAgent of [IPHONE_CHROME, IPHONE_FIREFOX, IPHONE_EDGE, IPHONE_OPERA, IPHONE_GOOGLE_APP]) {
      expect(detectPlatform({ userAgent })).toMatchObject({ ios: true, safari: false, inAppBrowser: false });
    }
  });

  it('微信 / 钉钉 / 支付宝 / 飞书算内置浏览器，且不算 Safari', () => {
    for (const userAgent of [IPHONE_WECHAT, IPHONE_DINGTALK, IPHONE_ALIPAY, IPHONE_FEISHU]) {
      expect(detectPlatform({ userAgent })).toMatchObject({ ios: true, inAppBrowser: true, safari: false });
    }
    // 对照 UA 带 Safari 字样，仍按内置浏览器处理。
    expect(detectPlatform({ userAgent: IPHONE_WECHAT_WITH_SAFARI })).toMatchObject({
      ios: true,
      inAppBrowser: true,
      safari: false,
    });
  });

  it('iOS 上裸 WebView（WebKit 外壳但没有 Safari 字样）算内置浏览器', () => {
    expect(detectPlatform({ userAgent: IPHONE_WEBVIEW })).toMatchObject({
      ios: true,
      inAppBrowser: true,
      safari: false,
    });
  });

  it('Android Chrome 不是 iOS、不算 Safari 也不算内置浏览器；Android 微信算内置浏览器', () => {
    expect(detectPlatform({ userAgent: ANDROID_CHROME })).toEqual({
      ios: false,
      iphone: false,
      ipad: false,
      safari: false,
      inAppBrowser: false,
      standalone: false,
    });
    expect(detectPlatform({ userAgent: ANDROID_WECHAT })).toMatchObject({ ios: false, inAppBrowser: true });
  });

  it('standalone 由 display-mode 或 navigator.standalone 任一给出', () => {
    expect(detectPlatform({ userAgent: IPHONE_SAFARI, displayModeStandalone: true }).standalone).toBe(true);
    expect(detectPlatform({ userAgent: IPHONE_SAFARI, standalone: true }).standalone).toBe(true);
    expect(
      detectPlatform({ userAgent: IPHONE_SAFARI, standalone: false, displayModeStandalone: false }).standalone,
    ).toBe(false);
  });

  it('空快照全部落到 false', () => {
    expect(detectPlatform({ userAgent: '' })).toEqual({
      ios: false,
      iphone: false,
      ipad: false,
      safari: false,
      inAppBrowser: false,
      standalone: false,
    });
  });
});

describe('currentPlatform', () => {
  it('从 navigator 取 UA 与触点：iPadOS 桌面版 UA 也算 iOS', () => {
    stubProperty(navigator, 'userAgent', IPADOS_DESKTOP);
    stubProperty(navigator, 'maxTouchPoints', 5);

    expect(currentPlatform()).toMatchObject({ ios: true, ipad: true, iphone: false, safari: true });
    expect(isIos()).toBe(true);
    expect(isIosSafari()).toBe(true);
    expect(isInAppBrowser()).toBe(false);
  });

  it('navigator.standalone 为 true 时算已安装的主屏幕应用', () => {
    stubProperty(navigator, 'userAgent', IPHONE_SAFARI);
    stubProperty(navigator, 'standalone', true);

    expect(isStandalonePwa()).toBe(true);
  });

  it('matchMedia 报 display-mode: standalone 时也算已安装', () => {
    stubProperty(navigator, 'userAgent', IPHONE_SAFARI);
    stubMatchMedia(true);

    expect(isStandalonePwa()).toBe(true);
  });

  it('iPhone 微信内置浏览器：isIos 为真但 isIosSafari 为假', () => {
    stubProperty(navigator, 'userAgent', IPHONE_WECHAT);

    expect(isIos()).toBe(true);
    expect(isIosSafari()).toBe(false);
    expect(isInAppBrowser()).toBe(true);
    expect(isStandalonePwa()).toBe(false);
  });

  it('Android Chrome：四个入口都是 false', () => {
    stubProperty(navigator, 'userAgent', ANDROID_CHROME);

    expect(currentPlatform()).toMatchObject({ ios: false, safari: false, inAppBrowser: false, standalone: false });
    expect(isIos()).toBe(false);
    expect(isIosSafari()).toBe(false);
    expect(isInAppBrowser()).toBe(false);
    expect(isStandalonePwa()).toBe(false);
  });

  it('没有 navigator 的环境里所有入口安全返回 false', () => {
    // 构建期（纯 Node）既没有 window 也没有 navigator；jsdom 里的 window 属性不可重定义，
    // 这里摘掉 navigator，走的是 `snapshotOfCurrentPlatform()` 的同一条空快照分支。
    stubProperty(window, 'navigator', undefined);

    expect(currentPlatform()).toEqual({
      ios: false,
      iphone: false,
      ipad: false,
      safari: false,
      inAppBrowser: false,
      standalone: false,
    });
    expect(isIos()).toBe(false);
    expect(isIosSafari()).toBe(false);
    expect(isInAppBrowser()).toBe(false);
    expect(isStandalonePwa()).toBe(false);
  });
});
