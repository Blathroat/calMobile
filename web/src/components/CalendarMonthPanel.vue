<script setup lang="ts">
/**
 * 一个月历面板：星期表头 + 日期格子。
 *
 * 首页用三份：中间是可交互的当前月，左右两份是相邻月份的预览（aria-hidden + inert）。
 */
import { computed } from 'vue';
import { addMonths, calendarRowCount, daysInMonth, firstWeekdayOffset } from '@/services/format';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const props = withDefaults(
  defineProps<{
    year: number;
    month: number;
    data?: JsonObject;
    selectedDay?: number;
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
  month: number;
  muted: boolean;
  bold: boolean;
  hasEvent: boolean;
  disabled: boolean;
}

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
  gap: 2px;
}

.week-row {
  margin-bottom: 4px;
  padding-bottom: 6px;
  border-bottom: var(--hairline) solid var(--stroke);
  color: var(--ink-3);
  font-size: var(--fs-xs);
  font-weight: 500;
  text-align: center;
}

.cal-day {
  position: relative;
  min-width: 0;
  min-height: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 4px 0;
  border: var(--hairline) solid transparent;
  border-radius: var(--r-input);
  background: transparent;
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 400;
}

.cal-day[data-muted='true'] {
  color: var(--ink-3);
  opacity: 0.45;
}

.cal-day-num {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.cal-day[data-bold='true'] .cal-day-num {
  font-weight: 600;
  color: var(--accent-ink);
}

.cal-day[data-has-event='true']::after {
  content: '';
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--accent-solid);
}

.cal-day[data-has-event='false']::after {
  content: '';
  flex: none;
  width: 4px;
  height: 4px;
  background: transparent;
}

.cal-day[aria-pressed='true'] {
  background: var(--accent-soft);
  border-color: var(--accent-edge);
  color: var(--accent-ink);
  font-weight: 600;
}

.cal-day[aria-pressed='true'] .cal-day-num {
  color: var(--accent-ink);
  font-weight: 600;
}

.cal-day[aria-pressed='true'][data-has-event='true']::after {
  background: var(--accent-ink);
}

.cal-day:focus-visible {
  outline: 1px solid var(--accent-ring);
  outline-offset: -1px;
  border-radius: var(--r-input);
}
</style>
