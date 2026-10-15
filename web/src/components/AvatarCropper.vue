<script setup lang="ts">
/**
 * 圆形头像裁剪面板：单指拖动平移、双指捏合缩放，确认后导出方形 JPEG。
 *
 * 为什么单独成一个组件而不是走 `services/sheet`：那个面板是「一句话 + 按钮」，
 * 这里要放画布和手势，塞进去会让全局服务承担渲染细节。
 *
 * 为什么导出交给 canvas 而不是对 DOM 截图：取景框是圆的、存下来的是外接方图，
 * 各端展示时再裁圆；截图会带上圆角描边和设备像素比，拿不到干净的方图。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { t } from '@/i18n';

const props = withDefaults(defineProps<{ source: string; mime?: string }>(), {
  mime: 'image/jpeg',
});

const emit = defineEmits<{
  done: [dataUrl: string];
  close: [];
  error: [message: string];
}>();

/** 裁剪框边长：正方形取景框的内切圆就是圆形头像。 */
const STAGE_SIZE = 248;
/** 导出画布边长：头像在界面上最大显示 96px，512 足够覆盖 5 倍密度屏。 */
const CROP_OUTPUT_SIZE = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** 滚轮一格约等于捏合 12%：桌面没有第二根手指，用它替代捏合。 */
const WHEEL_STEP = 0.12;
/** 退场时长，与 motion.css 的 drawer-down / fade-out 对齐。 */
const LEAVE_MS = 220;

const state = reactive({
  x: 0,
  y: 0,
  zoom: 1,
  base: 1,
  width: 0,
  height: 0,
  ready: false,
});

/**
 * 裁剪框的实测边长。
 *
 * `.crop-stage` 在 tokens.css 里只有形状没有尺寸，这里用实测值参与取景换算：
 * 容器被主题或父级改过尺寸时，裁剪结果不会跟着偏。
 */
let stageEdge = STAGE_SIZE;

const panelEl = ref<HTMLElement>();
const stageEl = ref<HTMLElement>();
const imageEl = ref<HTMLImageElement>();

const hint = ref(t('media.cropHint'));
const hintTone = ref('');
const closing = ref(false);

const stageStyle = { width: `${STAGE_SIZE}px`, height: `${STAGE_SIZE}px` };

/** 图片的最终比例：基准比例（铺满裁剪框）叠加用户缩放。 */
const imageScale = computed(() => state.base * state.zoom);
const zoomLabel = computed(() => `${state.zoom.toFixed(1)}×`);
const imageStyle = computed(() => {
  // 加载完成前不写宽高：让图片先按自身尺寸落在取景框里，避免闪一帧 0 尺寸。
  if (!state.ready) return {};
  const width = state.width * imageScale.value;
  const height = state.height * imageScale.value;
  return {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(-50%, -50%) translate3d(${state.x}px, ${state.y}px, 0)`,
  };
});

/**
 * 夹紧平移量，并让视图跟上。
 *
 * master 在这里直接写 DOM 样式，Vue 里 `:style` 跟着 state 走，
 * 所以「落笔」这一步省了，只保留数值修正。
 */
function paint(): void {
  if (!state.ready) return;
  const displayWidth = state.width * imageScale.value;
  const displayHeight = state.height * imageScale.value;
  // 图片不能露出裁剪框：平移量按图片与裁剪框的尺寸差夹紧。
  const maxX = Math.max(0, (displayWidth - stageEdge) / 2);
  const maxY = Math.max(0, (displayHeight - stageEdge) / 2);
  state.x = Math.min(maxX, Math.max(-maxX, state.x));
  state.y = Math.min(maxY, Math.max(-maxY, state.y));
}

function onImageLoad(): void {
  const image = imageEl.value;
  if (!image) return;
  stageEdge = stageEl.value?.clientWidth || STAGE_SIZE;
  state.width = image.naturalWidth || stageEdge;
  state.height = image.naturalHeight || stageEdge;
  // 基准比例让图片最短边刚好铺满裁剪框，之后叠加用户的 1×–4× 缩放。
  state.base = Math.max(stageEdge / state.width, stageEdge / state.height);
  // 换一张图就回到居中 1×：沿用上一张的位移会让人以为图片串了。
  state.x = 0;
  state.y = 0;
  state.zoom = 1;
  state.ready = true;
  hint.value = t('media.cropHint');
  hintTone.value = '';
  paint();
}

function onImageError(): void {
  // 解码失败时 `ready` 保持 false，手势本身就不会响应，这里只需要把提示换成失败文案。
  hint.value = t('media.imageLoadFailed');
  hintTone.value = 'error';
}

// ── 手势：单指拖动、双指捏合 ──────────────────────────────────────
// 用 Pointer Events 统一触摸与鼠标：按下时记录全部活动触点，两个触点同时按下
// 进入捏合模式，缩放比例取两指间距之比。

/** 绑定手势，返回解绑函数：监听器手动挂是为了补齐 `wheel` 的非 passive 选项。 */
function bindGestures(): () => void {
  const stage = stageEl.value;
  if (!stage) return () => undefined;

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance = 0;
  // 捏合锚点：手势开始时两指中点（相对裁剪框中心）与当时的平移量、缩放。
  let pinchFocal = { x: 0, y: 0 };
  let pinchStartX = 0;
  let pinchStartY = 0;
  let pinchStartZoom = 1;
  let dragStartX = 0;
  let dragStartY = 0;
  let originX = 0;
  let originY = 0;

  const distance = (): number => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /** 两指中点在元素坐标系里的位置，用于把缩放锚在手指下方。 */
  const focal = (): { x: number; y: number } => {
    const rect = stage.getBoundingClientRect();
    const [a, b] = [...pointers.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return {
      x: (a.x + b.x) / 2 - rect.left - rect.width / 2,
      y: (a.y + b.y) / 2 - rect.top - rect.height / 2,
    };
  };

  const beginDrag = (x: number, y: number): void => {
    dragStartX = x;
    dragStartY = y;
    originX = state.x;
    originY = state.y;
    stage.dataset.dragging = 'true';
  };

  const onDown = (event: PointerEvent): void => {
    if (!state.ready) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 捕获指针：手指滑出裁剪框后仍能收到 move / up，拖到边缘不会「掉」。
    stage.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      beginDrag(event.clientX, event.clientY);
      return;
    }
    if (pointers.size === 2) {
      // 第二根手指落下时切换到捏合：记录基准间距、锚点与当时的缩放。
      pinchStartDistance = distance();
      pinchStartZoom = state.zoom;
      pinchStartX = state.x;
      pinchStartY = state.y;
      pinchFocal = focal();
      stage.dataset.pinching = 'true';
    }
  };

  const onMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      if (pinchStartDistance <= 0) {
        pinchStartDistance = distance();
        pinchStartZoom = state.zoom;
        pinchStartX = state.x;
        pinchStartY = state.y;
        pinchFocal = focal();
        return;
      }
      const ratio = distance() / pinchStartDistance;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * ratio));
      // 手指下的那一点保持不动：按缩放比把锚点相对平移量一起放大。
      // 不这么做的话，放大时画面会朝图片中心跑，手指下面的细节会滑走。
      const grow = next / pinchStartZoom;
      state.zoom = next;
      state.x = pinchFocal.x - (pinchFocal.x - pinchStartX) * grow;
      state.y = pinchFocal.y - (pinchFocal.y - pinchStartY) * grow;
      paint();
      return;
    }

    state.x = originX + (event.clientX - dragStartX);
    state.y = originY + (event.clientY - dragStartY);
    paint();
  };

  const onUp = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size >= 2) return;
    stage.dataset.pinching = 'false';
    pinchStartDistance = 0;
    if (pointers.size === 1) {
      // 松开一根手指后，剩下那根继续接管拖动，避免画面「粘住」。
      // 基准点取**剩下那根手指**的当前位置：用抬起手指的坐标会让下一次 move 跳一下。
      const [remaining] = [...pointers.values()];
      if (remaining) beginDrag(remaining.x, remaining.y);
      return;
    }
    stage.dataset.dragging = 'false';
  };

  // 桌面或鼠标环境没有第二根手指，用滚轮作为捏合的等价操作。
  // 缩放锚在光标位置：鼠标指着哪一块，滚轮就在那一块周围放大缩小。
  const onWheel = (event: WheelEvent): void => {
    if (!state.ready) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const focal = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom + (event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)));
    const grow = next / state.zoom;
    state.x = focal.x - (focal.x - state.x) * grow;
    state.y = focal.y - (focal.y - state.y) * grow;
    state.zoom = next;
    paint();
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  // wheel 必须非 passive：默认的 passive 监听里 preventDefault 会被忽略，页面会跟着一起滚。
  stage.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    stage.removeEventListener('wheel', onWheel);
  };
}

let unbindGestures: (() => void) | undefined;
let closeTimer: number | undefined;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') requestClose();
}

/** 关闭：先播退场（`data-closing`），动画结束再让页面卸载组件。 */
function requestClose(): void {
  if (closing.value) return;
  closing.value = true;
  closeTimer = window.setTimeout(
    () => {
      closeTimer = undefined;
      emit('close');
    },
    prefersReducedMotion() ? 0 : LEAVE_MS,
  );
}

/**
 * 导出 512×512 方图。
 *
 * 白底是必须的：JPEG 没有透明通道，不铺白底的话透明像素会变成黑块。
 * 取景换算分两步 —— 先把平移量与缩放反算成原图坐标，再把裁剪框边长换算回原图像素。
 */
function exportCrop(): string {
  const image = imageEl.value;
  if (!image) throw new Error(t('media.imageStillLoading'));
  const scale = imageScale.value;
  const sourceSize = stageEdge / scale;
  const left = stageEdge / 2 + state.x - (state.width * scale) / 2;
  const top = stageEdge / 2 + state.y - (state.height * scale) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = CROP_OUTPUT_SIZE;
  canvas.height = CROP_OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('media.avatarSaveFailed'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
  context.drawImage(
    image,
    -left / scale,
    -top / scale,
    sourceSize,
    sourceSize,
    0,
    0,
    CROP_OUTPUT_SIZE,
    CROP_OUTPUT_SIZE,
  );
  const mime = props.mime === 'image/png' || props.mime === 'image/webp' ? props.mime : 'image/jpeg';
  return canvas.toDataURL(mime, 0.9);
}

function confirm(): void {
  if (!state.ready) {
    // 没有解码完的像素就没有可导出的图：这里只报告，不关闭，用户还能等图出来再确认。
    emit('error', t('media.imageStillLoading'));
    return;
  }
  let dataUrl = '';
  try {
    dataUrl = exportCrop();
  } catch (reason) {
    emit('error', reason instanceof Error ? reason.message : String(reason));
    return;
  }
  // 先交付结果再退场：页面拿到 dataUrl 就能落盘，退场动画期间不影响写入。
  emit('done', dataUrl);
  requestClose();
}

onMounted(() => {
  unbindGestures = bindGestures();
  document.addEventListener('keydown', onKeydown);
  // 图片是 data URL，缓存命中时 load 可能在挂载前就结束了，这里补一次初始化。
  const image = imageEl.value;
  if (image?.complete && image.naturalWidth > 0) onImageLoad();
  // 面板打开后把焦点交给里面的按钮：Esc 与 Tab 才有落点（与 AppSheet 一致）。
  void nextTick(() => panelEl.value?.querySelector<HTMLElement>('button')?.focus());
});

onBeforeUnmount(() => {
  unbindGestures?.();
  unbindGestures = undefined;
  document.removeEventListener('keydown', onKeydown);
  if (closeTimer !== undefined) window.clearTimeout(closeTimer);
  closeTimer = undefined;
});
</script>

<template>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    :data-closing="closing ? 'true' : 'false'"
    @click.self="requestClose"
  >
    <div ref="panelEl" class="sheet-panel">
      <h2 class="sheet-title">{{ t('media.cropAvatar') }}</h2>
      <!-- 圆形取景框由 tokens.css 的 .crop-stage 圆角给出；手势绑在框上而不是图片上 -->
      <div class="crop-wrap">
        <div ref="stageEl" class="crop-stage" :style="stageStyle">
          <img
            ref="imageEl"
            class="crop-image"
            :src="props.source"
            :style="imageStyle"
            alt=""
            @load="onImageLoad"
            @error="onImageError"
          />
        </div>
      </div>
      <div class="row" data-between="true">
        <span class="field-hint">{{ t('media.pinchZoom') }}</span>
        <span class="crop-scale">{{ zoomLabel }}</span>
      </div>
      <p class="field-hint" :data-tone="hintTone || undefined">{{ hint }}</p>
      <div class="sheet-actions">
        <button class="cta ghost" type="button" @click="requestClose">{{ t('common.cancel') }}</button>
        <button class="cta" type="button" @click="confirm">{{ t('media.usePhoto') }}</button>
      </div>
    </div>
  </div>
</template>
