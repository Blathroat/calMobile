/**
 * 设备能力的薄封装：把 `nativeBridge` 的动作名与参数形状固定成方法，页面就不必到处手写动作字符串。
 *
 * **两条实现**：有原生桥（Android 应用）时一律走 `nativeBridge.call`；没有原生桥时
 * （浏览器 / iOS PWA）改用 `browser-device.ts` 的浏览器实现 —— 选文件、图片压缩、下载、
 * Web Share、通知授权都由标准 Web API 完成，返回值形状与原生回调对齐，页面不用区分环境。
 *
 * **边界**：这里只收敛动作名与结果形状 —— 不解析业务字段、不缓存、不补默认值。
 * 业务数据一律走 `api/client.ts`；设备桥不承载业务数据，也不在本地存业务数据。
 *
 * **失败语义**：Promise 失败一律是 `NativeBridgeError`；用户取消（`code === 'cancelled'`）
 * 属于约定好的非故障结果，页面按码判断、不弹错误提示。其它失败的消息都来自 `t()`，
 * 页面可以直接显示。少数浏览器里做不到的动作（落盘、外观镜像）仍然只在原生里有，
 * 浏览器打开时以 `device.featureUnavailable` 失败，页面据此隐藏入口。
 *
 * 参数形状用 `Parameters<typeof nativeBridge.call<...>>[1]` 从 `NativeActionPayloads` 派生：
 * 字段只在 `native-bridge.ts` 定义一次，避免两处抄写后改漏一处。
 */
import { t } from '@/i18n';
import { NativeBridgeError, nativeBridge, type NativeActionResults } from './native-bridge';
import {
  compressImage,
  downloadBlob,
  imageFileToJpegDataUrl,
  isAbortError,
  pickFile,
  requestNotificationPermission as requestBrowserNotificationPermission,
  shareText as shareBrowserText,
} from './browser-device';

/** 有原生桥走原生动作，没有时走浏览器实现；两边返回同一种结果形状。 */
function nativeOrBrowser<T>(native: () => Promise<T>, browser: () => Promise<T>): Promise<T> {
  return nativeBridge.hasNative() ? native() : browser();
}

/** 原生独有的动作（落盘、外观镜像）：浏览器里明确失败，不改成本地假成功。 */
function nativeOnly<T>(call: () => Promise<T>): Promise<T> {
  if (nativeBridge.hasNative()) return call();
  return Promise.reject(new NativeBridgeError(t('device.featureUnavailable')));
}

/** 用户在系统选择器里取消：只认稳定错误码，message 留空，页面不该显示它。 */
function cancelled(): NativeBridgeError {
  return new NativeBridgeError('', 'cancelled');
}

/**
 * 浏览器选完媒体后生成的 `blob:` URL，按原始文件名登记。
 *
 * 上传成功 / 失败由 `publish-media` 直接 revoke；但视频超过上限时页面只调
 * `device.discardMedia(fileName)`，并不会走上传链路，所以这里也要能按文件名收回，
 * 避免一段几十 MB 的视频一直挂在页面里。同名文件可能选多次，用队列逐个释放。
 */
const browserObjectUrls = new Map<string, string[]>();

function rememberBrowserObjectUrl(fileName: string, url: string): void {
  if (!fileName || !url) return;
  const urls = browserObjectUrls.get(fileName);
  if (urls) urls.push(url);
  else browserObjectUrls.set(fileName, [url]);
}

/** 释放同名文件最早登记的一个 object URL；没有登记时是安全空操作。 */
function forgetBrowserObjectUrl(fileName: string): void {
  const urls = browserObjectUrls.get(fileName);
  if (!urls || urls.length === 0) return;
  const url = urls.shift();
  if (urls.length === 0) browserObjectUrls.delete(fileName);
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // 已经由 publish-media 释放过：忽略。
  }
}

/** 浏览器选文件：选择器取消（返回 null）或用户中断（AbortError）都归一成 null。 */
async function pickBrowserFile(accept: string): Promise<File | null> {
  try {
    return await pickFile(accept);
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }
}

/** dataUrl → Blob：浏览器保存图片时用；解析不了就抛错，由调用方转成 `saved:false`。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(String(dataUrl ?? ''));
  if (!match) throw new Error(t('media.unreadableFile'));
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3] ?? '';
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

/** 浏览器下载图片时补一个文件名：没给展示名就按 MIME 猜扩展名。 */
function imageFileName(mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `image.${extension}`;
}

/** 设备动作集合。新增动作要先把动作名登记进 `native-bridge.ts` 的映射表，再在这里包一层。 */
export const device = {
  /**
   * 退出应用（用户不同意用户协议时）。App 里由原生结束 Activity；
   * 浏览器里尝试 `window.close()`，被拦截时返回 `closed:false`，页面自己提示用户关闭。
   */
  exitApp(): Promise<NativeActionResults['app.exit']> {
    if (!nativeBridge.hasNative()) {
      if (typeof window !== 'undefined') window.close();
      return Promise.resolve({ closed: false });
    }
    return nativeBridge.call('app.exit', {});
  },
  /** 把外观与上传限制镜像给原生（状态栏配色、图片压缩、格式上限）。失败只影响原生外观，页面继续用后端下发的值。 */
  sync(payload: Parameters<typeof nativeBridge.call<'ui.sync'>>[1]): Promise<NativeActionResults['ui.sync']> {
    return nativeOnly(() => nativeBridge.call('ui.sync', payload));
  },
  /** 申请相机权限，返回是否已授权；用户拒绝时返回 false，不算异常。 */
  ensureCameraPermission(): Promise<NativeActionResults['camera.ensurePermission']> {
    return nativeOrBrowser(
      () => nativeBridge.call('camera.ensurePermission', {}),
      // 浏览器里真正的权限弹窗由 getUserMedia 自己弹；这里只回答「能不能取景」。
      () => Promise.resolve(Boolean(navigator.mediaDevices?.getUserMedia)),
    );
  },
  /** 按标题与后端下发的 `YYYY-MM-DD` 日期查询系统日历，与加入/移出动作使用相同定位信息。 */
  calendarStatus(
    payload: Parameters<typeof nativeBridge.call<'calendar.status'>>[1],
  ): Promise<NativeActionResults['calendar.status']> {
    return nativeBridge.call('calendar.status', payload);
  },
  /** 加入/移出系统日历，返回写入后的状态；写失败时 `message` 带原生给的说明。 */
  toggleCalendar(payload: Parameters<typeof nativeBridge.call<'calendar.toggle'>>[1]) {
    return nativeBridge.call('calendar.toggle', payload);
  },
  /** 弹通知权限申请，返回是否授权。只在用户主动操作时调用，不要开机就弹。 */
  requestNotificationPermission(): Promise<NativeActionResults['notify.requestPermission']> {
    return nativeOrBrowser(
      () => nativeBridge.call('notify.requestPermission', {}),
      () => requestBrowserNotificationPermission(),
    );
  },
  /** 打开系统相册选一张图，返回 dataUrl；用户取消时以 `cancelled` 失败。 */
  pickImage(): Promise<NativeActionResults['media.pickImage']> {
    return nativeOrBrowser(
      () => nativeBridge.call('media.pickImage', {}),
      async () => {
        const file = await pickBrowserFile('image/*');
        if (!file) throw cancelled();
        try {
          return { dataUrl: await imageFileToJpegDataUrl(file) };
        } catch {
          throw new NativeBridgeError(t('media.unreadableFile'));
        }
      },
    );
  },
  /** 从系统文件选择器导入图片或视频，返回本地可读 url。 */
  importMedia(kind: 'image' | 'video'): Promise<NativeActionResults['media.import']> {
    return nativeOrBrowser(
      () => nativeBridge.call('media.import', { kind }),
      async () => {
        const file = await pickBrowserFile(kind === 'image' ? 'image/*' : 'video/*');
        if (!file) throw cancelled();
        if (kind === 'image') {
          let blob: Blob;
          try {
            ({ blob } = await compressImage(file));
          } catch {
            throw new NativeBridgeError(t('media.unreadableFile'));
          }
          // 浏览器里的文件只在当前页面有效：用完由 publish-media 收回 object URL。
          const url = URL.createObjectURL(blob);
          rememberBrowserObjectUrl(file.name, url);
          return {
            url,
            kind,
            fileName: file.name,
            bytes: blob.size,
            mimeType: 'image/jpeg',
            compressed: true,
          };
        }
        const url = URL.createObjectURL(file);
        rememberBrowserObjectUrl(file.name, url);
        return {
          url,
          kind,
          fileName: file.name,
          bytes: file.size,
          mimeType: file.type || 'video/mp4',
          compressed: false,
        };
      },
    );
  },
  /** 从系统文件选择器读一个文本文件，正文由原生读出来回传（不依赖 WebView 的文件访问）。 */
  importText(mimeTypes = 'application/json', maxBytes = 512 * 1024): Promise<NativeActionResults['media.importText']> {
    return nativeOrBrowser(
      () => nativeBridge.call('media.importText', { mimeTypes, maxBytes }),
      async () => {
        const file = await pickBrowserFile(mimeTypes);
        if (!file) throw cancelled();
        if (file.size > maxBytes) throw new NativeBridgeError(t('media.unreadableFile'));
        let text: string;
        try {
          text = await file.text();
        } catch {
          throw new NativeBridgeError(t('media.unreadableFile'));
        }
        return { text, fileName: file.name, bytes: file.size };
      },
    );
  },
  /** 把 dataUrl 落盘成文件，返回可访问 url；`kind` 决定存储目录与后续展示方式。浏览器里没有本地目录，只在原生里有。 */
  storeMedia(
    payload: Parameters<typeof nativeBridge.call<'media.store'>>[1],
  ): Promise<NativeActionResults['media.store']> {
    return nativeOnly(() => nativeBridge.call('media.store', payload));
  },
  /** 删掉选择器刚写入的临时文件。上传成功或失败都要调，避免设备上留下没人引用的副本。 */
  discardMedia(fileName: string): Promise<NativeActionResults['media.discard']> {
    return nativeOrBrowser(
      () => nativeBridge.call('media.discard', { fileName }),
      // 浏览器里没有选择器落盘的临时文件；但选完媒体生成的 object URL 要在这里收回，
      // 否则视频超过上限、页面直接放弃这条媒体时，整段数据会一直被页面引用着。
      async () => {
        forgetBrowserObjectUrl(fileName);
        return { ok: true };
      },
    );
  },
  /** 调系统分享面板分享一段文字；`shared: false` 表示用户没选任何目标，不是错误。 */
  shareText(title: string, text: string): Promise<NativeActionResults['share.text']> {
    return nativeOrBrowser(
      () => nativeBridge.call('share.text', { title, text }),
      async () => {
        // 浏览器实现会在「分享面板和剪贴板都不可用」时抛错；用户取消返回 {shared:false}，
        // 按约定不算失败，页面保持静默。
        try {
          const result = await shareBrowserText(title, text);
          return { shared: result.shared === true, copied: result.copied === true };
        } catch {
          throw new NativeBridgeError(t('device.shareUnavailable'));
        }
      },
    );
  },
  /** 把调用方生成好的 CSV 内容写文件并交系统处理；`exported: false` 表示没写成（权限或存储），不是异常。 */
  exportCsv(filename: string, content: string): Promise<NativeActionResults['export.csv']> {
    return nativeOrBrowser(
      () => nativeBridge.call('export.csv', { filename, content }),
      async () => {
        const name = filename || 'export.csv';
        downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), name);
        return { exported: true };
      },
    );
  },
  /** 把任意文本写成文件并交系统「另存为」面板；用户取消时以 `cancelled` 失败。 */
  exportText(
    fileName: string,
    content: string,
    mimeType = 'application/json',
  ): Promise<NativeActionResults['export.text']> {
    return nativeOrBrowser(
      () => nativeBridge.call('export.text', { fileName, content, mimeType }),
      async () => {
        const name = fileName || 'export.txt';
        downloadBlob(new Blob([content], { type: mimeType }), name);
        return { exported: true, fileName: name };
      },
    );
  },
  /** 把 dataUrl 图片写进系统相册（报名二维码长按保存）；`saved: false` 表示没写成，不是异常。 */
  saveImage(dataUrl: string, fileName = ''): Promise<NativeActionResults['media.saveImage']> {
    return nativeOrBrowser(
      () => nativeBridge.call('media.saveImage', { dataUrl, fileName }),
      async () => {
        // 浏览器里没有相册写入权限：退成下载一张图片，失败也只是 saved:false，不抛异常。
        try {
          const blob = dataUrlToBlob(dataUrl);
          downloadBlob(blob, fileName || imageFileName(blob.type));
          return { saved: true };
        } catch {
          return { saved: false };
        }
      },
    );
  },
};
