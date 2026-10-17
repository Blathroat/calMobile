import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { bindPullGesture, pullOffset, pullSpinning, usePullRefresh } from './pull-refresh';

let scope: EffectScope | undefined;
let unbind: (() => void) | undefined;
let element: HTMLElement | undefined;

afterEach(() => {
  unbind?.();
  unbind = undefined;
  scope?.stop();
  scope = undefined;
  element?.remove();
  element = undefined;
});

function mount(refresh: () => Promise<unknown>, busy = ref(false)): HTMLElement {
  element = document.createElement('main');
  document.body.appendChild(element);
  scope = effectScope();
  scope.run(() => {
    usePullRefresh(refresh, busy);
  });
  unbind = bindPullGesture(element);
  return element;
}

function pointer(type: string, y: number): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    clientX: 0,
    clientY: y,
    pointerType: 'touch',
    bubbles: true,
    cancelable: true,
  });
}

describe('下拉刷新', () => {
  it('手指按着时不转也不请求，松手后才刷新，快返回也先留在展开位置', async () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 200));
    expect(refresh).not.toHaveBeenCalled();
    expect(pullSpinning.value).toBe(false);
    expect(pullOffset.value).toBeGreaterThan(56);

    el.dispatchEvent(pointer('pointerup', 200));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(pullSpinning.value).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(pullOffset.value).toBeGreaterThan(0);
    expect(pullSpinning.value).toBe(true);

    const start = Date.now();
    while (pullOffset.value > 0 && Date.now() - start < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    expect(pullOffset.value).toBe(0);
    expect(pullSpinning.value).toBe(false);
  });

  it('缓存还在更新时滑入滑出，不另发一次请求', async () => {
    const refresh = vi.fn(async () => undefined);
    const busy = ref(true);
    mount(refresh, busy);
    expect(refresh).not.toHaveBeenCalled();
    expect(pullSpinning.value).toBe(true);

    busy.value = false;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(refresh).not.toHaveBeenCalled();
    expect(pullOffset.value).toBeGreaterThan(0);
    expect(pullSpinning.value).toBe(true);

    const start = Date.now();
    while (pullOffset.value > 0 && Date.now() - start < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    expect(pullOffset.value).toBe(0);
    expect(pullSpinning.value).toBe(false);
  });
});
