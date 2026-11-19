/**
 * 日期 / 时间选择的便捷入口。
 *
 * 都走共享底部面板：调用方只给初始值与回调，面板内容由
 * `components/DatePickerSheet.vue`（日期范围 / 单个日期）与
 * `components/TimeWheelSheet.vue`（时 / 分滚轮）渲染。
 * 选中即回填、滚完确定后再写回，关闭与底部按钮仍由 `services/sheet.ts` 统一管。
 */
import { reactive } from 'vue';
import DatePickerSheet from '@/components/DatePickerSheet.vue';
import TimeWheelSheet from '@/components/TimeWheelSheet.vue';
import { closeSheet, openSheet } from './sheet';
import { t } from '@/i18n';

export interface DateRangeSelection {
  start: string;
  end: string;
}

export interface ClockValue {
  hour: number;
  minute: number;
}

/** `HH:MM` → 时 / 分；空串、`HH:MM-HH:MM` 这类其它写法返回 null。 */
export function parseClock(value: unknown): ClockValue | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** 时 / 分 → 服务端与表单都认的 `HH:MM`。 */
export function formatClock(hour: number, minute: number): string {
  const hours = Math.min(Math.max(Math.trunc(hour), 0), 23);
  const minutes = Math.min(Math.max(Math.trunc(minute), 0), 59);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * 日期范围抽屉。
 *
 * 第一次点选就把起点回填（`onChange`），第二次点选终点后自动收起；
 * 底部「清除」把起止都清空，用来取消整个报名窗口或把展会改回单日。
 */
export function openDateRange(options: {
  start?: string;
  end?: string;
  startLabel: string;
  endLabel: string;
  /** 最早可选日期（`YYYY-MM-DD`）；空串不限制。 */
  min?: string;
  /** 最晚可选日期（`YYYY-MM-DD`）；空串不限制。超出它的日期在面板里禁用。 */
  max?: string;
  title?: string;
  onChange: (value: DateRangeSelection) => void;
}): void {
  const model = reactive({
    start: options.start ?? '',
    end: options.end ?? '',
    onChange: (value: DateRangeSelection) => options.onChange(value),
    onDone: () => closeSheet(),
    onClose: () => closeSheet(),
  });
  openSheet({
    title: options.title ?? t('picker.selectDate'),
    component: DatePickerSheet,
    props: {
      model,
      mode: 'range',
      startLabel: options.startLabel,
      endLabel: options.endLabel,
      min: options.min ?? '',
      max: options.max ?? '',
    },
    size: 'full',
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('picker.clear'),
        onClick: (close) => {
          options.onChange({ start: '', end: '' });
          close();
        },
      },
    ],
  });
}

/** 单个日期抽屉：点一天即选中并收起。 */
export function openSingleDate(options: {
  value?: string;
  min?: string;
  title?: string;
  onChange: (value: string) => void;
}): void {
  const model = reactive({
    start: options.value ?? '',
    end: '',
    onChange: (value: DateRangeSelection) => options.onChange(value.start),
    onDone: () => closeSheet(),
    onClose: () => closeSheet(),
  });
  openSheet({
    title: options.title ?? t('picker.selectDate'),
    component: DatePickerSheet,
    props: {
      model,
      mode: 'single',
      min: options.min ?? '',
    },
    size: 'full',
    actions: [{ label: t('common.cancel'), onClick: (close) => close() }],
  });
}

/**
 * 时间滚轮抽屉。
 *
 * 初始值可以是空串（时间选填）：优先用 `fallback` 摆到一个合理的起始位置，
 * 两者都没有就从 09:00 开始滚。「清除」允许把时间留空。
 */
export function openTime(options: {
  value?: string;
  fallback?: string;
  title?: string;
  onConfirm: (value: string) => void;
  onClear?: () => void;
}): void {
  const initial = parseClock(options.value) ?? parseClock(options.fallback) ?? { hour: 9, minute: 0 };
  const model = reactive({
    hour: initial.hour,
    minute: initial.minute,
    onClose: () => closeSheet(),
  });
  openSheet({
    title: options.title ?? t('picker.selectTime'),
    component: TimeWheelSheet,
    props: { model },
    size: 'full',
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('picker.clear'),
        onClick: (close) => {
          options.onClear?.();
          close();
        },
      },
      {
        label: t('app.confirm'),
        variant: 'primary',
        onClick: (close) => {
          options.onConfirm(formatClock(model.hour, model.minute));
          close();
        },
      },
    ],
  });
}
