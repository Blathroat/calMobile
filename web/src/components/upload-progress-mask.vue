<script setup lang="ts">
/**
 * 上传进度遮罩：盖在图片 / 封面显示位置上方，由下至上按百分比逐渐变亮，并显示数字。
 *
 * 绝对定位填满父容器，父容器自己保持 `position: relative`（封面槽位由 `.ph-img` 提供，
 * 富文本占位由 `.media-tile` 提供）。上传结束由调用方卸载；成功时把 `progress` 置 100 后
 * **不要立刻清空**：组件会让 100% 至少停留 `HOLD_MS` 再发 `settled`，调用方收到后才卸载，
 * 避免上传很快时遮罩一闪而过。失败 / 取消直接清空状态即可，遮罩随父级卸载。
 */
import { computed, onBeforeUnmount, watch } from 'vue';
import { t } from '@/i18n';

/** 100% 的停留时间：够看清一次，又不会让上传完成后的按钮像卡住。 */
const HOLD_MS = 150;

const props = defineProps<{
  /** 上传百分比 0–100；null 表示刚起步、还没收到进度。 */
  progress: number | null;
}>();

const emit = defineEmits<{ settled: [] }>();

/** 显示用整数百分比：四舍五入并夹到 0–100，避免浮点进度让文案与遮罩逐帧抖动。 */
const percent = computed(() => {
  const value = Number(props.progress);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
});

/** 暗色遮罩从顶部盖到 `100 - percent` 处，剩下的部分透出图片（越到底部越亮）。 */
const scrimHeight = computed(() => `${100 - percent.value}%`);

/**
 * 0%（刚起步）用整块实色：底边那 14px 过渡段在整块暗色里会漏出一条亮边，
 * 看起来像已经上传了一点。有进度之后才换成带过渡的渐变。
 */
const scrimStyle = computed(() =>
  percent.value === 0 ? { height: '100%', background: 'var(--media-scrim)' } : { height: scrimHeight.value },
);

/** 无障碍进度文本：只在整数变化时更新，`aria-live="polite"` 不会逐帧播报。 */
const label = computed(() => t('media.uploadingPercent', { percent: percent.value }));

let holdTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  percent,
  (value) => {
    // 新一轮上传从 0 起步时，上一轮残留的 100% 停留计时器必须作废，
    // 否则它会在新上传途中发 settled，把正在显示的遮罩提前收掉。
    if (value < 100) {
      cancelHold();
      return;
    }
    if (holdTimer !== undefined) return;
    holdTimer = setTimeout(() => {
      holdTimer = undefined;
      emit('settled');
    }, HOLD_MS);
  },
  { immediate: true },
);

function cancelHold(): void {
  if (holdTimer === undefined) return;
  clearTimeout(holdTimer);
  holdTimer = undefined;
}

onBeforeUnmount(cancelHold);
</script>

<template>
  <div
    class="upload-progress-mask"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent"
    :aria-valuetext="label"
  >
    <span class="upload-progress-scrim" :style="scrimStyle" aria-hidden="true" />
    <span class="upload-progress-value" aria-hidden="true">{{ percent }}%</span>
    <span class="sr-only" aria-live="polite">{{ label }}</span>
  </div>
</template>

<style>
/* 上传进度遮罩：父容器负责 position: relative。遮罩只是视觉反馈，不吃点击。 */
.upload-progress-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}

/* 暗色遮罩从顶部盖下来，底边用一小段渐变过渡，所以读起来是「由下至上变亮」而不是一条硬边。 */
.upload-progress-scrim {
  position: absolute;
  inset-inline: 0;
  top: 0;
  background: linear-gradient(to bottom, var(--media-scrim) calc(100% - 14px), transparent);
  transition: height var(--motion-fast) linear;
}

/* 百分比数字：白字 + 阴影，压在任何亮度和图片上都能读。 */
.upload-progress-value {
  position: relative;
  z-index: 1;
  color: #fff;
  font-size: var(--fs-h3);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.72);
}

@media (prefers-reduced-motion: reduce) {
  .upload-progress-scrim {
    transition: none;
  }
}
</style>
