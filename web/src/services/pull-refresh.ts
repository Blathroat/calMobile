/**
 * 下拉刷新。滚动容器是外壳的 `.app-body`，手势只挂一次；
 * 当前页面在 setup 里登记自己的刷新函数，离开时摘掉。
 *
 * 多层页面（展商后台里的会议列表）按注册顺序叠放，最上层的生效。
 * 刷新期间查询缓存忽略新鲜期，但页面上已有的内容不会被清掉。
 *
 * 加载圈跟着下拉滑出来，松手后才开始转、才发请求。
 * 就算接口马上回来，也要先滑到停留位置，再滑回去。
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { withForcedReads } from '@/services/query-cache';

type Refresh = () => Promise<unknown>;

interface Entry {
  refresh: Refresh;
  busy?: Ref<boolean>;
  enabled?: Ref<boolean>;
  stop?: () => void;
}

const stack: Entry[] = [];

/** 页面正在用缓存等网络，或下拉刷新还没结束。 */
export const pullBusy = ref(false);
/** 手指正在下拉，内容跟手，不做过渡。 */
export const pullDragging = ref(false);
/** 松手后的滑入 / 滑出。 */
export const pullSettling = ref(false);
/** 内容下移的像素。0 表示不改 transform，好让页面切换动画继续用 transform。 */
export const pullOffset = ref(0);
/** 松手或自动刷新后才转。手指按着的时候不转。 */
export const pullSpinning = ref(false);

function activeEntry(): Entry | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    if (entry && (!entry.enabled || entry.enabled.value)) return entry;
  }
  return undefined;
}

function syncBusy(): void {
  pullBusy.value = activeEntry()?.busy?.value === true;
}

const TRIGGER = 56;
const MAX_PULL = 96;
const REST = 44;
const SLOP = 8;
/** 与 motion.css 的页面过渡同长，滑入滑出才看得出。 */
const SLIDE_MS = 280;
/** 停在展开位置的最短时间，接口再快也要转完这一下。 */
const HOLD_MS = 280;

let generation = 0;
let holding = false;
let holdingEntry: Entry | undefined;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wait(ms: number): Promise<void> {
  if (ms <= 0 || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 先打开过渡，等它画上一帧，再改位移。
 * 过渡属性和新 transform 若落在同一次绘制里，滑入滑出都不会播。
 */
async function animateOffset(next: number, token: number): Promise<void> {
  if (token !== generation) return;
  if (prefersReducedMotion()) {
    pullOffset.value = next;
    return;
  }
  pullSettling.value = true;
  await nextFrame();
  await nextFrame();
  if (token !== generation) return;
  pullOffset.value = next;
  await wait(SLIDE_MS);
}

function untilBusyClears(entry: Entry): Promise<void> {
  const busy = entry.busy;
  if (!busy?.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(busy, (value) => {
      if (value) return;
      stop();
      resolve();
    });
  });
}

/**
 * 滑到停留位置并转圈，等 `work` 结束（至少 HOLD_MS），再滑回去。
 * 新的手势或页面离开会把代数加一，这一轮就不再改位移。
 */
async function holdThenRelease(entry: Entry, work: () => Promise<unknown>): Promise<void> {
  const token = ++generation;
  holding = true;
  holdingEntry = entry;
  pullSpinning.value = true;
  const started = Date.now();
  try {
    await Promise.all([animateOffset(REST, token), work()]);
    if (token === generation) {
      // 滑入花掉的时间不算停留。接口比滑入更快时，仍在展开位置转完 HOLD_MS 再滑出。
      const elapsed = Date.now() - started;
      const slideAndHold = SLIDE_MS + HOLD_MS;
      if (elapsed < slideAndHold) await wait(slideAndHold - elapsed);
    }
  } finally {
    if (token === generation) {
      pullSpinning.value = false;
      await animateOffset(0, token);
      if (token === generation) {
        pullSettling.value = false;
        holding = false;
        if (holdingEntry === entry) holdingEntry = undefined;
        pullBusy.value = activeEntry()?.busy?.value === true;
      }
    }
  }
}

/**
 * 登记当前页的刷新。`busy` 为真时（缓存已画出、网络还没回来）外壳滑入同一枚指示。
 * `enabled` 为假时手势落到下一层；没有下一层就不响应下拉。
 */
export function usePullRefresh(refresh: Refresh, busy?: Ref<boolean>, enabled?: Ref<boolean>): void {
  const entry: Entry = { refresh, busy, enabled };
  const stops: Array<() => void> = [];
  stack.push(entry);
  if (busy) {
    stops.push(
      watch(
        busy,
        (value) => {
          if (activeEntry() !== entry) return;
          pullBusy.value = value;
          // 手指正在拉，或这一轮已经是松手后的刷新：不要再播一遍。
          if (!value || holding || pullDragging.value) return;
          void holdThenRelease(entry, () => untilBusyClears(entry));
        },
        { immediate: true },
      ),
    );
  }
  if (enabled) stops.push(watch(enabled, syncBusy));
  entry.stop = () => {
    for (const stop of stops) stop();
  };
  syncBusy();
  onScopeDispose(() => {
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    entry.stop?.();
    if (holdingEntry === entry) {
      generation += 1;
      holding = false;
      holdingEntry = undefined;
      pullSpinning.value = false;
      pullSettling.value = false;
      pullDragging.value = false;
      pullOffset.value = 0;
    }
    syncBusy();
  });
}

/** 当前有没有页面愿意刷新。没有时下拉不拦截滚动。 */
export function hasPullHandler(): boolean {
  return activeEntry() !== undefined;
}

/** 执行最上层的刷新，并在此期间强制绕过查询缓存的新鲜期。 */
export async function runRegisteredRefresh(): Promise<void> {
  const entry = activeEntry();
  if (!entry) return;
  pullBusy.value = true;
  try {
    await withForcedReads(() => entry.refresh());
  } finally {
    pullBusy.value = activeEntry()?.busy?.value === true;
  }
}

/**
 * 把下拉手势绑到滚动容器上。
 * 先分清横滑和竖拉，横滑不 `preventDefault`，首页日历的左右滑动仍由页面自己处理。
 * 请求在松手并越过阈值之后才发出。
 */
export function bindPullGesture(element: HTMLElement): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let axis: 'undecided' | 'v' | 'h' = 'undecided';

  function resetTracking(): void {
    pointerId = null;
    axis = 'undecided';
    pullDragging.value = false;
  }

  function onDown(event: PointerEvent): void {
    if (!hasPullHandler()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (element.scrollTop > 0) return;
    // 打断正在播的滑入滑出，改由手指接管位移。
    if (holding || pullSettling.value) {
      generation += 1;
      holding = false;
      holdingEntry = undefined;
      pullSpinning.value = false;
      pullSettling.value = false;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    axis = 'undecided';
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === 'undecided') {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
      if (axis === 'h') {
        resetTracking();
        return;
      }
    }
    if (element.scrollTop > 0 || dy <= 0) {
      pullOffset.value = 0;
      pullDragging.value = false;
      return;
    }
    pullDragging.value = true;
    pullSettling.value = false;
    pullOffset.value = Math.min(MAX_PULL, dy * 0.45);
    if (event.cancelable) event.preventDefault();
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const shouldRefresh = pullDragging.value && pullOffset.value >= TRIGGER;
    const entry = activeEntry();
    resetTracking();
    if (!shouldRefresh || !entry) {
      const token = ++generation;
      void animateOffset(0, token).then(() => {
        if (token === generation) pullSettling.value = false;
      });
      return;
    }
    void holdThenRelease(entry, () => runRegisteredRefresh());
  }

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove, { passive: false });
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onUp);
    generation += 1;
    holding = false;
    holdingEntry = undefined;
    pullDragging.value = false;
    pullSettling.value = false;
    pullSpinning.value = false;
    pullOffset.value = 0;
  };
}
