/**
 * 浏览器端的文件与系统能力：选文件、压缩图片、下载、分享、通知权限。
 *
 * 这些能力在 App 里由原生桥提供（见 `services/device-services.ts`），这里是浏览器 / iOS PWA
 * 的对应实现。调用点先看 `nativeBridge.hasNative()` 决定用哪一套，两套的返回值语义保持一致：
 * 用户取消不是错误，能力不存在用稳定返回码表示，真失败才抛 `Error`。
 *
 * **iOS 的约束**（决定了下面几个写法）：
 * - 文件选择器与系统分享只能在用户手势的同一轮里打开，所以 `pickFile()` 同步创建并点击 input；
 * - `<input type="file">` 不能 `display:none`，否则 Safari 不弹选择器，只能挪出视口；
 * - 相机直出的 HEIC 不能直接上屏，统一先画进 canvas 转成 JPEG；
 * - 分享面板与通知权限在非安全上下文、非 Safari 里可能直接拒绝，调用点要按能力缺失处理。
 *
 * 这里不写用户可见文案，也不导入 i18n：错误只给稳定错误码，提示留给页面。
 */
import { copyText } from '@/services/clipboard';

/** JPEG 输出参数：与原生侧上传限制一致（最长边 1080、质量 0.9）。 */
const JPEG_TYPE = 'image/jpeg';
const JPEG_QUALITY = 0.9;

/**
 * 打开系统文件选择器选一个文件。
 *
 * @param accept accept 属性，例如 `image/*`；空串表示不限
 * @returns 选中的文件；用户取消返回 null
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.setAttribute('aria-hidden', 'true');
    // 不能用 display:none：iOS Safari 对不可见 input 的 click() 不弹选择器。
    input.style.position = 'fixed';
    input.style.top = '-1000px';
    input.style.left = '-1000px';
    input.style.opacity = '0';

    let settled = false;
    function cleanup(): void {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      input.remove();
    }
    function settle(file: File | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    }
    function onChange(): void {
      settle(input.files?.[0] ?? null);
    }
    // 新版 Safari / Chrome 在用户关掉选择器时会发 cancel；不发的内核就保持 pending，
    // 直到用户重新选一次（没有「已取消」可报，也不能凭空回 null）。
    function onCancel(): void {
      settle(null);
    }

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    (document.body ?? document.documentElement).appendChild(input);
    // 同步点击：iOS 只在用户手势的同一轮里允许打开文件选择器。
    input.click();
  });
}

/** 解码后的图源。`release()` 负责释放 ImageBitmap 占用的内存。 */
interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

/** 把图片等比缩到最长边不超过 `maxEdge`；本来就够小就保持原尺寸。 */
function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const limit = Math.max(1, Math.round(maxEdge));
  const longest = Math.max(width, height);
  if (longest <= limit) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const ratio = limit / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** 优先 `createImageBitmap`（能按 EXIF 摆正方向、不占 DOM），失败再交给 `<img>`。 */
async function decodeImage(file: File): Promise<DecodedImage> {
  const bitmap = await decodeWithBitmap(file);
  if (bitmap) {
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const image = await decodeWithImageElement(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('imageDecodeFailed');
  return { source: image, width, height, release: () => undefined };
}

async function decodeWithBitmap(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    // from-image：按 EXIF 方向摆正，否则手机竖拍的照片会横着输出。
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 老内核不认这个选项，或解不了这个格式（HEIC 等）：交给 <img> 再试一次。
    return null;
  }
}

function decodeWithImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      reject(new Error('imageDecodeUnsupported'));
      return;
    }
    const url = URL.createObjectURL(file);
    const release = (): void => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // 已经释放过就忽略。
      }
    };
    const image = new Image();
    image.onload = () => {
      release();
      resolve(image);
    };
    image.onerror = () => {
      release();
      reject(new Error('imageDecodeFailed'));
    };
    image.src = url;
  });
}

/** canvas 编码成 JPEG；编码器缺失或没给出 Blob 都算失败。 */
function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('imageEncodeUnsupported'));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('imageEncodeFailed'));
      },
      JPEG_TYPE,
      JPEG_QUALITY,
    );
  });
}

/**
 * 压缩图片：等比缩到最长边不超过 `maxEdge`，统一输出 JPEG。
 *
 * 相机直出的 HEIC / 大尺寸 JPEG 都走这一条：解码（HEIC 由系统解码）→ canvas 缩放 → JPEG 0.9。
 * 浏览器完全解不了这个格式时抛 `Error`，由页面提示换一张。
 *
 * @param file 原始图片
 * @param maxEdge 最长边上限，缺省 1080
 * @returns JPEG blob 与输出尺寸
 */
export async function compressImage(
  file: File,
  maxEdge = 1080,
): Promise<{ blob: Blob; width: number; height: number }> {
  const image = await decodeImage(file);
  try {
    const size = fitWithin(image.width, image.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('imageCanvasUnavailable');
    context.drawImage(image.source, 0, 0, size.width, size.height);
    const blob = await encodeJpeg(canvas);
    return { blob, width: size.width, height: size.height };
  } finally {
    // ImageBitmap 要显式关掉；<img> 没有 release 需求，空实现即可。
    image.release();
  }
}

/** 压缩后的图片转成 data URL，供现有上传接口与预览使用。 */
export async function imageFileToJpegDataUrl(file: File, maxEdge = 1080): Promise<string> {
  const { blob } = await compressImage(file, maxEdge);
  return blobToDataUrl(blob);
}

/** Blob 转 data URL。读不出结果时抛 `Error`。 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') throw new Error('fileReaderUnavailable');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('fileReadFailed'));
    };
    reader.onerror = () => reject(new Error('fileReadFailed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 触发浏览器下载。
 *
 * 用临时 `<a download>`：移动端 Safari 会先弹「下载 / 预览」，桌面端直接落盘。
 * objectURL 不能立刻回收 —— Safari 可能还没读到内容 —— 挪到下一轮任务再撤销。
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function')
    return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  (document.body ?? document.documentElement).appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // 已经释放过就忽略。
      }
    }, 0);
  }
}

/**
 * 分享一段文字；没有系统分享面板时退回剪贴板。
 *
 * @returns `shared`：系统面板完成分享；`copied`：退回复制且复制成功。两者都为 false
 *   表示用户取消了分享，不是错误。
 * @throws {Error} 没有分享面板、复制也失败。
 */
export async function shareText(title: string, text: string): Promise<{ shared: boolean; copied: boolean }> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const share = nav?.share;
  if (typeof share === 'function') {
    try {
      await share.call(nav, { title, text });
      return { shared: true, copied: false };
    } catch (error) {
      // 用户取消不是错误，也不再复制：系统面板关掉后静默结束。
      if (isAbortError(error)) return { shared: false, copied: false };
      // 其余失败（非安全上下文、平台不支持这段文字）退回复制，与没有分享面板时同一套。
    }
  }
  const copied = await copyText(text);
  if (!copied) throw new Error('copyFailed');
  return { shared: false, copied: true };
}

/**
 * 用系统分享面板分享一个文件（图片、CSV 等）。
 *
 * @returns `shared` 已分享；`cancelled` 用户取消；`unsupported` 当前环境不支持文件分享，
 *   调用点应改为下载。
 * @throws {Error} 分享失败且不是用户取消。
 */
export async function shareFile(file: File, title: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const share = nav?.share;
  if (typeof share !== 'function') return 'unsupported';
  const canShare = nav?.canShare;
  if (typeof canShare === 'function') {
    let allowed = false;
    try {
      // canShare 对「文件」这类数据会实际校验 MIME 与浏览器版本，比探测 share 存在更准。
      allowed = canShare.call(nav, { files: [file] }) === true;
    } catch {
      // 有的实现对不认识的字段直接抛错：按不支持处理，不要当成分享失败。
      allowed = false;
    }
    if (!allowed) return 'unsupported';
  }
  try {
    await share.call(nav, { files: [file], title });
    return 'shared';
  } catch (error) {
    if (isAbortError(error)) return 'cancelled';
    throw error instanceof Error ? error : new Error('shareFailed');
  }
}

/** 申请系统通知权限。没有 Notification / 申请抛错都返回 false，不抛异常。 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/** 判断错误是不是「用户取消」：分享面板与文件选择器取消时抛的都是 AbortError。 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
