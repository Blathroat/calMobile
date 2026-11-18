<script setup lang="ts">
/**
 * 分段控件：滑块在轨道内平滑移动，外框 8px 与内项 6px 严格保持 2px 间距同心圆关系。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface SegItem {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{ items: SegItem[]; modelValue: string; label?: string; disabled?: boolean }>(),
  { label: '', disabled: false },
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const indicator = ref<HTMLElement>();
const container = ref<HTMLElement>();
const buttons: HTMLElement[] = [];
let mounted = false;
let resizeObserver: ResizeObserver | undefined;

function setButton(element: Element | null, index: number): void {
  if (element instanceof HTMLElement) buttons[index] = element;
}

function position(animate: boolean): void {
  const node = indicator.value;
  if (!node) return;
  const active = buttons.find((button) => button?.dataset.value === String(props.modelValue));
  if (!active || active.offsetWidth === 0) {
    node.dataset.hidden = 'true';
    return;
  }
  node.dataset.hidden = 'false';
  node.dataset.animate = animate && mounted ? 'true' : 'false';
  node.style.width = `${active.offsetWidth}px`;
  node.style.height = `${active.offsetHeight}px`;
  node.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
  mounted = true;
}

function select(value: string): void {
  if (String(value) === String(props.modelValue)) return;
  emit('update:modelValue', value);
}

watch(
  () => props.modelValue,
  () => position(true),
);
watch(
  () => props.items,
  () => requestAnimationFrame(() => position(false)),
);

onMounted(() => {
  requestAnimationFrame(() => position(false));
  if (typeof ResizeObserver !== 'undefined' && container.value) {
    resizeObserver = new ResizeObserver(() => position(false));
    resizeObserver.observe(container.value);
  }
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <div ref="container" class="seg" role="group" :aria-label="props.label || undefined">
    <span ref="indicator" class="seg-indicator" aria-hidden="true" />
    <button
      v-for="(item, index) in props.items"
      :key="item.value"
      :ref="(element) => setButton(element as Element | null, index)"
      type="button"
      :data-value="item.value"
      :aria-pressed="String(item.value) === String(props.modelValue) ? 'true' : 'false'"
      :disabled="props.disabled || item.disabled === true"
      @click="select(item.value)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style>
.seg-indicator {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 0;
  border: var(--hairline) solid var(--stroke-strong);
  border-radius: var(--r-input);
  background-color: var(--seg-active-bg);
  pointer-events: none;
}

.seg-indicator[data-animate='true'] {
  transition:
    transform var(--motion-base) var(--ease),
    width var(--motion-base) var(--ease),
    height var(--motion-base) var(--ease);
}

.seg-indicator[data-hidden='true'] {
  opacity: 0;
}
</style>
