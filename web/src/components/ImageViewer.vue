<script setup lang="ts">
/**
 * 大图查看：点开封面后铺满屏幕，可双指缩放、放大后拖动、双击复位。
 *
 * 手势只依赖 Pointer Events（WebView 与浏览器一致）：两根手指按下时按两指间距缩放，
 * 缩放锚点取两指中点，手感是「图跟着手指走」，而不是围绕图片中心放大；
 * 单指在放大状态下是拖动。桌面预览（`pnpm dev` / 无头回归）补了滚轮缩放。
 *
 * 只负责显示与手势，关闭由调用方处理（`@close`）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import { t } from '@/i18n';

const COPY = {
  close: t('media.closeImage'),
  hint: t('media.viewerHint'),
};

const props = withDefaults(defineProps<{
  src: string;
  alt?: string;
}>(), {
  alt: '',
});

const emit = defineEmits<{ close: [] }>();

const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** 双击在这两档之间切换：一倍看全图，两倍看细节。 */
const DOUBLE_TAP_SCALE = 2;
const DOUBLE_TAP_MS = 300;

const stage = ref<HTMLElement>();
const scale = ref(1);
const offset = ref({ x: 0, y: 0 });

interface Point { x: number; y: number }

/** 进行中的指针：单指拖动用它，双指缩放用它的两条记录算间距与中点。 */
const pointers = new Map<number, Point>();
let pinchStartDistance = 0;
let pinchStartScale = 1;
let pinchStartCenter = { x: 0, y: 0 };
let pinchStartOffset = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 };
let lastTapAt = 0;

const imageStyle = computed(() => ({
  transform: `translate3d(${offset.value.x}px, ${offset.value.y}px, 0) scale(${scale.value})`,
}));

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 拖动范围：放大后可移动的距离是「溢出部分的一半」，图片不会被拖出屏幕。 */
function clampOffset(next: { x: number; y: number }): { x: number; y: number } {
  const box = stage.value?.getBoundingClientRect();
  if (!box) return next;
  const maxX = (box.width * (scale.value - 1)) / 2;
  const maxY = (box.height * (scale.value - 1)) / 2;
  return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
}

function reset(): void {
  scale.value = MIN_SCALE;
  offset.value = { x: 0, y: 0 };
}

/** 以某个屏幕点为锚点缩放到 `next`：锚点下的像素在缩放前后保持不动。 */
function zoomTo(next: number, anchor: { x: number; y: number }): void {
  const box = stage.value?.getBoundingClientRect();
  if (!box) return;
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const ratio = next / scale.value;
  const moved = {
    x: anchor.x - center.x - (anchor.x - center.x - offset.value.x) * ratio,
    y: anchor.y - center.y - (anchor.y - center.y - offset.value.y) * ratio,
  };
  scale.value = clamp(next, MIN_SCALE, MAX_SCALE);
  offset.value = scale.value === MIN_SCALE ? { x: 0, y: 0 } : clampOffset(moved);
}

/** 当前的两根手指；不足两根时返回 null，调用方据此跳过缩放计算。 */
function pair(): [Point, Point] | null {
  const values = [...pointers.values()];
  const first = values[0];
  const second = values[1];
  if (!first || !second) return null;
  return [first, second];
}

function distance(): number {
  const fingers = pair();
  if (!fingers) return 0;
  const [first, second] = fingers;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(): { x: number; y: number } {
  const fingers = pair();
  if (!fingers) return { x: 0, y: 0 };
  const [first, second] = fingers;
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function onPointerDown(event: PointerEvent): void {
  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size === 2) {
    pinchStartDistance = distance();
    pinchStartScale = scale.value;
    pinchStartCenter = midpoint();
    pinchStartOffset = { ...offset.value };
    return;
  }

  // 双击复位 / 放大：以双击点为中心。
  const now = Date.now();
  if (now - lastTapAt < DOUBLE_TAP_MS) {
    lastTapAt = 0;
    if (scale.value > MIN_SCALE) reset();
    else zoomTo(DOUBLE_TAP_SCALE, { x: event.clientX, y: event.clientY });
    return;
  }
  lastTapAt = now;
  panStart = { x: event.clientX, y: event.clientY };
  panStartOffset = { ...offset.value };
}

function onPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size >= 2 && pinchStartDistance > 0) {
    const next = clamp((pinchStartScale * distance()) / pinchStartDistance, MIN_SCALE, MAX_SCALE);
    const box = stage.value?.getBoundingClientRect();
    if (!box) return;
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const current = midpoint();
    const ratio = next / pinchStartScale;
    // 先按锚点缩放，再按两指中点相对起点的位移平移，缩放过程中图片跟着手走。
    const moved = {
      x: current.x - center.x - (pinchStartCenter.x - center.x - pinchStartOffset.x) * ratio,
      y: current.y - center.y - (pinchStartCenter.y - center.y - pinchStartOffset.y) * ratio,
    };
    scale.value = next;
    offset.value = clampOffset(moved);
    return;
  }

  if (pointers.size === 1 && scale.value > MIN_SCALE) {
    offset.value = clampOffset({
      x: panStartOffset.x + (event.clientX - panStart.x),
      y: panStartOffset.y + (event.clientY - panStart.y),
    });
  }
}

function onPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStartDistance = 0;
  if (pointers.size === 1) {
    // 从双指缩放回到单指时，用剩下那根手指重新起手拖动，避免图片跳一下。
    const remaining = [...pointers.values()][0];
    if (remaining) {
      panStart = { x: remaining.x, y: remaining.y };
      panStartOffset = { ...offset.value };
    }
  }
  if (scale.value <= MIN_SCALE) reset();
}

/** 桌面滚轮缩放：无头回归与浏览器预览里没有双指，用滚轮覆盖同一条缩放路径。 */
function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const step = event.deltaY > 0 ? -0.25 : 0.25;
  zoomTo(scale.value + step, { x: event.clientX, y: event.clientY });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

/** 打开期间锁住页面滚动，背景不会跟着手势一起动。 */
onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.body.style.overflow = 'hidden';
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div
      class="viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="props.alt || COPY.close"
      @click.self="emit('close')"
    >
      <div
        ref="stage"
        class="viewer-stage"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
      >
        <img class="viewer-image" :src="props.src" :alt="props.alt" :style="imageStyle" draggable="false" />
      </div>
      <button class="viewer-close" type="button" :aria-label="COPY.close" @click="emit('close')">
        <AppIcon name="close" />
      </button>
      <p class="viewer-hint">{{ COPY.hint }}</p>
    </div>
  </Teleport>
</template>
