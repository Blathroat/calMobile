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
  suppressPull,
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
  return pointerAt(type, 0, y);
}

function pointerAt(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    clientX: x,
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

  it('斜划日历：横向一追平就放弃这次下拉，不留指示圈也不刷新', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointerAt('pointerdown', 0, 0));
    el.dispatchEvent(pointerAt('pointermove', 10, 40));
    // 先竖后横：横向追平后立刻放弃，位移归零，横滑交回页面。
    el.dispatchEvent(pointerAt('pointermove', 200, 45));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    // 这次手势已经作废，之后的抬手不会再发请求。
    el.dispatchEvent(pointerAt('pointerup', 200, 45));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('斜划刚过死区不跟手，纵向下拉明显占优后才跟手', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointerAt('pointerdown', 0, 0));
    // 30 : 40 还不到纵向的 1.5 倍，不点亮指示圈。
    el.dispatchEvent(pointerAt('pointermove', 30, 40));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    // 纵向明显占优后才照旧跟手。
    el.dispatchEvent(pointerAt('pointermove', 30, 60));
    expect(pullDragging.value).toBe(true);
    expect(pullOffset.value).toBeGreaterThan(0);

    el.dispatchEvent(pointerAt('pointerup', 30, 60));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pointercancel 不是松手：不刷新，并把状态复位', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 200));
    expect(pullOffset.value).toBeGreaterThan(56);

    // 浏览器接管手势（原生滚动）：复位收起，不进入刷新。
    el.dispatchEvent(pointer('pointercancel', 200));
    expect(refresh).not.toHaveBeenCalled();
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);
    expect(pullSpinning.value).toBe(false);
  });

  it('宿主接管横滑后不再跟手，已经露出的位移立刻收回', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 40));
    expect(pullDragging.value).toBe(true);
    expect(pullOffset.value).toBeGreaterThan(0);

    // 页面自己的横滑处理器宣布接管：这次手势作废，圈与位移都收回。
    suppressPull();
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    el.dispatchEvent(pointer('pointermove', 80));
    expect(pullDragging.value).toBe(false);
    expect(pullOffset.value).toBe(0);

    el.dispatchEvent(pointer('pointerup', 80));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('新手势重新可用：压制只作用于被接管的那一次手势', () => {
    const refresh = vi.fn(async () => undefined);
    const el = mount(refresh);

    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 40));
    suppressPull();
    el.dispatchEvent(pointer('pointerup', 40));

    // 新手势从 pointerdown 重新开始：上一次的压制已经清掉，竖直下拉照旧跟手。
    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 80));
    expect(pullDragging.value).toBe(true);
    expect(pullOffset.value).toBeGreaterThan(0);

    // 80 * 0.45 = 36，还没到 56 的阈值，松手不请求。
    el.dispatchEvent(pointer('pointerup', 80));
    expect(refresh).not.toHaveBeenCalled();
  });
});
