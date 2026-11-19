import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeBridge,
  NativeBridgeError,
  nativeBridge,
  resetNativeCapabilitiesForTests,
  supportsNativeAction,
} from './native-bridge';
import { device } from './device-services';

const bridges: NativeBridge[] = [];
afterEach(() => {
  bridges.splice(0).forEach((bridge) => bridge.dispose());
});

function createNative() {
  const native = { invoke: (_action: string, _payload: string, _callbackId: string): void => {} };
  const fakeWindow = { CalMobileNative: native } as unknown as Window;
  const bridge = new NativeBridge({ windowLike: fakeWindow, timeoutMs: 10 });
  bridges.push(bridge);
  return { native, fakeWindow, bridge };
}

describe('NativeBridge', () => {
  it('serializes a typed action and resolves native callback', async () => {
    const { native, fakeWindow, bridge } = createNative();
    native.invoke = (action, payload, callbackId) => {
      expect(action).toBe('calendar.status');
      expect(JSON.parse(payload)).toEqual({ title: '秋季展会', date: '2026-09-20' });
      // 原生 calendar.status 回报的就是这两个键（见 SystemActions.calendarStatus）。
      fakeWindow.CalMobileBridge?.onResult(callbackId, true, { granted: true, inCalendar: false }, null, null);
    };
    await expect(bridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' })).resolves.toEqual({
      granted: true,
      inCalendar: false,
    });
  });

  it('preserves stable error codes and times out synchronous actions', async () => {
    const { native, fakeWindow, bridge } = createNative();
    native.invoke = (_action, _payload, callbackId) => {
      fakeWindow.CalMobileBridge?.onResult(callbackId, false, null, '用户取消', 'cancelled');
    };
    const cancelled = await bridge
      .call('media.store', { dataUrl: 'data:image/png;base64,x', kind: 'avatar' })
      .catch((error) => error);
    expect(cancelled).toBeInstanceOf(NativeBridgeError);
    expect(cancelled.code).toBe('cancelled');

    const timeoutBridge = createNative().bridge;
    await expect(
      timeoutBridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects outside Android and ignores unknown callback ids', async () => {
    const fakeWindow = {} as Window;
    const bridge = new NativeBridge({ windowLike: fakeWindow, timeoutMs: 10 });
    bridges.push(bridge);
    // 文案会随界面调整，这里只锁「没有桥就以 NativeBridgeError 失败」这个契约。
    await expect(bridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' })).rejects.toBeInstanceOf(
      NativeBridgeError,
    );
    fakeWindow.CalMobileBridge?.onResult('unknown', true, {}, null, null);
  });

  it('device 服务把动作名固定成原生契约', async () => {
    // 动作名一旦改动就要同步 `WebAppActions.handle()` 的动作表，这里锁一个代表性动作。
    const spy = vi.spyOn(nativeBridge, 'call').mockResolvedValue({ saved: true } as never);
    await device.calendarStatus({ title: '秋季展会', date: '2026-09-20' });
    expect(spy).toHaveBeenCalledWith('calendar.status', { title: '秋季展会', date: '2026-09-20' });
    spy.mockRestore();
  });

  it('交互动作走兜底超时，普通动作走短超时', async () => {
    // 原生一声不响时两者都必须有终点：交互动作（选图）给的是长超时。
    const native = { invoke: (): void => {} };
    const fakeWindow = { CalMobileNative: native } as unknown as Window;
    const bridge = new NativeBridge({ windowLike: fakeWindow, timeoutMs: 10, interactiveTimeoutMs: 60 });
    bridges.push(bridge);

    const plain = await bridge
      .call('calendar.status', { title: '秋季展会', date: '2026-09-20' })
      .catch((error) => error);
    expect(plain.code).toBe('timeout');

    const interactive = bridge.call('media.pickImage', {}).catch((error) => error);
    // 短超时那一刻不该被判定为超时（交互动作有自己的长超时）
    await new Promise((resolve) => setTimeout(resolve, 30));
    const early = await Promise.race([interactive, Promise.resolve('still-pending')]);
    expect(early).toBe('still-pending');
    const late = await interactive;
    expect(late.code).toBe('timeout');
  });

  it('unsupported 错误码原样交给前端（页面据此退回浏览器实现）', async () => {
    const { native, fakeWindow, bridge } = createNative();
    native.invoke = (_action, _payload, callbackId) => {
      fakeWindow.CalMobileBridge?.onResult(callbackId, false, null, '未实现的动作：app.future', 'unsupported');
    };
    const error = await bridge.call('app.capabilities', {}).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(NativeBridgeError);
    expect((error as NativeBridgeError).code).toBe('unsupported');
  });
});

describe('能力协商 supportsNativeAction', () => {
  afterEach(() => {
    resetNativeCapabilitiesForTests();
    vi.restoreAllMocks();
  });

  it('没有原生桥时任何动作都不支持，也不去问原生', async () => {
    const call = vi.spyOn(nativeBridge, 'call');
    // jsdom 里没有 window.CalMobileNative，hasNative() 为 false。
    await expect(supportsNativeAction('app.capabilities')).resolves.toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('只问一次 app.capabilities，并按清单回答', async () => {
    vi.spyOn(nativeBridge, 'hasNative').mockReturnValue(true);
    const call = vi
      .spyOn(nativeBridge, 'call')
      .mockResolvedValue({ version: '1.2.3', actions: ['app.capabilities', 'media.pickImage'] } as never);

    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(true);
    await expect(supportsNativeAction('passkey.create')).resolves.toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('app.capabilities', {});
  });

  it('旧壳不认识 app.capabilities：所有动作都返回 false，且只问一次', async () => {
    vi.spyOn(nativeBridge, 'hasNative').mockReturnValue(true);
    const call = vi
      .spyOn(nativeBridge, 'call')
      .mockRejectedValue(new NativeBridgeError('未实现的动作：app.capabilities', 'unsupported'));

    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(false);
    await expect(supportsNativeAction('app.capabilities')).resolves.toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('能力协商超时不算「没有能力」：下次调用重新问', async () => {
    vi.spyOn(nativeBridge, 'hasNative').mockReturnValue(true);
    const call = vi
      .spyOn(nativeBridge, 'call')
      .mockRejectedValueOnce(new NativeBridgeError('原生动作 app.capabilities 超时未响应', 'timeout'))
      .mockResolvedValueOnce({ version: '1.2.3', actions: ['media.pickImage'] } as never);

    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(false);
    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('原生回包形状不对时按空清单处理', async () => {
    vi.spyOn(nativeBridge, 'hasNative').mockReturnValue(true);
    vi.spyOn(nativeBridge, 'call').mockResolvedValue({ version: '1.2.3', actions: 'media.pickImage' } as never);
    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(false);
  });

  it('测试钩子能复位缓存', async () => {
    vi.spyOn(nativeBridge, 'hasNative').mockReturnValue(true);
    const call = vi
      .spyOn(nativeBridge, 'call')
      .mockResolvedValueOnce({ version: '1.2.3', actions: ['media.pickImage'] } as never)
      .mockResolvedValueOnce({ version: '1.2.3', actions: [] } as never);

    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(true);
    resetNativeCapabilitiesForTests();
    await expect(supportsNativeAction('media.pickImage')).resolves.toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
