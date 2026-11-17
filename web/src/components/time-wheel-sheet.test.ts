/**
 * 时间滚轮：打开时滚到传入的时 / 分、滚动结算选中行、点选与方向键换值。
 *
 * 滚动位置用固定行高换算（一行 44px），所以这里直接设置 scrollTop 再派发 scroll 事件，
 * 与真机上的滚动结算走同一条路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import TimeWheelSheet, { type TimeWheelModel } from './TimeWheelSheet.vue';

const ITEM = 44;

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  await nextTick();
}

function mountWheel(hour = 9, minute = 5) {
  const onClose = vi.fn();
  const model = reactive<TimeWheelModel>({ hour, minute, onClose });
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({ render: () => h(TimeWheelSheet, { model }) });
  app.mount(container);
  return { model, onClose };
}

function column(index: 0 | 1): HTMLElement {
  const columns = document.querySelectorAll<HTMLElement>('.time-wheel-column');
  const element = columns[index];
  if (!element) throw new Error('缺少滚轮列');
  return element;
}

function selected(kind: 'hour' | 'minute', value: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-${kind}="${value}"]`);
}

describe('时间滚轮面板', () => {
  it('打开时滚到传入的时 / 分，并高亮那一行', async () => {
    mountWheel(9, 5);
    await flush();
    expect(column(0).scrollTop).toBe(9 * ITEM);
    expect(column(1).scrollTop).toBe(5 * ITEM);
    expect(selected('hour', 9)?.dataset.selected).toBe('true');
    expect(selected('minute', 5)?.dataset.selected).toBe('true');
  });

  it('滚动停下后按离中线最近的一行结算选中值', async () => {
    const { model } = mountWheel(9, 5);
    await flush();

    const hours = column(0);
    hours.scrollTop = 14 * ITEM;
    hours.dispatchEvent(new Event('scroll'));
    await flush();
    expect(model.hour).toBe(14);
    expect(selected('hour', 14)?.dataset.selected).toBe('true');

    const minutes = column(1);
    minutes.scrollTop = 30 * ITEM;
    minutes.dispatchEvent(new Event('scroll'));
    await flush();
    expect(model.minute).toBe(30);
  });

  it('点某一项把值改过去', async () => {
    const { model } = mountWheel(9, 5);
    await flush();
    selected('hour', 15)?.click();
    await flush();
    expect(model.hour).toBe(15);
    selected('minute', 40)?.click();
    await flush();
    expect(model.minute).toBe(40);
  });

  it('方向键也能换值，并夹在时 / 分的合法范围内', async () => {
    const { model } = mountWheel(0, 0);
    await flush();
    const hours = column(0);
    hours.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    expect(model.hour).toBe(0);

    hours.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();
    expect(model.hour).toBe(1);
  });

  it('右上角关闭按钮交回调给调用方', async () => {
    const { onClose } = mountWheel();
    await flush();
    document.querySelector<HTMLButtonElement>('.picker-close')?.click();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
