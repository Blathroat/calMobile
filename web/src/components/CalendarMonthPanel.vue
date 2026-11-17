<script setup lang="ts">
/**
 * 一个月历面板：星期表头 + 日期格子。
 *
 * 首页用三份：中间是可交互的当前月，左右两份是相邻月份的**预览**（只排日期，不带
 * 展会高亮与圆点数据），拖动日历卡片时从两侧露出，避免滑到一半看到空白。
 * 预览面板由父组件套 `.calendar-preview` 并加 `aria-hidden` / `inert`，这里只负责内容。
 */
import { computed } from 'vue';
import { addMonths, calendarRowCount, daysInMonth, firstWeekdayOffset } from '@/services/format';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const props = withDefaults(
  defineProps<{
    year: number;
    month: number;
    /** 当月的读接口结果：没有时只排日期（预览面板就是这样）。 */
    data?: JsonObject;
    /** 当前选中的日期；预览面板传 0。 */
    selectedDay?: number;
    /** 是否可点选日期；预览面板为 false，按钮一并禁用避免抢焦点。 */
    interactive?: boolean;
  }>(),
  { data: undefined, selectedDay: 0, interactive: false },
);
const emit = defineEmits<{ select: [day: number] }>();

const WEEK_LABELS = [
  t('home.weekdayMon'),
  t('home.weekdayTue'),
  t('home.weekdayWed'),
  t('home.weekdayThu'),
  t('home.weekdayFri'),
  t('home.weekdaySat'),
  t('home.weekdaySun'),
];

interface Cell {
  day: number;
  /** 这一格属于哪个月：补位格子是相邻月份的日期，读屏不能报成当月。 */
  month: number;
  muted: boolean;
  /** 这一天有展会：数字加粗。和圆点不是一回事。 */
  bold: boolean;
  /** 这一天有当前用户的活动：数字下方画圆点。 */
  hasEvent: boolean;
  disabled: boolean;
}

/**
 * 行数按月份实际需要取 5 或 6 行：放得下就只排 5 行，放不下才加第 6 行。
 * 行高只有一档（`.cal-day`），所以同一行里的日期不会上下跳；不足整行时用相邻
 * 月份的日期补位（灰显不可点）。
 */
const rows = computed(() => calendarRowCount(props.year, props.month));

function eventDays(): number[] {
  return Array.isArray(props.data?.eventDays) ? (props.data?.eventDays as number[]) : [];
}

function markedDays(): number[] {
  return Array.isArray(props.data?.markedDays) ? (props.data?.markedDays as number[]) : [];
}

const cells = computed<Cell[]>(() => {
  const { year, month } = props;
  const total = daysInMonth(year, month);
  const offset = firstWeekdayOffset(year, month);
  const previous = addMonths(year, month, -1);
  const previousTotal = daysInMonth(previous.year, previous.month);
  const boldDays = new Set(eventDays());
  const marked = new Set(markedDays());
  const list: Cell[] = [];
  for (let index = 0; index < offset; index += 1) {
    list.push({
      day: previousTotal - offset + index + 1,
      month: previous.month,
      muted: true,
      bold: false,
      hasEvent: false,
      disabled: true,
    });
  }
  for (let day = 1; day <= total; day += 1) {
    list.push({
      day,
      month,
      muted: false,
      bold: boldDays.has(day),
      hasEvent: marked.has(day),
      disabled: false,
    });
  }
  const trailing = rows.value * 7 - offset - total;
  const next = addMonths(year, month, 1);
  for (let day = 1; day <= trailing; day += 1) {
    list.push({ day, month: next.month, muted: true, bold: false, hasEvent: false, disabled: true });
  }
  return list;
});

const myActivityMark = t('home.hasMyActivity');

function dayLabel(cell: Cell): string {
  const suffix = `${cell.bold ? t('home.hasExhibition') : ''}${cell.hasEvent ? myActivityMark : ''}`;
  const selected = cell.day === props.selectedDay && !cell.muted ? t('home.daySelected') : '';
  // 用格子自己的月份：补位格子是上/下月的日期，报成当月会让读屏听到错的日期。
  return t('home.dayAria', { month: cell.month, day: cell.day, marks: suffix, selected });
}

function pick(cell: Cell): void {
  if (!props.interactive || cell.disabled) return;
  emit('select', cell.day);
}
</script>

<template>
  <div class="week-row" aria-hidden="true">
    <span v-for="label in WEEK_LABELS" :key="label">{{ label }}</span>
  </div>
  <div class="calendar-grid" :data-rows="rows">
    <button
      v-for="(cell, index) in cells"
      :key="`${cell.muted ? 'p' : 'c'}-${cell.day}-${index}`"
      class="cal-day"
      type="button"
      :data-day="cell.day"
      :data-muted="cell.muted ? 'true' : 'false'"
      :data-bold="cell.bold ? 'true' : 'false'"
      :data-has-event="cell.hasEvent ? 'true' : 'false'"
      :aria-pressed="!cell.muted && cell.day === props.selectedDay ? 'true' : 'false'"
      :aria-label="dayLabel(cell)"
      :disabled="cell.disabled || !props.interactive"
      @click="pick(cell)"
    >
      <span class="cal-day-num">{{ cell.day }}</span>
    </button>
  </div>
</template>

<style>
.week-row,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--s1);
}

.week-row {
  margin-bottom: var(--s1);
  color: var(--ink-3);
  font-size: var(--fs-tag);
  font-weight: 600;
  text-align: center;
}

.cal-day {
  position: relative;
  min-width: 0;
  /* 行高只有一档：日历按月份排 5 或 6 行（放得下就 5 行），行距与字号因此完全一致。
       44px 保证触控命中区不小于这个下限。 */
  min-height: 44px;
  /* 数字与“有展会”圆点共用同一条居中轴：flex 纵向排列 + align-items: center，
       圆点因此始终落在数字正下方，不再因为绝对定位与列宽换算而偏右。 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: var(--s1) 0;
  /* 选中态只改文字与圆点，不再给整格加背景框或描边 */
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-label);
  transition: color var(--motion-fast) var(--ease);
}

.cal-day[data-muted='true'] {
  color: var(--ink-3);
}

/* 日期数字：选中时在数字正下方画一小段下划线，不使用方框 */
.cal-day-num {
  display: inline-block;
  padding-bottom: 2px;
  border-bottom: 2px solid transparent;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  transition: border-color var(--motion-fast) var(--ease);
}

/* 有展会的日期：更粗、略大，并用主题色。圆点另由 data-has-event 表示「我的活动」。 */
.cal-day[data-bold='true'] .cal-day-num {
  font-weight: 800;
  font-size: 1.12em;
  color: var(--accent);
}

/* 圆点是 flex 子项，宽度固定为 6px，不参与绝对定位，因此与数字严格对齐。 */
.cal-day[data-has-event='true']::after {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
  background: var(--accent);
}

/* 没有展会时仍占住圆点的位置，避免同一行日期上下跳动。 */
.cal-day[data-has-event='false']::after {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  background: transparent;
}

.cal-day[aria-pressed='true'] {
  background: transparent;
  color: var(--accent-ink);
  font-weight: 700;
}

.cal-day[aria-pressed='true'] .cal-day-num {
  border-bottom-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 800;
}

/* 选中日期若同时有展会，圆点用深一档的强调色，与文字一起构成选中线索 */
.cal-day[aria-pressed='true'][data-has-event='true']::after {
  background: var(--accent-ink);
}

/* 键盘导航时保留焦点环，鼠标/触摸点击不会出现方框 */
.cal-day:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: var(--r-chip);
}
</style>
