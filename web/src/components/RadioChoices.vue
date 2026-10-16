<script setup lang="ts">
/**
 * 报名里的单选按钮。
 *
 * 所有选项都能在一行里单行显示时横排均分；有一项放不下就改成每项独占一行。
 * 独占一行仍放不下时，按钮本身换行增高（样式在 tokens.css）。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { choiceNeedsStack } from '@/services/choice-layout';

const props = defineProps<{
  name: string;
  options: string[];
  selected: string;
}>();

const emit = defineEmits<{
  select: [value: string];
}>();

const row = ref<HTMLElement | null>(null);
const stacked = ref(false);
let observer: ResizeObserver | undefined;
let canvas: HTMLCanvasElement | undefined;

function contentWidth(label: HTMLElement): number {
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return 0;
  const style = getComputedStyle(label);
  // 选中后字重变成 700，按更宽的那一档量，避免选中后才挤出格子。
  context.font = `700 ${style.fontSize} ${style.fontFamily}`;
  const copy = label.querySelector('.choice-copy');
  const text = (copy ?? label).textContent ?? '';
  const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const border = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
  return context.measureText(text).width + pad + border;
}

function measure(): void {
  const element = row.value;
  if (!element) return;
  const labels = [...element.querySelectorAll<HTMLElement>('.choice label')];
  const gap = Number.parseFloat(getComputedStyle(element).columnGap || getComputedStyle(element).gap) || 0;
  stacked.value = choiceNeedsStack(labels.map(contentWidth), element.clientWidth, gap);
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && row.value) {
    observer = new ResizeObserver(() => measure());
    observer.observe(row.value);
  }
});

onBeforeUnmount(() => observer?.disconnect());

watch(
  () => props.options.join('\u0000'),
  () => {
    void nextTick(measure);
  },
);
</script>

<template>
  <div ref="row" class="choice-row" :data-stack="stacked ? 'true' : 'false'">
    <span v-for="(option, index) in options" :key="option" class="choice">
      <input
        :id="`${name}-${index}`"
        type="radio"
        :name="name"
        :value="option"
        :checked="selected === option"
        @change="emit('select', option)"
      />
      <label :for="`${name}-${index}`"
        ><span class="choice-copy">{{ option }}</span></label
      >
    </span>
  </div>
</template>

<style>
.choice-row {
  display: flex;
  align-items: stretch;
  gap: var(--s2);
}

.choice-row > .choice {
  flex: 1 1 0;
  min-width: 0;
}

/* 有选项在一行里放不下时，每项独占一行。 */
.choice-row[data-stack='true'] {
  flex-direction: column;
}

.choice-row[data-stack='true'] > .choice {
  flex: none;
  width: 100%;
}

.choice {
  position: relative;
  min-width: 0;
}

.choice input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.choice label {
  min-height: var(--ctrl);
  height: auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--screen);
  color: var(--ink-2);
  font-size: var(--fs-label);
  line-height: 1.35;
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
  transition:
    border-color var(--motion-fast) var(--ease),
    background var(--motion-fast) var(--ease),
    color var(--motion-fast) var(--ease);
}

.choice-copy {
  min-width: 0;
  flex: 1 1 auto;
  overflow-wrap: anywhere;
  text-align: start;
}

.choice input:checked + label {
  border-color: var(--accent);
  background: var(--accent-glow, rgba(192, 86, 33, 0.14));
  color: var(--accent-ink);
  font-weight: 700;
}

.choice input:focus-visible + label {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
