<script setup lang="ts">
/**
 * 图片或占位：`src` 为空时保留线框的斜线占位，不显示破图。
 *
 * 展会海报是竖版，但比例不一定正好 9:16：缩略图按图片真实比例在
 * **9:16（最瘦）～4:3 纵向（最宽）**之间自适应（见 `tokens.css` 的 `.thumb`：
 * 高度固定、宽度由 `aspect-ratio` 算出来，所以同一列表里卡片高度不变）；
 * 超出这个范围的图（横幅、超长图）按最接近的一端比例填满，必要时裁切。
 * 头像不用这里，走 `AvatarBox`。
 */
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{ src?: string; className?: string; alt?: string }>(), {
  src: '',
  className: 'thumb',
  alt: '',
});

/** 竖版海报的合法比例区间：9:16（最瘦）到 3:4（最宽，纵向的 4:3）。 */
const MIN_RATIO = 9 / 16;
const MAX_RATIO = 3 / 4;
const DEFAULT_RATIO = MIN_RATIO;

/** 当前海报的展示比例（宽 / 高）；还没取到真实尺寸时按 9:16 的占位槽位。 */
const ratio = ref(DEFAULT_RATIO);

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RATIO;
  return Math.min(Math.max(value, MIN_RATIO), MAX_RATIO);
}

/** 图片解码出真实尺寸后把比例收进合法区间：卡片高度由 CSS 的固定高度决定，只变宽度。 */
function onLoad(event: Event): void {
  const image = event.target as HTMLImageElement | null;
  if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  ratio.value = clampRatio(image.naturalWidth / image.naturalHeight);
}

/** 图片打不开时退回占位比例（`object-fit: cover` 会让占位框里显示斜线底图）。 */
function onError(): void {
  ratio.value = DEFAULT_RATIO;
}

/** 换图沿用同一个组件实例时要回到占位比例，避免沿用上一张海报的宽度。 */
watch(
  () => props.src,
  () => {
    ratio.value = DEFAULT_RATIO;
  },
);
</script>

<template>
  <span
    class="ph-img"
    :class="className"
    :style="src ? { aspectRatio: ratio } : undefined"
    :aria-hidden="src ? undefined : 'true'"
  >
    <img v-if="src" :src="src" :alt="alt" @load="onLoad" @error="onError" />
  </span>
</template>
