/**
 * 上传进度遮罩：暗色 scrim 随百分比从顶部退下、中间数字同步变化；
 * 到 100% 后至少停留 150ms 再发 settled，调用方收到才卸载（上传很快时也看得见）。
 * 失败 / 取消由调用方直接清空，这里只钉住「不会残留 100%、也不会再报 settled」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue';
import UploadProgressMask from './upload-progress-mask.vue';

vi.mock('@/i18n', () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}:${params?.percent ?? ''}` }));

let app: App | undefined;
let progress: Ref<number | null>;
/** settled 触发次数：直接数，不用 mock，避免和 h() 的 props 类型打架。 */
let settledCalls = 0;

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function mount(initial: number | null): void {
  progress = ref(initial);
  settledCalls = 0;
  app = createApp({
    render: () =>
      h(UploadProgressMask, {
        progress: progress.value,
        onSettled: () => {
          settledCalls += 1;
        },
      }),
  });
  app.mount('#host');
}

function scrim(): HTMLElement {
  return document.querySelector<HTMLElement>('.upload-progress-scrim')!;
}

function valueText(): string | undefined {
  return document.querySelector('.upload-progress-value')?.textContent?.trim();
}

function liveText(): string | undefined {
  return document.querySelector('[aria-live]')?.textContent?.trim();
}

function mask(): HTMLElement {
  return document.querySelector<HTMLElement>('.upload-progress-mask')!;
}

describe('上传进度遮罩', () => {
  it('起步是整块暗色 scrim 与 0%，并暴露无障碍进度', () => {
    mount(0);
    expect(mask().getAttribute('role')).toBe('progressbar');
    expect(mask().getAttribute('aria-valuenow')).toBe('0');
    expect(mask().getAttribute('aria-valuemin')).toBe('0');
    expect(mask().getAttribute('aria-valuemax')).toBe('100');
    expect(scrim().style.height).toBe('100%');
    // 0% 用整块实色，底边过渡段不漏亮边。
    expect(scrim().style.background).toContain('media-scrim');
    expect(valueText()).toBe('0%');
    expect(liveText()).toBe('media.uploadingPercent:0');
  });

  it('progress 为 null（刚选中、还没拿到进度）按 0% 显示，不报错', () => {
    mount(null);
    expect(scrim().style.height).toBe('100%');
    expect(valueText()).toBe('0%');
  });

  it('暗色遮罩从顶部随进度退下，数字取整', async () => {
    mount(0);
    progress.value = 42.6;
    await nextTick();
    expect(scrim().style.height).toBe('57%');
    // 有进度后回到带过渡的渐变（底部 14px 由暗到透）。
    expect(scrim().style.background).toBe('');
    expect(valueText()).toBe('43%');
    expect(mask().getAttribute('aria-valuenow')).toBe('43');
  });

  it('越界进度夹到 0–100', async () => {
    mount(-20);
    expect(valueText()).toBe('0%');
    expect(scrim().style.height).toBe('100%');
    progress.value = 130;
    await nextTick();
    expect(valueText()).toBe('100%');
    expect(scrim().style.height).toBe('0%');
  });

  it('同一个整数内的浮点进度不刷新播报文本', async () => {
    mount(41);
    const before = document.querySelector('[aria-live]')?.textContent;
    progress.value = 41.2;
    await nextTick();
    expect(document.querySelector('[aria-live]')?.textContent).toBe(before);
    progress.value = 42;
    await nextTick();
    expect(liveText()).toBe('media.uploadingPercent:42');
  });

  it('100% 停留 150ms 后才发 settled，避免上传太快时一闪而过', async () => {
    vi.useFakeTimers();
    mount(0);
    progress.value = 100;
    await nextTick();
    vi.advanceTimersByTime(149);
    expect(settledCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(settledCalls).toBe(1);
    // 停留期间数字保持 100%，不提前变成别的值。
    expect(valueText()).toBe('100%');
  });

  it('100% 掉回中间值时作废停留计时器（新一轮上传不会提前收掉遮罩）', async () => {
    vi.useFakeTimers();
    mount(100);
    progress.value = 45;
    await nextTick();
    vi.advanceTimersByTime(300);
    expect(settledCalls).toBe(0);
    expect(valueText()).toBe('45%');
  });

  it('100% 之后重复收到进度只保留一个停留计时器', async () => {
    vi.useFakeTimers();
    mount(0);
    progress.value = 100;
    await nextTick();
    progress.value = 99;
    await nextTick();
    progress.value = 100;
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(settledCalls).toBe(1);
  });

  it('停留期间被卸载（失败 / 取消）不再发 settled，也不留残留遮罩', () => {
    vi.useFakeTimers();
    mount(100);
    app!.unmount();
    app = undefined;
    vi.advanceTimersByTime(300);
    expect(settledCalls).toBe(0);
    expect(document.querySelector('.upload-progress-mask')).toBeNull();
  });
});
