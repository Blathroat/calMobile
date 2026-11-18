/**
 * PWA 的两件事：注册离线用的 Service Worker，以及记录 iOS「添加到主屏幕」提示关没关过。
 *
 * **为什么 iOS 要单独一套提示**：iOS Safari 不支持 `beforeinstallprompt`，安装只能靠用户
 * 依次点「分享 → 添加到主屏幕」。页面只能自己给引导，并且要记住「别再显示了」——
 * 这个记录按设备存在 localStorage，换浏览器或清缓存后会重新出现，属于可接受的退化。
 *
 * **Service Worker 只在浏览器构建里注册**：App 里页面由 WebView 从本机快照加载，Service Worker
 * 帮不上忙还可能留下旧缓存；报名站是一次性的报名表单，不需要装到桌面。开发服务器没有生成
 * `sw.js`，热更新也会被缓存干扰，所以只在 `import.meta.env.PROD` 下注册。
 *
 * 注册失败只留一条控制台日志：离线能力是附加项，不能挡住页面。
 */
import { isJoinSurface } from '@/app/surface';
import { nativeBridge } from '@/services/native-bridge';
import { isIos, isStandalonePwa } from './platform';

/** iOS 安装提示「不再显示」的存储键。值只是存在标记，内容不重要。 */
export const IOS_INSTALL_HINT_KEY = 'calmobile.iosInstallHint';

/** 本机记下的「已关闭」标记。换值会让所有老用户重看一次提示，不要改。 */
const DISMISSED_VALUE = '1';

/**
 * 要不要给用户看 iOS 安装引导：是 iOS，并且当前不是从主屏幕启动的（即还没安装）。
 * 不看「关过没有」——那是调用点结合 `iosInstallHintDismissed()` 自己决定的展示时机。
 */
export function isIosInstallOffer(): boolean {
  return isIos() && !isStandalonePwa();
}

/** 本机是否已经关过 iOS 安装提示。存储不可读（隐私模式）时当作没关过。 */
export function iosInstallHintDismissed(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(IOS_INSTALL_HINT_KEY) === DISMISSED_VALUE;
  } catch {
    return false;
  }
}

/** 记下「不再显示 iOS 安装提示」。写失败只意味着下次还会出现，不往上抛。 */
export function dismissIosInstallHint(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(IOS_INSTALL_HINT_KEY, DISMISSED_VALUE);
  } catch {
    // 隐私模式或被禁用的存储：忽略。
  }
}

/**
 * 注册 Service Worker，让页面能离线打开。
 *
 * 守卫的每一条都对应一个不该注册的场景：
 * - 非生产构建：没有生成的 `sw.js`，注册只会 404，热更新也会被缓存干扰；
 * - 报名站构建：一次性表单，不装到桌面；
 * - 有原生桥：App 的页面由 WebView 从本机快照加载，Service Worker 无能为力；
 * - 非安全上下文：浏览器直接禁止注册（http 局域网调试时会命中）。
 *
 * `load` 之后注册，避免和首屏资源抢带宽；已经 load 完（比如脚本异步加载）就立即注册。
 */
export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (isJoinSurface) return;
  if (nativeBridge.hasNative()) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!window.isSecureContext) return;
  const container = navigator.serviceWorker;
  if (!container || typeof container.register !== 'function') return;

  // 脚本与作用域都跟着构建的 base：正式包挂在 /app/ 下，根路径的 sw.js 会 404。
  const base = import.meta.env.BASE_URL;
  const register = (): void => {
    try {
      void Promise.resolve(container.register(`${base}sw.js`, { scope: base })).catch((error: unknown) => {
        console.warn('pwa service worker registration failed', error);
      });
    } catch (error) {
      console.warn('pwa service worker registration failed', error);
    }
  };

  if (typeof document !== 'undefined' && document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });

  requestPersistentStorage();
}

/**
 * 顺便申请持久存储：系统清理缓存时不会把离线页面删掉。
 * 浏览器可能拒绝、也可能根本没有 `navigator.storage`，两种都不影响页面，结果直接丢掉。
 */
function requestPersistentStorage(): void {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    const persist = storage?.persist;
    if (typeof persist !== 'function') return;
    void Promise.resolve(persist.call(storage)).catch(() => undefined);
  } catch {
    // 存储管理器不存在或被禁用：忽略。
  }
}
