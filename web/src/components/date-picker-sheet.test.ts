/**
 * 日期选择面板：范围选择的两次点选、重新开始、终点不能早于起点、今天标记、单日期模式，
 * 以及 min / max 两端边界的禁用。
 *
 * 面板直接挂到 jsdom 上（不经过共享底部面板），取值全部经由 `model` 的响应式对象交回，
 * 所以这里只验证组件自己的选择语义与回填时机。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import DatePickerSheet, { type DatePickerModel } from './DatePickerSheet.vue';

interface MountOptions {
  mode?: 'range' | 'single';
  start?: string;
  end?: string;
  min?: string;
  max?: string;
}

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function iso(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  await nextTick();
}

function mountPicker(options: MountOptions = {}) {
  const onChange = vi.fn();
  const onDone = vi.fn();
  const onClose = vi.fn();
  const model = reactive<DatePickerModel>({
    start: options.start ?? '',
    end: options.end ?? '',
    onChange,
    onDone,
    onClose,
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({
    render: () =>
      h(DatePickerSheet, {
        model,
        mode: options.mode ?? 'range',
        startLabel: '开展',
        endLabel: '闭展',
        min: options.min ?? '',
        max: options.max ?? '',
      }),
  });
  app.mount(container);
  return { model, onChange, onDone, onClose, container };
}

function dayButton(isoDate: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-date="${isoDate}"]`);
  if (!button) throw new Error(`没有渲染 ${isoDate} 这一天`);
  return button;
}

describe('日期选择面板', () => {
  it('渲染周几表头、月份分节，并标出今天', async () => {
    mountPicker();
    await flush();
    const weekdays = [...document.querySelectorAll('.date-picker-weekdays span')].map((item) => item.textContent);
    expect(weekdays).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(document.querySelectorAll('.date-picker-month').length).toBeGreaterThan(12);
    expect(document.querySelector('.date-picker-month-title')?.textContent).toMatch(/^\d{4}年\d{1,2}月$/);
    expect(document.querySelector('[data-today="true"]')).not.toBeNull();
  });

  it('第一次点选回填起点但还开着，第二次点选端点后完成', async () => {
    const start = iso(3);
    const end = iso(8);
    const { model, onChange, onDone } = mountPicker();
    await flush();

    dayButton(start).click();
    await flush();
    expect(model.start).toBe(start);
    expect(model.end).toBe('');
    expect(onChange).toHaveBeenLastCalledWith({ start, end: '' });
    expect(onDone).not.toHaveBeenCalled();

    dayButton(end).click();
    await flush();
    expect(model.end).toBe(end);
    expect(onChange).toHaveBeenLastCalledWith({ start, end });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('已有一段完整区间时，再点一天从这天重新开始', async () => {
    const start = iso(4);
    const end = iso(12);
    const next = iso(7);
    const { model, onChange, onDone } = mountPicker({ start, end });
    await flush();

    dayButton(next).click();
    await flush();
    expect(model.start).toBe(next);
    expect(model.end).toBe('');
    expect(onChange).toHaveBeenLastCalledWith({ start: next, end: '' });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('还没选终点时，早于起点的日期不可选', async () => {
    const start = iso(6);
    const earlier = iso(2);
    const { model } = mountPicker();
    await flush();

    dayButton(start).click();
    await flush();
    expect(dayButton(earlier).disabled).toBe(true);
    dayButton(earlier).click();
    await flush();
    expect(model.start).toBe(start);
    expect(model.end).toBe('');
  });

  it('区间两端的格子里写「开展 / 闭展」', async () => {
    mountPicker({ start: iso(2), end: iso(5) });
    await flush();
    const labels = [...document.querySelectorAll('.date-picker-label')].map((item) => item.textContent);
    expect(labels).toEqual(['开展', '闭展']);
  });

  it('单日期模式点一天即完成', async () => {
    const picked = iso(9);
    const { model, onChange, onDone } = mountPicker({ mode: 'single' });
    await flush();

    dayButton(picked).click();
    await flush();
    expect(model.start).toBe(picked);
    expect(onChange).toHaveBeenLastCalledWith({ start: picked, end: '' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('min 之前的日期不可选（会议日期不能早于今天）', async () => {
    mountPicker({ mode: 'single', min: iso(0) });
    await flush();
    expect(dayButton(iso(-1)).disabled).toBe(true);
    expect(dayButton(iso(1)).disabled).toBe(false);
  });

  it('max 之后的日期不可选（参加时间不能超出闭展日）', async () => {
    mountPicker({ max: iso(5) });
    await flush();
    expect(dayButton(iso(5)).disabled).toBe(false);
    expect(dayButton(iso(6)).disabled).toBe(true);
    // 点击被禁用的日期不写回任何值。
    dayButton(iso(6)).click();
    await flush();
    expect(document.querySelector('[data-state="single"]')).toBeNull();
  });

  it('右上角关闭按钮交回调给调用方', async () => {
    const { onClose } = mountPicker();
    await flush();
    document.querySelector<HTMLButtonElement>('.picker-close')?.click();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
