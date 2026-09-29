/**
 * 内置第三方库的按需加载。
 *
 * 它们随 APK 打包（`web/public/vendor/`），不引用 CDN；但解析要花时间，
 * 启动时全量加载会拖慢首帧，所以只在真正用到的那一屏注入脚本。
 * jsQR 用于扫码核销，qrcode-generator 用于报名码与验证器二维码。
 */

const pending = new Map<string, Promise<void>>();

function load(source: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  const existing = pending.get(source);
  if (existing) return existing;
  const task = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(source, document.baseURI).href;
    script.async = true;
    script.addEventListener('load', () => {
      if (ready()) resolve();
      else reject(new Error(`组件未注册全局对象：${source}`));
    });
    script.addEventListener('error', () => reject(new Error(`组件加载失败：${source}`)));
    document.head.appendChild(script);
  });
  pending.set(source, task);
  task.catch(() => pending.delete(source));
  return task;
}

/** 二维码生成器（全局 `qrcode`）。 */
export function loadQrEncoder(): Promise<void> {
  return load('vendor/qrcode-generator/qrcode.js', () => typeof (window as { qrcode?: unknown }).qrcode === 'function');
}

/** 二维码识别（全局 `jsQR`），只在核销页需要。 */
export function loadQrDecoder(): Promise<void> {
  return load('vendor/jsQR.js', () => typeof (window as { jsQR?: unknown }).jsQR === 'function');
}
