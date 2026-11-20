/**
 * 判断当前是不是 iOS / Safari / 主屏幕应用 / 内置浏览器。
 *
 * 只做 UA 与少量 Web API 的快照判断，不缓存、不读业务数据：调用点（安装提示、分享降级、
 * 返回按钮）都是零散时机，缓存反而让测试要先重置状态。
 *
 * **iPadOS 的坑**：iPadOS 13 起默认按桌面版 Safari 报 UA（`Macintosh`），只看 UA 会把 iPad
 * 认成 Mac。桌面版 iPad 的触点数大于 1，Mac 笔记本的 `maxTouchPoints` 是 0，靠它区分；
 * 目前不存在带触摸屏的 Mac。
 *
 * **Safari 的坑**：iOS 上的 Chrome / Firefox / Edge / Opera / Google App 的 UA 里同样带
 * `Safari/` 字样，微信、钉钉、支付宝、飞书等 App 的内置浏览器也可能带。因此「是 Safari」
 * 必须是「有 Safari 字样」且「没有其它浏览器 / 内置浏览器的标记」。
 *
 * **standalone**：主屏幕应用有两条线索 —— `display-mode: standalone` 与 iOS 独有的
 * `navigator.standalone`。任一为真即算，不同 iOS 版本只稳定提供其中一个。
 *
 * 所有入口在无 `window` 的构建 / 纯 Node 测试环境里都安全：拿不到快照就按「什么都不是」处理。
 */

/** 参与判断的原始信号。单独拆出来是为了让 `detectPlatform()` 可被测试直接喂数据。 */
export interface PlatformSnapshot {
  /** 原始 UA。空串等价于「什么都不知道」，所有判断都会落到 false。 */
  userAgent: string;
  /** 触点数量，只用来把 iPadOS 的桌面版 UA 与真 Mac 分开。 */
  maxTouchPoints?: number;
  /** iOS 独有：页面是否从主屏幕启动（`navigator.standalone`）。 */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)')` 的结果。 */
  displayModeStandalone?: boolean;
}

/** 页面要据此换行为的平台结论。字段之间不互斥：iPad 上的 Chrome 是 ios 但 not safari。 */
export interface PlatformInfo {
  ios: boolean;
  ipad: boolean;
  iphone: boolean;
  safari: boolean;
  inAppBrowser: boolean;
  standalone: boolean;
}

/** iPhone / iPad / iPod 都算 iOS；iPod 既不是 iPhone 也不是 iPad。 */
const IPHONE_DEVICE = /iphone/i;
const IPAD_DEVICE = /ipad/i;
const IPOD_DEVICE = /ipod/i;

/** Android 设备（含内置浏览器与各家壳）的 UA 标记；安装引导据此换一套步骤。 */
const ANDROID_DEVICE = /android/i;

/** iPadOS 桌面版 UA 的 `Macintosh` 标记。 */
const MACINTOSH_DESKTOP = /macintosh/i;

/** iOS 内置浏览器都是 WebKit 外壳，用「有 AppleWebKit 但没有 Safari 字样」认 WebView。 */
const APPLE_WEBKIT = /applewebkit/i;
const SAFARI_TOKEN = /safari/i;

/**
 * UA 里带 `Safari/` 字样的非 Safari 浏览器。
 * 桌面 Chromium / Firefox 也列进来：`safari` 表达的是「真的是 Safari」，不是「WebKit 内核」。
 */
const NON_SAFARI_BROWSERS = [
  'CriOS', // iOS Chrome
  'FxiOS', // iOS Firefox
  'EdgiOS', // iOS Edge
  'OPiOS', // iOS Opera
  'GSA', // Google App
  'DuckDuckGo',
  'YaBrowser',
  'Chrome/',
  'Chromium',
  'Edg/', // 桌面 Edge（iOS 用 EdgiOS）
  'EdgA/', // Android Edge
  'OPR/', // 桌面 Opera
  'SamsungBrowser',
  'Firefox/',
  'Vivaldi',
  'Brave',
  'UCBrowser',
  'MQQBrowser',
] as const;

/**
 * 内置浏览器：页面被嵌在别的 App 的 WebView 里，分享、下载、安装提示都要换一套做法。
 * `QQ` 同时覆盖 QQ 与 QQ 浏览器；`MQQBrowser` 另列一次只是为了让人看得懂从哪来。
 */
const IN_APP_BROWSERS = [
  'MicroMessenger', // 微信
  'WeChat',
  'Weibo', // 微博
  'QQ', // QQ / QQ 浏览器
  'DingTalk', // 钉钉
  'AlipayClient', // 支付宝
  'Lark', // 飞书（国际版）
  'Feishu', // 飞书
  'FBAN', // Facebook
  'FBAV',
  'Instagram',
  'Line/',
  'Twitter',
  'Snapchat',
  'Pinterest',
  'LinkedIn',
  'aweme', // 抖音
  'BytedanceWebview',
  'baiduboxapp',
  'SogouMSE',
] as const;

/** UA 大小写不统一，统一转小写再比；token 表本身保持人读得懂的原样。 */
function includesAny(userAgent: string, tokens: readonly string[]): boolean {
  const ua = userAgent.toLowerCase();
  return tokens.some((token) => ua.includes(token.toLowerCase()));
}

/**
 * 从一份快照得出平台结论。纯函数：测试直接喂 UA，不必伪造 navigator。
 *
 * @param input UA / 触点 / standalone 三条线索
 */
export function detectPlatform(input: PlatformSnapshot): PlatformInfo {
  const userAgent = typeof input.userAgent === 'string' ? input.userAgent : '';
  const maxTouchPoints =
    typeof input.maxTouchPoints === 'number' && Number.isFinite(input.maxTouchPoints) ? input.maxTouchPoints : 0;

  // iPod touch 的 UA 里也带 `CPU iPhone OS`，先认 iPod，别把它算成 iPhone。
  const ipod = IPOD_DEVICE.test(userAgent);
  const iphone = !ipod && IPHONE_DEVICE.test(userAgent);
  const ipad = IPAD_DEVICE.test(userAgent) || (MACINTOSH_DESKTOP.test(userAgent) && maxTouchPoints > 1);
  const ios = iphone || ipad || ipod;

  // 内置浏览器：UA 里有明确标记，或是 iOS 上的裸 WebView（WebKit 外壳却没有 Safari 字样）。
  const inAppBrowser =
    includesAny(userAgent, IN_APP_BROWSERS) || (ios && APPLE_WEBKIT.test(userAgent) && !SAFARI_TOKEN.test(userAgent));

  // Safari 必须是 Safari：有 Safari 字样，且没有其它浏览器或内置浏览器的标记。
  const safari = SAFARI_TOKEN.test(userAgent) && !inAppBrowser && !includesAny(userAgent, NON_SAFARI_BROWSERS);

  return {
    ios,
    ipad,
    iphone,
    safari,
    inAppBrowser,
    standalone: input.standalone === true || input.displayModeStandalone === true,
  };
}

/** 取当前页面看到的 UA 与 standalone 线索；没有 `window` 或 `navigator` 时返回空快照。 */
function snapshotOfCurrentPlatform(): PlatformSnapshot {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { userAgent: '' };
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: typeof nav.userAgent === 'string' ? nav.userAgent : '',
    maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    standalone: nav.standalone === true,
    displayModeStandalone: prefersStandaloneDisplay(),
  };
}

/** `display-mode: standalone` 只在部分浏览器可用；matchMedia 缺失或抛错都按「不是」处理。 */
function prefersStandaloneDisplay(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

/** 当前平台的结论。每次现算，不缓存。 */
export function currentPlatform(): PlatformInfo {
  return detectPlatform(snapshotOfCurrentPlatform());
}

/** 当前是不是 iOS（含 iPadOS 桌面版 UA）。 */
export function isIos(): boolean {
  return currentPlatform().ios;
}

/** 当前是不是 iOS 上真正的 Safari：安装提示、Web Push、独立的分享面板都以它为前提。 */
export function isIosSafari(): boolean {
  const platform = currentPlatform();
  return platform.ios && platform.safari;
}

/**
 * 当前是不是 Android 设备。
 *
 * 安装引导要按 Android、iOS 与桌面分开给步骤，但 Android 不参与 iOS / Safari 的判断，
 * 所以只读 UA，不往 `PlatformInfo` 里加字段（iPadOS 桌面版 UA 的坑见文件头）。
 */
export function isAndroid(): boolean {
  return ANDROID_DEVICE.test(snapshotOfCurrentPlatform().userAgent);
}

/** 当前是不是从主屏幕启动的 PWA（已安装），此时不再提示「添加到主屏幕」。 */
export function isStandalonePwa(): boolean {
  return currentPlatform().standalone;
}

/** 当前是不是被别的 App 内置浏览器打开，此时下载与安装引导都走不通。 */
export function isInAppBrowser(): boolean {
  return currentPlatform().inAppBrowser;
}
