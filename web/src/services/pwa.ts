/**
 * PWA 的两件事：注册离线用的 Service Worker，以及判断要不要给「安装到主屏幕」引导。
 *
 * **安装引导不再是 iOS 专属**：只要当前不是在主屏幕的独立窗口里打开，并且没有原生桥
 * （不是 App 自带的 WebView），页面就在每次进入应用时提示一次「安装到主屏幕」。
 * 这里**不记录「已关闭」**——关掉只影响当次，下次访问仍会提示，直到用户真的装到主屏幕
 * （`isStandalonePwa()` 变真）或以后从原生 App 打开（有桥）。各平台的步骤差异在
 * `components/PwaInstallSheet.vue` 里按 UA 分支。
 *
 * **Service Worker 只在浏览器构建里注册**：App 里页面由 WebView 从本机快照加载，Service Worker
 * 帮不上忙还可能留下旧缓存；报名站是一次性的报名表单，不需要装到桌面。开发服务器没有生成
 * `sw.js`，热更新也会被缓存干扰，所以只在 `import.meta.env.PROD` 下注册。
 *
 * 注册失败只留一条控制台日志：离线能力是附加项，不能挡住页面。
 */
import { isJoinSurface } from '@/app/surface';
import { nativeBridge } from '@/services/native-bridge';
import { isStandalonePwa } from './platform';

/**
 * 要不要给用户看 PWA 安装引导：不是从主屏幕启动的独立窗口，也没有原生桥。
 *
 * 没有「本机关过没有」这一层：每次进入应用都重新给一次；用户装到主屏幕后
 * `isStandalonePwa()` 变真，条件自然为假。
 */
export function shouldOfferPwaInstall(): boolean {
  return !isStandalonePwa() && !nativeBridge.hasNative();
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
