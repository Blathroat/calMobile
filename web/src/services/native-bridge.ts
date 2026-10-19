import { t } from '@/i18n';
/**
 * Android 原生能力的类型化桥接，不承载业务数据或业务规则。
 *
 * **动作名契约**：`action` 是 `域.动作` 形式的字符串，前端与原生 `WebAppActions.handle()` 的动作表
 * 靠这个字符串对齐。改名必须两边同时改，这里没有编译期保护 —— 新增动作要在 `NativeAction` 以及
 * `NativeActionPayloads` / `NativeActionResults` 两张映射表里都登记，否则 `call` 取不到类型。
 *
 * **回调协议**：`window.CalMobileNative.invoke(action, payloadJson, callbackId)` 发起，原生通过注入的
 * `window.CalMobileBridge.onResult(callbackId, ok, result, error, code)` **回一次**。`callbackId` 由
 * 前端自增生成，等待中的 Promise 存在 `pending` 里；回调认不出 id 就丢弃，用来容忍重复回调或
 * 超时后迟到的回调（绝不能把结果落到别的调用上）。
 *
 * **稳定错误码**：`cancelled`（用户在系统弹窗里点了取消）与 `timeout`（原生没回话）是约定好的两类
 * 非故障结果，页面不该拿它们弹错误提示；`code` 为 undefined 才是真失败。判断时读 `error.code`，
 * 不要匹配 `message` 文案 —— 文案是给人看的，随时会改。
 *
 * **为什么不给交互动作设超时**：选图、导入、导出、申请权限会停在系统 UI 上等用户操作，定时器会把
 * 正常等待误判成失败，所以这些动作不加超时（见 `INTERACTIVE_ACTIONS`）。其余动作超时 30 秒，
 * 是给「原生进程没响应」兜底的。
 *
 * **没有原生桥时的语义**：`call` 直接 reject `NativeBridgeError`，不会退回本地实现（前端不做本地降级，
 * 数据一律走后端）。调用点必须自己决定是上报还是吞掉：能忍的场景按「没有这个能力」处理，
 * 让页面照常可用（`session-client` 就是这么处理会话存储的）。
 */

/**
 * 原生动作名全集。命名是 `域.动作`，域与 `SystemActions` / `SessionStore` 等原生实现一一对应。
 * 新增动作必须同时补两张映射表，否则 `call` 的参数与返回值都没有类型。
 */
export type NativeAction =
  | 'ui.sync'
  | 'camera.ensurePermission'
  | 'calendar.status'
  | 'calendar.toggle'
  | 'notify.requestPermission'
  | 'media.pickImage'
  | 'media.import'
  | 'media.importText'
  | 'media.store'
  | 'media.discard'
  | 'share.text'
  | 'export.csv'
  | 'export.text'
  | 'media.saveImage'
  | 'session.save'
  | 'session.load'
  | 'session.clear'
  | 'session.device';

/**
 * 稳定错误码：只有这两类在原生侧被规范化，其余失败的 `code` 是 undefined。
 * `cancelled` 是用户放弃，`timeout` 是原生没回话 —— 都不是故障。
 */
export type NativeErrorCode = 'cancelled' | 'timeout';

/**
 * 每个动作的入参形状。字段名必须与原生读取的键名一致（`date`、`kind`、`refreshToken` 等），
 * 大小写写错类型也发现不了，只会让原生收到 undefined。
 */
export interface NativeActionPayloads {
  // 外观与上传限制的镜像：设备侧只用到这些，权威值仍在后端。
  'ui.sync': { mode?: string; themeIndex?: number; media?: Record<string, unknown>; upload?: Record<string, unknown> };
  // 无参数动作也传空对象（不是 undefined），序列化后原生拿到的是 {}。
  'camera.ensurePermission': Record<string, never>;
  // 键名与 SystemActions.calendarStatus / applyCalendarChange 读取的一致：
  // 日期用后端下发的 ISO 日期原样传入，缺日期时原生直接失败，不猜月份。
  'calendar.status': { title: string; date: string };
  // 标题与地点只做展示，date 缺失原生直接失败。
  'calendar.toggle': { title: string; venue?: string; date: string; time?: string; description?: string };
  'notify.requestPermission': Record<string, never>;
  // 走系统相册，用户取消时以 cancelled 失败。
  'media.pickImage': Record<string, never>;
  // 走系统文件选择器，kind 决定取图片还是视频。
  'media.import': { kind: 'image' | 'video' };
  // 走系统文件选择器读一个文本文件（语言包）：正文由原生读出来回给页面，
  // 页面不直接读设备文件（WebView 关掉了文件 / content 访问）。
  'media.importText': { mimeTypes?: string; maxBytes?: number };
  // dataUrl 落盘成文件；kind 决定存储目录。
  'media.store': { dataUrl: string; kind: 'avatar' | 'image' | 'video' };
  /** 删掉选择器刚落盘的临时文件。只接受媒体目录下的单层文件名。 */
  'media.discard': { fileName: string };
  // 内容由调用方拼好，原生只负责唤起系统分享面板。
  'share.text': { title: string; text: string };
  // CSV 正文由调用方生成，原生只负责写文件。
  'export.csv': { filename: string; content: string };
  // 任意文本文件（语言包底稿）交系统「另存为」面板；正文与文件名由调用方给。
  'export.text': { fileName: string; content: string; mimeType?: string };
  // 把 dataUrl 图片写进系统相册；fileName 只是展示名，落盘名由原生补全。
  'media.saveImage': { dataUrl: string; fileName?: string };
  // 刷新令牌存在设备私有存储里（`SessionStore.java`）；空 token 等价于清除。
  'session.save': { refreshToken: string; username?: string };
  'session.load': Record<string, never>;
  'session.clear': Record<string, never>;
  /** 生成或读取本机稳定的设备凭据；退出登录时不清除，用于记住设备与会话管理。 */
  'session.device': Record<string, never>;
}

/** 每个动作成功回调的返回体。只保证列出的字段存在，新增字段先在这里登记再使用。 */
export interface NativeActionResults {
  'ui.sync': { notificationsGranted?: boolean };
  'camera.ensurePermission': boolean;
  'calendar.status': { granted: boolean; inCalendar: boolean };
  // 写系统日历失败时 message 带原生给的说明，granted/inCalendar 仍反映真实状态。
  'calendar.toggle': { granted: boolean; inCalendar: boolean; message?: string };
  'notify.requestPermission': boolean;
  'media.pickImage': { dataUrl: string };
  'media.import': {
    url: string;
    kind: string;
    fileName?: string;
    bytes?: number;
    mimeType?: string;
    compressed?: boolean;
  };
  // 文本文件的正文与展示名；用户取消时以 cancelled 失败。
  'media.importText': { text: string; fileName?: string; bytes?: number };
  'media.store': { url: string };
  'media.discard': { ok: boolean };
  // shared 为 false 等价于用户放弃分享，不是错误。
  'share.text': { shared: boolean };
  // exported 为 false 表示没写成（权限或存储），不是异常。
  'export.csv': { exported: boolean };
  // 同上：系统面板里点了取消会以 cancelled 失败，不是故障。
  'export.text': { exported: boolean; fileName?: string };
  // 写进相册后返回；低版本系统改用系统「另存为」面板，取消同样以 cancelled 失败。
  'media.saveImage': { saved: boolean; uri?: string };
  'session.save': { ok: boolean; refreshToken: string; username: string };
  // 读回的值可能与写入不同：原生侧才是权威存储，空 refreshToken 表示没有会话。
  'session.load': { refreshToken: string; username: string };
  'session.clear': { ok: boolean };
  'session.device': { deviceToken: string };
}

/**
 * 桥接失败。`code` 有值表示约定好的非故障结果（用户取消 / 超时），无值是真失败
 * （没有原生桥、原生同步抛错、动作名不认识）。调用方按 `error.code` 判断，不要匹配文案。
 */
export class NativeBridgeError extends Error {
  readonly code?: NativeErrorCode;

  constructor(message: string, code?: NativeErrorCode) {
    super(message);
    this.name = 'NativeBridgeError';
    this.code = code;
  }
}

/** 原生注入到页面的入口。它不存在，就代表当前不在 WebView 容器里（浏览器 / 预览）。 */
interface NativeWindow {
  invoke(action: NativeAction, payload: string, callbackId: string): void;
  report?(message: string): void;
}

/** 前端注入给原生的回调出口。原生处理完动作必须回一次，前端只认 callbackId 对号入座。 */
interface NativeCallbackWindow {
  onResult(callbackId: string, ok: boolean, result: unknown, error: string | null, code: NativeErrorCode | null): void;
}

declare global {
  interface Window {
    CalMobileNative?: NativeWindow;
    CalMobileBridge?: NativeCallbackWindow;
  }
}

// 会停在系统 UI 上等用户操作的动作：这类动作的「慢」是正常的，超时只作为
// 「原生一声不响」的兜底，因此给足时间，不能用普通动作的 30 秒。
const INTERACTIVE_ACTIONS = new Set<NativeAction>([
  'media.pickImage',
  'media.import',
  'media.importText',
  'export.csv',
  'export.text',
  'media.saveImage',
  'camera.ensurePermission',
  'notify.requestPermission',
]);

/** 交互动作的兜底超时：5 分钟。选图、保存文件这类操作可能被用户撂在一边很久。 */
const INTERACTIVE_TIMEOUT_MS = 5 * 60_000;

/**
 * 构造参数。
 * - `timeoutMs`：普通动作的超时，缺省 30 秒。
 * - `interactiveTimeoutMs`：交互动作（选图 / 导入 / 导出 / 权限申请）的兜底超时，缺省 5 分钟。
 * - `windowLike`：注入假的 window 用于测试；缺省用全局 `window`。
 */
export interface NativeBridgeOptions {
  timeoutMs?: number;
  interactiveTimeoutMs?: number;
  windowLike?: Window;
}

/**
 * 桥接实现。除 `pending` 与自增序号外无状态。
 * 同一个页面只应当有一个实例：回调出口 `window.CalMobileBridge` 是**覆盖式**安装的，
 * 第二个实例会顶掉第一个，让先创建的那个再收不到任何回调。
 */
export class NativeBridge {
  // 回调 id → 等待中的 Promise（含超时定时器）；原生回调、超时或 dispose 时从这里删除。
  private readonly pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }
  >();
  // 回调 id 自增，保证同一次会话内不重号。
  private sequence = 1;
  private readonly timeoutMs: number;
  private readonly interactiveTimeoutMs: number;
  private readonly windowLike: Window | undefined;
  // 是否由本实例安装了回调出口：dispose 时只清自己装的，不误删别人的。
  private installed = false;

  constructor(options: NativeBridgeOptions = {}) {
    // 30 秒足够覆盖慢设备上的落盘/导出；再长页面就一直挂着。
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.interactiveTimeoutMs = options.interactiveTimeoutMs ?? INTERACTIVE_TIMEOUT_MS;
    // 拿不到 window（SSR / 纯 Node 测试）就退化成「没有原生桥」。
    this.windowLike = options.windowLike ?? (typeof window === 'undefined' ? undefined : window);
    this.installCallback();
  }

  /** 当前环境是否有原生入口。为假时 `call` 必然失败，页面据此隐藏设备相关入口。 */
  hasNative(): boolean {
    return Boolean(this.windowLike?.CalMobileNative);
  }

  /** 把错误交给原生日志。上报本身失败也要吞掉：日志不能盖住原始异常。 */
  report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    try {
      this.windowLike?.CalMobileNative?.report?.(message);
    } catch {
      /* logging must not mask the original error */
    }
  }

  /**
   * 调一个原生动作。
   *
   * @param action 动作名，同时决定 payload 与返回值的类型。
   * @param payload 入参，序列化成 JSON 字符串后交给原生；空参数动作传 `{}`。
   * @returns 原生回调成功时的结果，字段见 `NativeActionResults`。
   * @throws {NativeBridgeError} 没有原生桥、原生回调失败（可能带 `cancelled` / `timeout` 码）、
   *   非交互动作超时、或 `invoke` 同步抛错。调用方必须处理，这里不做降级。
   */
  call<A extends NativeAction>(action: A, payload: NativeActionPayloads[A]): Promise<NativeActionResults[A]> {
    // 没有桥就直接失败，不存在「在浏览器里假装成功」的分支。
    if (!this.hasNative()) return Promise.reject(new NativeBridgeError(t('device.noBridge')));
    const callbackId = `cb-${this.sequence++}`;
    return new Promise<NativeActionResults[A]>((resolve, reject) => {
      const entry = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      // 交互动作给的是兜底超时（默认 5 分钟），不是普通动作的 30 秒：
      // 用户可能把系统选择器撂在一边很久，但「原生永远不回」也必须有个终点，
      // 否则这个 Promise 会一直挂着，页面停在「加载中」。
      const limit = INTERACTIVE_ACTIONS.has(action) ? this.interactiveTimeoutMs : this.timeoutMs;
      entry.timer = setTimeout(() => {
        this.pending.delete(callbackId);
        reject(new NativeBridgeError(t('app.nativeTimeout', { action }), 'timeout'));
      }, limit);
      // 顺序要紧：先登记 pending 再 invoke，原生回调可能同步到达，晚了就认不出 callbackId。
      this.pending.set(callbackId, entry);
      try {
        this.windowLike?.CalMobileNative?.invoke(action, JSON.stringify(payload ?? {}), callbackId);
      } catch (error) {
        // invoke 同步抛错（动作名不认识等）时，入口还在，必须自己清掉 pending 并失败。
        this.finish(callbackId);
        reject(error instanceof Error ? error : new NativeBridgeError(String(error)));
      }
    });
  }

  /**
   * 断开桥接：所有在途调用以「桥接已释放」失败，并撤掉本实例安装的回调出口。
   * 用于页面销毁或热重载，避免旧实例的 pending 永远挂着（再也不会有人回它们）。
   */
  dispose(): void {
    const error = new NativeBridgeError(t('device.bridgeReleased'));
    for (const [callbackId, entry] of this.pending) {
      this.finish(callbackId);
      entry.reject(error);
    }
    // 只删自己装的那一份：期间若有新实例接手，它的出口不能被这里抹掉。
    if (this.installed && this.windowLike?.CalMobileBridge) delete this.windowLike.CalMobileBridge;
    this.installed = false;
  }

  /** 安装回调出口。覆盖式写入：新实例会顶掉旧实例，旧实例的调用从此无人应答。 */
  private installCallback(): void {
    if (!this.windowLike) return;
    this.windowLike.CalMobileBridge = {
      onResult: (callbackId, ok, result, error, code) => {
        const entry = this.pending.get(callbackId);
        // 认不出的 id 一律丢弃：重复回调或超时后的迟到回调，不能落到别的调用上。
        if (!entry) return;
        this.finish(callbackId);
        if (ok) entry.resolve(result);
        // 失败时只看 code（稳定）并给 error 文案兜底，不要解析文案本身。
        else entry.reject(new NativeBridgeError(error || t('device.actionIncomplete'), code ?? undefined));
      },
    };
    this.installed = true;
  }

  /** 清理定时器与 pending 记录；对不存在的 id 是安全的空操作。 */
  private finish(callbackId: string): void {
    const entry = this.pending.get(callbackId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(callbackId);
  }
}

/** 全应用共用的桥接实例。页面不要自己 new NativeBridge，否则两个实例会互相覆盖回调出口。 */
export const nativeBridge = new NativeBridge();
