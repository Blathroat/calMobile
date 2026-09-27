import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NativeBridge, NativeBridgeError } from './native-bridge';

// 文案本体在 res/values/strings_frontend.xml，由原生启动时注入；
// 单测里注入同一条，断言才看得到可读的错误说明而不是 key。
beforeAll(() => {
  window.CalMobileStrings = { s_1adnxmn: '当前环境没有原生桥接，请在 Android 应用中打开' };
});

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
      expect(JSON.parse(payload)).toEqual({ date: '2026-09-20' });
      // 原生 calendar.status 回报的就是这两个键（见 SystemActions.calendarStatus）。
      fakeWindow.CalMobileBridge?.onResult(callbackId, true, { granted: true, inCalendar: false }, null, null);
    };
    await expect(bridge.call('calendar.status', { date: '2026-09-20' })).resolves.toEqual({ granted: true, inCalendar: false });
  });

  it('preserves stable error codes and times out synchronous actions', async () => {
    const { native, fakeWindow, bridge } = createNative();
    native.invoke = (_action, _payload, callbackId) => { fakeWindow.CalMobileBridge?.onResult(callbackId, false, null, '用户取消', 'cancelled'); };
    const cancelled = await bridge.call('media.store', { dataUrl: 'data:image/png;base64,x', kind: 'avatar' }).catch((error) => error);
    expect(cancelled).toBeInstanceOf(NativeBridgeError);
    expect(cancelled.code).toBe('cancelled');

    const timeoutBridge = createNative().bridge;
    await expect(timeoutBridge.call('calendar.status', { date: '2026-09-20' })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects outside Android and ignores unknown callback ids', async () => {
    const fakeWindow = {} as Window;
    const bridge = new NativeBridge({ windowLike: fakeWindow, timeoutMs: 10 });
    bridges.push(bridge);
    await expect(bridge.call('calendar.status', { date: '2026-09-20' })).rejects.toThrow('没有原生桥接');
    fakeWindow.CalMobileBridge?.onResult('unknown', true, {}, null, null);
  });
});
