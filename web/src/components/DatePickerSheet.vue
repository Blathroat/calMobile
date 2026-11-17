<script setup lang="ts">
/**
 * 日期选择面板（共享底部面板的自定义内容）。
 *
 * 两种用法：
 * - `mode: 'range'`：选一段起止日期。第一次点选起点、第二次点选终点，选完自动收起；
 *   已有一段完整区间时，再点任意一天会从这一天重新开始选。闭展日期可以留空（单日），
 *   因此第一次点选就先回填起点，用户此时关掉面板也只保存起点。
 * - `mode: 'single'`：点一天即选中并收起。
 *
 * 面板按月份分节、可一直往后滚，顶部固定「日一二三四五六」表头，今天用圆点标出来。
 * 取值仍通过 `model` 这个响应式对象交回调用方（与 `ManualCodePanel` 同一套约定），
 * 关闭与底部动作由 `services/sheet.ts` 管，所以这里不 import 面板服务。
 */
import { nextTick, onMounted, ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import { daysInMonth, formatMonthHeading, parseDate } from '@/services/format';
import { t } from '@/i18n';

export interface DatePickerModel {
  start: string;
  end: string;
  onChange?: (value: { start: string; end: string }) => void;
  onDone?: () => void;
  onClose?: () => void;
}

const props = withDefaults(
  defineProps<{
    model: DatePickerModel;
    mode?: 'range' | 'single';
    startLabel?: string;
    endLabel?: string;
    /** 最早可选日期（`YYYY-MM-DD`）；会议申请用它挡住今天以前。 */
    min?: string;
  }>(),
  {
    mode: 'range',
    startLabel: '',
    endLabel: '',
    min: '',
  },
);

/** 周日在前，和表头「日一二三四五六」对齐。 */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MAX_FORWARD_MONTHS = 24;
const MAX_BACKWARD_MONTHS = 12;

interface DayCell {
  iso: string;
  day: number;
}

interface MonthSection {
  key: string;
  heading: string;
  cells: Array<DayCell | null>;
}

const monthsEl = ref<HTMLElement | null>(null);
const focusedDay = ref('');

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function todayIso(): string {
  const now = new Date();
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function monthIndex(date: { year: number; month: number }): number {
  return date.year * 12 + (date.month - 1);
}

function monthKeyOf(index: number): string {
  const month = (index % 12) + 1;
  return `${Math.floor(index / 12)}-${pad(month)}`;
}

/** 起始月份：优先看已选起点，其次看最早可选日期，都没有就从今天往前 12 个月。 */
function baseMonthIndex(): number {
  const start = parseDate(props.model.start);
  if (start) return monthIndex(start);
  const today = parseDate(todayIso());
  return today ? monthIndex(today) : monthIndex({ year: 2026, month: 1 });
}

/** 月份分节：往前够到已选日期，往后固定给 24 个月，滚动就能继续看更远的月份。
 *  打开后不再随选择重建（否则每点一天都重排一整串月份），滚动位置也不会被打断。 */
function buildMonths(): MonthSection[] {
  const base = baseMonthIndex();
  const min = parseDate(props.min);
  const todayDate = parseDate(todayIso());
  const todayIndex = todayDate ? monthIndex(todayDate) : base;
  const first = min ? Math.min(monthIndex(min), base) : base - MAX_BACKWARD_MONTHS;
  const last = Math.max(base, todayIndex) + MAX_FORWARD_MONTHS;
  const sections: MonthSection[] = [];
  for (let index = first; index <= last; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const offset = new Date(year, month - 1, 1).getDay();
    const total = offset + daysInMonth(year, month);
    const rows = Math.ceil(total / 7);
    const cells: Array<DayCell | null> = [];
    for (let slot = 0; slot < rows * 7; slot += 1) {
      const day = slot - offset + 1;
      if (day < 1 || day > daysInMonth(year, month)) {
        cells.push(null);
        continue;
      }
      cells.push({ iso: isoOf(year, month, day), day });
    }
    sections.push({
      key: monthKeyOf(index),
      heading: formatMonthHeading(year, month),
      cells,
    });
  }
  return sections;
}

const months = buildMonths();

const today = todayIso();

function rangeStart(): string {
  return props.model.start;
}

function rangeEnd(): string {
  return props.model.end;
}

/** 这一格在区间里的位置；`single` 表示只标一颗圆点（单日期、单日展会或已选起点待选终点）。 */
function stateOf(iso: string): 'start' | 'end' | 'middle' | 'single' | '' {
  const start = rangeStart();
  const end = rangeEnd();
  if (props.mode === 'single') return iso === start ? 'single' : '';
  if (!start) return '';
  if (iso === start) return end && end !== start ? 'start' : 'single';
  if (end && iso === end) return 'end';
  if (end && iso > start && iso < end) return 'middle';
  return '';
}

/** 已选的那一格下方的小字：区间两端分别写「开展 / 闭展」或「开始 / 截止」。 */
function labelOf(iso: string): string {
  if (props.mode === 'single') return '';
  if (iso === rangeStart() && rangeStart() !== rangeEnd()) return props.startLabel;
  if (iso === rangeEnd()) return props.endLabel;
  return '';
}

function isDisabled(iso: string): boolean {
  if (props.min && iso < props.min) return true;
  // 已经点了起点、还在等终点：比起点还早的日期不能当终点（闭展不能早于开展）。
  if (props.mode === 'range' && rangeStart() && !rangeEnd() && iso < rangeStart()) return true;
  return false;
}

function isSelected(iso: string): boolean {
  return iso === rangeStart() || iso === rangeEnd();
}

function dayAriaLabel(iso: string): string {
  return iso === today ? `${iso} ${t('picker.today')}` : iso;
}

/**
 * 点选一天：
 * - 单日期：选中即完成。
 * - 区间：还没起点、或已有一段完整区间时，从这一天重新开始；否则这一天是终点。
 *   第一次点选就把起点回填给表单，只选开始不选结束也能保存。
 */
function pick(iso: string): void {
  if (isDisabled(iso)) return;
  focusedDay.value = iso;
  if (props.mode === 'single') {
    props.model.start = iso;
    props.model.end = '';
    props.model.onChange?.({ start: iso, end: '' });
    props.model.onDone?.();
    return;
  }
  if (!rangeStart() || rangeEnd()) {
    props.model.start = iso;
    props.model.end = '';
    props.model.onChange?.({ start: iso, end: '' });
    return;
  }
  props.model.end = iso;
  props.model.onChange?.({ start: rangeStart(), end: iso });
  props.model.onDone?.();
}

/** 焦点跟着方向键走：左右一天，上下七天。 */
function moveFocus(event: KeyboardEvent, iso: string): void {
  const step =
    event.key === 'ArrowLeft'
      ? -1
      : event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp'
          ? -7
          : event.key === 'ArrowDown'
            ? 7
            : 0;
  if (!step) return;
  event.preventDefault();
  const parts = parseDate(iso);
  if (!parts) return;
  const date = new Date(parts.year, parts.month - 1, parts.day + step);
  const next = isoOf(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const button = monthsEl.value?.querySelector<HTMLElement>(`[data-date="${next}"]`);
  if (button && !button.hasAttribute('disabled')) {
    focusedDay.value = next;
    void nextTick(() => button.focus());
  }
}

/** 打开时把视图滚到已选日期（没有就滚到今天）所在的月份。 */
function scrollToMonth(index: number): void {
  const container = monthsEl.value;
  if (!container) return;
  const section = container.querySelector<HTMLElement>(`[data-month="${monthKeyOf(index)}"]`);
  if (!section) return;
  container.scrollTop = section.offsetTop;
}

onMounted(() => {
  const start = parseDate(props.model.start);
  const target = start ? monthIndex(start) : baseMonthIndex();
  // 键盘落点：已选日期，否则今天（不在可见月份里就用当月第一天）。
  focusedDay.value = props.model.start || today;
  void nextTick(() => scrollToMonth(target));
});
</script>

<template>
  <div class="date-picker">
    <button class="picker-close" type="button" :aria-label="t('common.close')" @click="props.model.onClose?.()">
      <AppIcon name="close" size="icon icon-sm" />
    </button>

    <div class="date-picker-weekdays" aria-hidden="true">
      <span v-for="label in WEEKDAYS" :key="label">{{ label }}</span>
    </div>

    <div ref="monthsEl" class="date-picker-months">
      <section v-for="section in months" :key="section.key" class="date-picker-month" :data-month="section.key">
        <h3 class="date-picker-month-title">{{ section.heading }}</h3>
        <div class="date-picker-grid">
          <template v-for="(cell, index) in section.cells" :key="cell ? cell.iso : `${section.key}-blank-${index}`">
            <span v-if="!cell" class="date-picker-blank" aria-hidden="true" />
            <button
              v-else
              class="date-picker-day"
              type="button"
              :data-date="cell.iso"
              :data-state="stateOf(cell.iso)"
              :data-today="cell.iso === today ? 'true' : undefined"
              :disabled="isDisabled(cell.iso)"
              :aria-label="dayAriaLabel(cell.iso)"
              :aria-pressed="isSelected(cell.iso) ? 'true' : 'false'"
              :tabindex="cell.iso === focusedDay ? 0 : -1"
              @click="pick(cell.iso)"
              @focus="focusedDay = cell.iso"
              @keydown="moveFocus($event, cell.iso)"
            >
              <span class="date-picker-num">{{ cell.day }}</span>
              <span v-if="labelOf(cell.iso)" class="date-picker-label">{{ labelOf(cell.iso) }}</span>
              <span v-else-if="cell.iso === today" class="date-picker-today" aria-hidden="true" />
            </button>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style>
/* 面板标题右侧的关闭按钮：面板由 AppSheet 统一渲染，内容组件只能靠 :has() 把面板变成定位父级。
   44px 的命中区刚好压在标题行右端，标题文案不会被盖住。 */
.sheet-panel:has(> .date-picker) {
  position: relative;
}

.picker-close {
  position: absolute;
  top: calc(var(--s4) - var(--s1));
  inset-inline-end: calc(var(--s4) - var(--s1));
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--touch);
  height: var(--touch);
  padding: 0;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--ink-2);
}

@media (hover: hover) {
  .picker-close:hover {
    background: var(--f3);
  }
}

.date-picker {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--s1);
  min-height: 0;
}

/* 周几表头：固定不随月份滚动，和日历格共用同一套列宽。 */
.date-picker-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  padding-block: var(--s1);
  color: var(--ink-3);
  font-size: var(--fs-meta);
  text-align: center;
}

.date-picker-months {
  position: relative;
  min-height: 0;
  max-height: min(56dvh, 380px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.date-picker-months::-webkit-scrollbar {
  display: none;
}

/* 月份分节标题：滚动时贴在面板顶部，读起来就是「当前月份」。 */
.date-picker-month-title {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--s2) var(--s1) var(--s1);
  background: var(--screen);
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
}

.date-picker-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.date-picker-blank {
  height: 50px;
}

.date-picker-day {
  position: relative;
  height: 50px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

.date-picker-day:disabled {
  color: var(--ink-3);
  opacity: 0.5;
  cursor: not-allowed;
}

/* 区间带：中间日期铺满整格，两端各收一半，拼起来是一条连续浅色带。
   动效只改 opacity，不重排。 */
.date-picker-day::before {
  content: '';
  position: absolute;
  inset-block: 6px 12px;
  inset-inline: 0;
  background: var(--accent-glow);
  opacity: 0;
  transition: opacity var(--motion-fast) var(--ease);
}

.date-picker-day[data-state='middle']::before,
.date-picker-day[data-state='start']::before,
.date-picker-day[data-state='end']::before {
  opacity: 1;
}

.date-picker-day[data-state='start']::before {
  inset-inline-start: 50%;
}

.date-picker-day[data-state='end']::before {
  inset-inline-end: 50%;
}

/* 选中的圆角蓝块：圆点用 scale 弹出来，颜色直接换，不动画非合成属性。 */
.date-picker-num {
  position: absolute;
  top: 6px;
  inset-inline-start: 50%;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-pill);
  transform: translateX(-50%);
  /* 单独成层：圆底画在自己的内容后面，数字才不会被盖住。 */
  isolation: isolate;
  font-size: var(--fs-body);
  line-height: 1;
}

.date-picker-num::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--accent);
  opacity: 0;
  transform: scale(0.7);
  transition:
    opacity var(--motion-quick) var(--ease),
    transform var(--motion-quick) var(--ease-spring);
}

.date-picker-day[data-state='start'] .date-picker-num,
.date-picker-day[data-state='end'] .date-picker-num,
.date-picker-day[data-state='single'] .date-picker-num {
  color: var(--on-dark);
  font-weight: 700;
}

.date-picker-day[data-state='start'] .date-picker-num::before,
.date-picker-day[data-state='end'] .date-picker-num::before,
.date-picker-day[data-state='single'] .date-picker-num::before {
  opacity: 1;
  transform: none;
}

/* 今天：未选中时在数字下方点一个圆点；选中后让位给「开展 / 闭展」小字。 */
.date-picker-today {
  position: absolute;
  bottom: 2px;
  inset-inline-start: 50%;
  width: 4px;
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--accent);
  transform: translateX(-50%);
}

.date-picker-label {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 1;
  color: var(--accent-ink);
  font-size: var(--fs-tag);
  font-weight: 700;
  line-height: 12px;
  text-align: center;
}

/* 月份分节随滚动进入视野时轻轻浮起来：只动 transform / opacity。
   不支持滚动驱动动画的 WebView 直接静态显示，不影响使用。 */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .date-picker-month {
      animation: date-picker-month-in var(--motion-normal) var(--ease-out) both;
      animation-timeline: view();
      animation-range: entry 0% entry 16%;
    }
  }
}

@keyframes date-picker-month-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .date-picker-day::before,
  .date-picker-num::before {
    transition: none;
  }
}
</style>
