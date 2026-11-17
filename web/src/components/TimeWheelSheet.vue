<script setup lang="ts">
/**
 * 时间滚轮面板（共享底部面板的自定义内容）。
 *
 * 时、分两列各自滚动，中间一行始终是当前值；滚动停下即写回 `model.hour / model.minute`，
 * 底部「取消 / 清除 / 确定」由 `services/sheet.ts` 管，所以这里只负责选值。
 * 打开时滚到传入的值，滚轮上下两端用渐隐提示「还能继续滚」。
 */
import { nextTick, onMounted, ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import { t } from '@/i18n';

export interface TimeWheelModel {
  hour: number;
  minute: number;
  onClose?: () => void;
}

const props = defineProps<{ model: TimeWheelModel }>();

/** 行高与 CSS 的 `--wheel-item` 保持一致，滚动位置才和选中值对得上。 */
const ITEM = 44;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);

const hoursEl = ref<HTMLElement | null>(null);
const minutesEl = ref<HTMLElement | null>(null);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 把某一列滚到指定值：只设置 scrollTop，避免依赖浏览器对 smooth 的支持差异。 */
function scrollTo(el: HTMLElement | null, value: number): void {
  if (!el) return;
  el.scrollTop = value * ITEM;
}

/** 点某一项：滚过去（尊重减少动效设置）。 */
function scrollToValue(el: HTMLElement | null, value: number): void {
  if (!el) return;
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: value * ITEM, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  scrollTo(el, value);
}

/** 滚动过程中按「离中线最近的一行」结算选中值；只在值变化时写回，避免每帧触发父级渲染。 */
function onScroll(kind: 'hour' | 'minute', event: Event): void {
  const el = event.target as HTMLElement;
  const index = clamp(Math.round(el.scrollTop / ITEM), 0, kind === 'hour' ? 23 : 59);
  if (kind === 'hour') {
    if (props.model.hour !== index) props.model.hour = index;
    return;
  }
  if (props.model.minute !== index) props.model.minute = index;
}

/** 键盘方向键也换值：把焦点留在这一列上，读屏软件能连续调整。 */
function onKeydown(kind: 'hour' | 'minute', event: KeyboardEvent): void {
  const delta = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  if (kind === 'hour') {
    props.model.hour = clamp(props.model.hour + delta, 0, 23);
    scrollToValue(hoursEl.value, props.model.hour);
    return;
  }
  props.model.minute = clamp(props.model.minute + delta, 0, 59);
  scrollToValue(minutesEl.value, props.model.minute);
}

onMounted(() => {
  void nextTick(() => {
    scrollTo(hoursEl.value, props.model.hour);
    scrollTo(minutesEl.value, props.model.minute);
  });
});
</script>

<template>
  <div class="time-wheel-sheet">
    <button class="picker-close" type="button" :aria-label="t('common.close')" @click="props.model.onClose?.()">
      <AppIcon name="close" size="icon icon-sm" />
    </button>

    <div class="time-wheel">
      <span class="time-wheel-highlight" aria-hidden="true" />
      <span class="time-wheel-fade" data-edge="top" aria-hidden="true" />
      <span class="time-wheel-fade" data-edge="bottom" aria-hidden="true" />

      <div
        ref="hoursEl"
        class="time-wheel-column"
        role="listbox"
        tabindex="0"
        :aria-label="t('picker.hour')"
        @scroll="onScroll('hour', $event)"
        @keydown="onKeydown('hour', $event)"
      >
        <button
          v-for="hour in HOURS"
          :key="hour"
          class="time-wheel-item"
          type="button"
          role="option"
          tabindex="-1"
          :data-hour="hour"
          :data-selected="hour === props.model.hour ? 'true' : 'false'"
          :aria-selected="hour === props.model.hour ? 'true' : 'false'"
          @click="
            () => {
              props.model.hour = hour;
              scrollToValue(hoursEl, hour);
            }
          "
        >
          <span class="time-wheel-value"
            >{{ hour }}<span class="time-wheel-unit">{{ t('picker.hourUnit') }}</span></span
          >
        </button>
      </div>

      <div
        ref="minutesEl"
        class="time-wheel-column"
        role="listbox"
        tabindex="0"
        :aria-label="t('picker.minute')"
        @scroll="onScroll('minute', $event)"
        @keydown="onKeydown('minute', $event)"
      >
        <button
          v-for="minute in MINUTES"
          :key="minute"
          class="time-wheel-item"
          type="button"
          role="option"
          tabindex="-1"
          :data-minute="minute"
          :data-selected="minute === props.model.minute ? 'true' : 'false'"
          :aria-selected="minute === props.model.minute ? 'true' : 'false'"
          @click="
            () => {
              props.model.minute = minute;
              scrollToValue(minutesEl, minute);
            }
          "
        >
          <span class="time-wheel-value"
            >{{ String(minute).padStart(2, '0')
            }}<span class="time-wheel-unit">{{ t('picker.minuteUnit') }}</span></span
          >
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* 与日期面板共用关闭按钮的位置规则。 */
.sheet-panel:has(> .time-wheel-sheet) {
  position: relative;
}

/* 关闭按钮的实验性定位依赖面板 .sheet-panel:has() 规则；两份内容各自声明一次，
   单独挂载组件时也有正确的样式。 */
.time-wheel-sheet {
  --wheel-item: 44px;
  --wheel-visible: 5;
  position: relative;
}

.time-wheel-sheet .picker-close {
  position: absolute;
  top: calc(var(--s4) - var(--s1));
  inset-inline-end: calc(var(--s4) - var(--s1));
  z-index: 3;
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
  .time-wheel-sheet .picker-close:hover {
    background: var(--f3);
  }
}

.time-wheel {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s2);
  height: calc(var(--wheel-item) * var(--wheel-visible));
  padding-inline: var(--s4);
  overflow: hidden;
}

/* 中线高亮：固定一条 44px 的浅色带，滚动的数字穿过它。 */
.time-wheel-highlight {
  position: absolute;
  inset-inline: var(--s4);
  top: 50%;
  height: var(--wheel-item);
  border-radius: var(--r-input);
  background: var(--f3);
  transform: translateY(-50%);
  pointer-events: none;
}

/* 上下渐隐：用面板底色压住边缘，滚轮看起来是「滚进/滚出」而不是被切断。 */
.time-wheel-fade {
  position: absolute;
  inset-inline: 0;
  z-index: 2;
  height: calc(var(--wheel-item) * 1.4);
  pointer-events: none;
}

.time-wheel-fade[data-edge='top'] {
  top: 0;
  background: linear-gradient(var(--screen), transparent);
}

.time-wheel-fade[data-edge='bottom'] {
  bottom: 0;
  background: linear-gradient(transparent, var(--screen));
}

.time-wheel-column {
  position: relative;
  z-index: 1;
  height: 100%;
  overflow-y: auto;
  padding-block: calc(var(--wheel-item) * 2);
  overscroll-behavior: contain;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
}

.time-wheel-column::-webkit-scrollbar {
  display: none;
}

.time-wheel-column:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: var(--r-input);
}

.time-wheel-item {
  display: flex;
  /* 竖直居中：选中行要和中间的高亮带对齐，baseline 对齐会整体偏上。 */
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 100%;
  height: var(--wheel-item);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: var(--fs-h3);
  line-height: 1;
  scroll-snap-align: center;
  cursor: pointer;
  transition: transform var(--motion-quick) var(--ease-spring);
}

/* 选中的一行放大、换成强调色；只动 transform，不触发布局。 */
.time-wheel-item[data-selected='true'] {
  color: var(--accent-ink);
  font-weight: 700;
  transform: scale(1.08);
}

.time-wheel-value {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  line-height: 1;
}

.time-wheel-unit {
  font-size: var(--fs-meta);
  font-weight: 400;
}

@media (prefers-reduced-motion: reduce) {
  .time-wheel-item {
    transition: none;
  }
}
</style>
