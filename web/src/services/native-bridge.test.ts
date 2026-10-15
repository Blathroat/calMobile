import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeBridge, NativeBridgeError, nativeBridge } from './native-bridge';
import { device } from './device-services';

const bridges: NativeBridge[] = [];
afterEach(() => { bridges.splice(0).forEach((bridge) => bridge.dispose()); });

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
    await expect(bridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' })).resolves.toEqual({ granted: true, inCalendar: false });
  });

  it('preserves stable error codes and times out synchronous actions', async () => {
    const { native, fakeWindow, bridge } = createNative();
    native.invoke = (_action, _payload, callbackId) => { fakeWindow.CalMobileBridge?.onResult(callbackId, false, null, '用户取消', 'cancelled'); };
    const cancelled = await bridge.call('media.store', { dataUrl: 'data:image/png;base64,x', kind: 'avatar' }).catch((error) => error);
    expect(cancelled).toBeInstanceOf(NativeBridgeError);
    expect(cancelled.code).toBe('cancelled');

    const timeoutBridge = createNative().bridge;
    await expect(timeoutBridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects outside Android and ignores unknown callback ids', async () => {
    const fakeWindow = {} as Window;
    const bridge = new NativeBridge({ windowLike: fakeWindow, timeoutMs: 10 });
    bridges.push(bridge);
    await expect(bridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' })).rejects.toThrow('没有原生桥接');
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

    const plain = await bridge.call('calendar.status', { title: '秋季展会', date: '2026-09-20' }).catch((error) => error);
    expect(plain.code).toBe('timeout');

    const interactive = bridge.call('media.pickImage', {}).catch((error) => error);
    // 短超时那一刻不该被判定为超时（交互动作有自己的长超时）
    await new Promise((resolve) => setTimeout(resolve, 30));
    const early = await Promise.race([interactive, Promise.resolve('still-pending')]);
    expect(early).toBe('still-pending');
    const late = await interactive;
    expect(late.code).toBe('timeout');
  });
});
