import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import {
  bindPullGesture,
  pullBusy,
  pullDragging,
  pullOffset,
  pullSettling,
  pullSpinning,
  resetPullVisual,
  usePullRefresh,
} from './pull-refresh';

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

  it('后台刷新只更新忙碌状态，不滑入也不转圈', async () => {
    const refresh = vi.fn(async () => undefined);
    const busy = ref(true);
    mount(refresh, busy);

    // 缓存先画出、网络还在回来：不请求、不位移、不转圈，只把状态汇到 pullBusy。
    expect(refresh).not.toHaveBeenCalled();
    expect(pullBusy.value).toBe(true);
    expect(pullSpinning.value).toBe(false);
    expect(pullSettling.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    // 后台刷新结束也不该补一段动画。
    busy.value = false;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(pullBusy.value).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(pullSpinning.value).toBe(false);
    expect(pullSettling.value).toBe(false);
    expect(pullOffset.value).toBe(0);
  });

  it('点击导航时手指的下漂落在死区里，不点亮指示圈也不请求', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 10));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    el.dispatchEvent(pointer('pointerup', 10));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('刚好在死区内不算下拉，超过死区才开始跟手', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 16));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    el.dispatchEvent(pointer('pointermove', 20));
    expect(pullDragging.value).toBe(true);
    expect(pullOffset.value).toBeGreaterThan(0);

    // 死区之后照旧按距离取位移：20 * 0.45 还够不到阈值，松手不请求。
    el.dispatchEvent(pointer('pointerup', 20));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('resetPullVisual 把四个状态归零，并作废在途的滑入滑出', async () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 200));
    el.dispatchEvent(pointer('pointerup', 200));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBeGreaterThan(0);
    expect(pullSpinning.value).toBe(true);

    resetPullVisual();
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);
    expect(pullSpinning.value).toBe(false);
    expect(pullSettling.value).toBe(false);

    // token 已作废：等上一轮动画本该跑完的时间，状态不会被改回去。
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(pullOffset.value).toBe(0);
    expect(pullSpinning.value).toBe(false);
    expect(pullSettling.value).toBe(false);
  });
});
