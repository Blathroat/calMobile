export type NativeAction =
  | 'ui.sync'
  | 'camera.ensurePermission'
  | 'calendar.status'
  | 'calendar.toggle'
  | 'notify.requestPermission'
  | 'media.pickImage'
  | 'media.import'
  | 'media.store'
  | 'share.text'
  | 'export.csv';

export type NativeErrorCode = 'cancelled' | 'timeout';

export interface NativeActionPayloads {
  'ui.sync': { mode?: string; themeIndex?: number; media?: Record<string, unknown>; upload?: Record<string, unknown> };
  'camera.ensurePermission': Record<string, never>;
  'calendar.status': { date: string };
  'calendar.toggle': { date: string; title?: string; description?: string; location?: string; startTime?: string; endTime?: string };
  'notify.requestPermission': Record<string, never>;
  'media.pickImage': Record<string, never>;
  'media.import': { kind: 'image' | 'video' };
  'media.store': { dataUrl: string; kind: 'avatar' | 'image' | 'video' };
  'share.text': { title: string; text: string };
  'export.csv': { filename: string; content: string };
}

export interface NativeActionResults {
  'ui.sync': { notificationsGranted?: boolean };
  'camera.ensurePermission': boolean;
  'calendar.status': { saved: boolean };
  'calendar.toggle': { saved: boolean };
  'notify.requestPermission': { granted: boolean };
  'media.pickImage': { dataUrl: string };
  'media.import': { url: string; kind: string };
  'media.store': { url: string };
  'share.text': { shared: boolean };
  'export.csv': { exported: boolean };
}

export class NativeBridgeError extends Error {
  readonly code?: NativeErrorCode;

  constructor(message: string, code?: NativeErrorCode) {
    super(message);
    this.name = 'NativeBridgeError';
    this.code = code;
  }
}

interface NativeWindow {
  invoke(action: NativeAction, payload: string, callbackId: string): void;
  report?(message: string): void;
}

interface NativeCallbackWindow {
  onResult(callbackId: string, ok: boolean, result: unknown, error: string | null, code: NativeErrorCode | null): void;
}

declare global {
  interface Window {
    CalMobileNative?: NativeWindow;
    CalMobileBridge?: NativeCallbackWindow;
  }
}

const INTERACTIVE_ACTIONS = new Set<NativeAction>([
  'media.pickImage', 'media.import', 'export.csv', 'camera.ensurePermission', 'notify.requestPermission',
]);

export interface NativeBridgeOptions {
  timeoutMs?: number;
  windowLike?: Window;
}

export class NativeBridge {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }>();
  private sequence = 1;
  private readonly timeoutMs: number;
  private readonly windowLike: Window | undefined;
  private installed = false;

  constructor(options: NativeBridgeOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.windowLike = options.windowLike ?? (typeof window === 'undefined' ? undefined : window);
    this.installCallback();
  }

  hasNative(): boolean {
    return Boolean(this.windowLike?.CalMobileNative);
  }

  report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    try { this.windowLike?.CalMobileNative?.report?.(message); } catch { /* logging must not mask the original error */ }
  }

  call<A extends NativeAction>(action: A, payload: NativeActionPayloads[A]): Promise<NativeActionResults[A]> {
    if (!this.hasNative()) return Promise.reject(new NativeBridgeError('当前环境没有原生桥接，请在 Android 应用中打开'));
    const callbackId = `cb-${this.sequence++}`;
    return new Promise<NativeActionResults[A]>((resolve, reject) => {
      const entry = { resolve: resolve as (value: unknown) => void, reject, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      if (!INTERACTIVE_ACTIONS.has(action)) {
        entry.timer = setTimeout(() => {
          this.pending.delete(callbackId);
          reject(new NativeBridgeError(`原生动作 ${action} 超时未响应`, 'timeout'));
        }, this.timeoutMs);
      }
      this.pending.set(callbackId, entry);
      try {
        this.windowLike?.CalMobileNative?.invoke(action, JSON.stringify(payload ?? {}), callbackId);
      } catch (error) {
        this.finish(callbackId);
        reject(error instanceof Error ? error : new NativeBridgeError(String(error)));
      }
    });
  }

  dispose(): void {
    const error = new NativeBridgeError('原生桥接已释放');
    for (const [callbackId, entry] of this.pending) {
      this.finish(callbackId);
      entry.reject(error);
    }
    if (this.installed && this.windowLike?.CalMobileBridge) delete this.windowLike.CalMobileBridge;
    this.installed = false;
  }

  private installCallback(): void {
    if (!this.windowLike) return;
    this.windowLike.CalMobileBridge = {
      onResult: (callbackId, ok, result, error, code) => {
        const entry = this.pending.get(callbackId);
        if (!entry) return;
        this.finish(callbackId);
        if (ok) entry.resolve(result);
        else entry.reject(new NativeBridgeError(error || '操作未完成', code ?? undefined));
      },
    };
    this.installed = true;
  }

  private finish(callbackId: string): void {
    const entry = this.pending.get(callbackId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(callbackId);
  }
}

export const nativeBridge = new NativeBridge();
