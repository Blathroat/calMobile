<script setup lang="ts">
/**
 * 分段控件：选中滑块由一个元素滑到目标按钮。
 *
 * 首次定位不加过渡，避免滑块从左侧滑过来；切换时交给 motion.css 的
 * `.seg-indicator[data-animate="true"]`。
 *
 * 分段控件始终排成一行：空间不够时按钮等分宽度收缩，不换行、也不横向滚动，
 * 避免「滑动选择按钮」在窄屏被折成两行。滑块按按钮的 `offsetLeft / 宽度` 定位；
 * 容器尺寸变化（旋转、分屏、字体加载）用 ResizeObserver 重新量一次。
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

/** 滑块跟随选中按钮；按钮还没布局（隐藏、宽度为 0）时先藏起来。 */
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

// 挂载后才知道真实宽度，因此在下一帧再定位。
onMounted(() => {
  requestAnimationFrame(() => position(false));
  // 按钮宽度随容器变化：尺寸一变就重新量，让滑块贴住当前按钮。
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
/* 选中滑块：由脚本按按钮的 offsetLeft / offsetTop / 尺寸定位，换行后也能贴在正确那一行。 */
.seg-indicator {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 0;
  border-radius: var(--r-chip);
  background: var(--accent);
  box-shadow: var(--shadow-panel);
  pointer-events: none;
}

.seg-indicator[data-animate='true'] {
  transition:
    transform var(--motion-normal) var(--ease-out),
    width var(--motion-normal) var(--ease-out),
    height var(--motion-normal) var(--ease-out);
}

.seg-indicator[data-hidden='true'] {
  opacity: 0;
}
</style>
