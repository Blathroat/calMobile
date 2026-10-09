<script setup lang="ts">
/**
 * 分段控件（newUI `.seg`）：选中滑块由一个元素滑到目标按钮。
 *
 * 首次定位不加过渡，避免滑块从左侧滑过来；切换时交给 motion.css 的
 * `.seg-indicator[data-animate="true"]`。
 */
import { onMounted, ref, watch } from 'vue';

export interface SegItem {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<{ items: SegItem[]; modelValue: string; label?: string; disabled?: boolean }>(), { label: '', disabled: false });
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const indicator = ref<HTMLElement>();
const buttons: HTMLElement[] = [];
let mounted = false;

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
  node.style.transform = `translate3d(${active.offsetLeft}px, 0, 0)`;
  mounted = true;
}

function select(value: string): void {
  if (String(value) === String(props.modelValue)) return;
  emit('update:modelValue', value);
}

watch(() => props.modelValue, () => position(true));
watch(() => props.items, () => requestAnimationFrame(() => position(false)));

// 挂载后才知道真实宽度，因此在下一帧再定位。
onMounted(() => requestAnimationFrame(() => position(false)));
</script>

<template>
  <div class="seg" role="group" :aria-label="props.label || undefined">
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
