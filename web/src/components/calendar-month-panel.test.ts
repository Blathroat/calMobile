/**
 * 月历面板：日期排布（含上/下月补位）、展会加粗、我的活动圆点、选中态与点击回传。
 *
 * 首页把同一组件用三次（当前月可交互，左右预览只排日期），所以这里只测组件自己的数据与
 * 交互语义，不测滑动与预览层的位移（由 `home-calendar-preview.test.ts` 覆盖）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import CalendarMonthPanel from './CalendarMonthPanel.vue';
import { calendarRowCount, daysInMonth } from '@/services/format';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  await nextTick();
}

async function mount(props: {
  year: number;
  month: number;
  data?: Record<string, unknown>;
  selectedDay?: number;
  interactive?: boolean;
  onSelect?: (day: number) => void;
}): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="cal-panel-test"></div>';
  app = createApp({
    render: () =>
      h(CalendarMonthPanel, {
        year: props.year,
        month: props.month,
        data: props.data,
        selectedDay: props.selectedDay ?? 0,
        interactive: props.interactive ?? false,
        onSelect: props.onSelect,
      }),
  });
  app.mount('#cal-panel-test');
  await flush();
  return document.body;
}

function days(scope: ParentNode): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>('.cal-day')];
}

describe('月历面板', () => {
  it('按月份排 5 或 6 行，并用相邻月份补满整行', async () => {
    const container = await mount({ year: 2026, month: 6 });
    const grid = container.querySelector<HTMLElement>('.calendar-grid')!;
    expect(grid.dataset.rows).toBe(String(calendarRowCount(2026, 6)));
    expect(days(container).length).toBe(calendarRowCount(2026, 6) * 7);
    const own = days(container).filter((button) => button.dataset.muted === 'false');
    expect(own.length).toBe(daysInMonth(2026, 6));
  });

  it('展会更粗、我的活动带圆点，选中日的 aria-pressed 只有一格', async () => {
    const container = await mount({
      year: 2026,
      month: 6,
      selectedDay: 12,
      data: { eventDays: [3, 12], markedDays: [12], day: 12, exhibitions: [], meetings: [] },
    });
    const bold = days(container).filter((button) => button.dataset.bold === 'true');
    const marked = days(container).filter((button) => button.dataset.hasEvent === 'true');
    expect(bold.length).toBe(2);
    expect(marked.length).toBe(1);
    const pressed = days(container).filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(1);
    expect(pressed[0]?.dataset.day).toBe('12');
  });

  it('可交互时点日期回传，预览面板上的按钮全部禁用且不回传', async () => {
    const onSelect = vi.fn();
    const container = await mount({ year: 2026, month: 6, interactive: true, onSelect });
    const target = days(container).find((button) => button.dataset.day === '9' && button.dataset.muted === 'false');
    target?.click();
    await nextTick();
    expect(onSelect).toHaveBeenCalledWith(9);

    document.body.innerHTML = '';
    app?.unmount();
    const preview = await mount({ year: 2026, month: 7, onSelect });
    expect(days(preview).every((button) => button.disabled)).toBe(true);
    days(preview)
      .find((button) => button.dataset.day === '10')
      ?.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('没有当月数据时只排日期，不画展会高亮与圆点', async () => {
    const container = await mount({ year: 2026, month: 7 });
    expect(days(container).filter((button) => button.dataset.bold === 'true').length).toBe(0);
    expect(days(container).filter((button) => button.dataset.hasEvent === 'true').length).toBe(0);
  });
});
