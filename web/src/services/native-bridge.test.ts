import { afterEach, describe, expect, it } from 'vitest';
import { NativeBridge, NativeBridgeError } from './native-bridge';

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
      fakeWindow.CalMobileBridge?.onResult(callbackId, true, { saved: true }, null, null);
    };
    await expect(bridge.call('calendar.status', { date: '2026-09-20' })).resolves.toEqual({ saved: true });
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
