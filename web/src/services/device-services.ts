/**
 * 设备能力的薄封装：把 `nativeBridge` 的动作名与参数形状固定成方法，页面就不必到处手写动作字符串。
 *
 * **边界**：这里只收敛动作名 —— 不解析结果、不缓存、不补默认值、也不做降级，返回的是原样的
 * 原生回调结果。业务数据一律走 `api/client.ts`；设备桥不承载业务数据，也不在本地存业务数据。
 *
 * **失败语义**：方法基本都会以 `NativeBridgeError` 失败 —— 浏览器/预览里没有原生桥、用户在系统
 * 弹窗里取消（`code === 'cancelled'`）、非交互动作超时（`code === 'timeout'`）、原生真的报错。
 * 这里统一不 catch，由调用点决定：能忍的自己吞掉（如 `app/theme.ts` 的外观镜像同步），
 * 用户主动触发的（选图、导出）要把失败显示出来；`cancelled` / `timeout` 属于约定好的非故障结果，
 * 不要拿它们弹错误提示。
 *
 * 参数形状用 `Parameters<typeof nativeBridge.call<...>>[1]` 从 `NativeActionPayloads` 派生：
 * 字段只在 `native-bridge.ts` 定义一次，避免两处抄写后改漏一处。
 */
import { nativeBridge, type NativeActionResults } from './native-bridge';

/** 设备动作集合。新增动作要先把动作名登记进 `native-bridge.ts` 的映射表，再在这里包一层。 */
export const device = {
  /** 把外观与上传限制镜像给原生（状态栏配色、图片压缩、格式上限）。失败只影响原生外观，页面继续用后端下发的值。 */
  sync(payload: Parameters<typeof nativeBridge.call<'ui.sync'>>[1]) {
    return nativeBridge.call('ui.sync', payload);
  },
  /** 申请相机权限，返回是否已授权；用户拒绝时返回 false，不算异常。 */
  ensureCameraPermission() {
    return nativeBridge.call('camera.ensurePermission', {});
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
  /** 弹系统通知权限申请，返回是否授权。只在用户主动操作时调用，不要开机就弹。 */
  requestNotificationPermission() {
    return nativeBridge.call('notify.requestPermission', {});
  },
  /** 打开系统相册选一张图，返回 dataUrl；用户取消时以 `cancelled` 失败。 */
  pickImage() {
    return nativeBridge.call('media.pickImage', {});
  },
  /** 从系统文件选择器导入图片或视频，返回本地可读 url。 */
  importMedia(kind: 'image' | 'video') {
    return nativeBridge.call('media.import', { kind });
  },
  /** 把 dataUrl 落盘成文件，返回可访问 url；`kind` 决定存储目录与后续展示方式。 */
  storeMedia(payload: Parameters<typeof nativeBridge.call<'media.store'>>[1]) {
    return nativeBridge.call('media.store', payload);
  },
  /** 删掉选择器刚写入的临时文件。上传成功或失败都要调，避免设备上留下没人引用的副本。 */
  discardMedia(fileName: string) {
    return nativeBridge.call('media.discard', { fileName });
  },
  /** 调系统分享面板分享一段文字；`shared: false` 表示用户没选任何目标，不是错误。 */
  shareText(title: string, text: string) {
    return nativeBridge.call('share.text', { title, text });
  },
  /** 把调用方生成好的 CSV 内容写文件并交系统处理；`exported: false` 表示没写成（权限或存储），不是异常。 */
  exportCsv(filename: string, content: string) {
    return nativeBridge.call('export.csv', { filename, content });
  },
};
