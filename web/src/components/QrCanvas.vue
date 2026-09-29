<script setup lang="ts">
/**
 * 二维码画布：报名码与验证器绑定都用它。
 *
 * 高对比是硬要求 —— 白底黑点、深色模式下**不**跟随主题反色，否则相机扫不出来。
 * 组件加载失败或内容画不出来时抛出 `error` 事件由页面就近说明，不抛异常：
 * 拿不到二维码不该让整页挂掉。
 */
import { onMounted, ref, watch } from 'vue';
import { loadQrEncoder } from '@/services/vendor';
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
    await loadQrEncoder();
    if (!draw(node, props.text, props.quiet)) emit('error', t('s_3rgb49'));
  } catch (reason) {
    emit('error', reason instanceof Error ? reason.message : String(reason));
  }
}

/** 真正落笔；返回是否画成功。 */
function draw(node: HTMLCanvasElement, text: string, quiet: number): boolean {
  const generator = (window as { qrcode?: (type: number, level: string) => QrModel }).qrcode;
  if (typeof generator !== 'function') return false;
  let model: QrModel;
  try {
    // 0 表示按内容自动选择版本，M 级纠错在屏幕与打印下都够用。
    model = generator(0, 'M');
    model.addData(String(text || ''));
    model.make();
  } catch {
    return false;
  }
  const context = node.getContext('2d');
  if (!context) return false;
  const modules = model.getModuleCount();
  const scale = node.width / (modules + quiet * 2);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, node.width, node.height);
  context.fillStyle = '#20252b';
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!model.isDark(row, column)) continue;
      context.fillRect(
        Math.round((column + quiet) * scale),
        Math.round((row + quiet) * scale),
        Math.ceil(scale),
        Math.ceil(scale),
      );
    }
  }
  return true;
}

interface QrModel {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, column: number): boolean;
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
