<script setup lang="ts">
/**
 * 二维码画布：报名码与验证器绑定都用它。
 *
 * 高对比是硬要求 —— 白底黑点、深色模式下**不**跟随主题反色，否则相机扫不出来。
 * 组件加载失败或内容画不出来时抛出 `error` 事件由页面就近说明，不抛异常：
 * 拿不到二维码不该让整页挂掉。
 */
import { onMounted, ref, watch } from 'vue';
import { drawQr } from '@/services/qr-encoder';
import { t } from '@/i18n';
const props = withDefaults(defineProps<{ text: string; size?: number; quiet?: number; label?: string }>(), {
  size: 220,
  quiet: 4,
  label: '',
});

const emit = defineEmits<{ error: [string] }>();

const canvas = ref<HTMLCanvasElement>();

async function render(): Promise<void> {
  const node = canvas.value;
  if (!node || !props.text) return;
  try {
    if (!await drawQr(node, props.text, props.quiet)) emit('error', t('s_3rgb49'));
  } catch (reason) {
    emit('error', reason instanceof Error ? reason.message : String(reason));
  }
}

onMounted(render);
watch(() => props.text, render);
</script>

<template>
  <canvas
    ref="canvas"
    class="qr-canvas"
    :width="props.size"
    :height="props.size"
    :aria-label="props.label || undefined"
    role="img"
  />
</template>
