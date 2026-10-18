/**
 * 下拉刷新。滚动容器是外壳的 `.app-body`，手势只挂一次；
 * 当前页面在 setup 里登记自己的刷新函数，离开时摘掉。
 *
 * 多层页面（展商后台里的会议列表）按注册顺序叠放，最上层的生效。
 * 刷新期间查询缓存忽略新鲜期，但页面上已有的内容不会被清掉。
 *
 * 指示圈只属于**手动下拉**：跟着手指滑出来，松手后才开始转、才发请求；
 * 就算接口马上回来，也要先滑到停留位置，再滑回去。
 * 只有真正的松手（`pointerup`）会发请求：手势被浏览器接管时收到的是 `pointercancel`，
 * 那只是取消，复位视觉即可，绝不刷新。
 *
 * **后台刷新不碰指示圈**：切底部导航的预取、返回旧页面时「缓存已画出、网络还在回来」，
 * 只会让登记页面的 `busy` 为真（汇到 `pullBusy`）。这不再滑入、不再转圈、也不改内容位移——
 * 否则每次切页面都会闪一下圈。页面自己的忙碌标记由页面自己表达。
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

/**
 * 登记页面的后台刷新状态：`busy` 为真（缓存已画出、网络还在回来），或手动下拉刷新还没结束。
 * 只作状态信号，**不驱动指示圈**——那是外壳的 `pullDragging` / `pullOffset` / `pullSpinning` /
 * `pullSettling` 的事（见文件头：后台刷新不显示指示圈）。
 */
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
/**
 * 触摸死区。点击按钮时手指总会跟着漂几像素；没过死区就当没有下拉——
 * 不设 `pullDragging`、位移保持 0，外壳的指示圈与内容位移都不会被点出来。
 * 轴判定仍走 SLOP=8：横滑要在死区内就能被区分开，才不会被误判成竖拉。
 */
const PULL_DEAD_ZONE = 16;
/**
 * 进入跟手的方向比例：纵向下拉要明显强于横向偏移才算竖拉。
 * 斜划日历（先竖后横）刚过死区时，纵向可能只比横向大一点点；
 * 要求 1.5 倍能把这一段挡在跟手之外，不至于先闪出一枚指示圈。
 */
const PULL_AXIS_RATIO = 1.5;
/** 与 motion.css 的页面过渡同长，滑入滑出才看得出。 */
const SLIDE_MS = 280;
/** 停在展开位置的最短时间，接口再快也要转完这一下。 */
const HOLD_MS = 280;

let generation = 0;
let holding = false;
let holdingEntry: Entry | undefined;
/** 本次手势已被页面自己的横滑处理器（首页日历的月切换）接管：外壳不再跟手。 */
let suppressed = false;

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
 * 登记当前页的刷新。`busy` 是页面自己的后台忙碌标记：只汇到 `pullBusy`，
 * 不滑入指示圈、不转圈（见文件头）。`enabled` 为假时手势落到下一层；没有下一层就不响应下拉。
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
          // 只同步状态：后台刷新不滑入、不转圈，指示圈留给手动下拉（见文件头）。
          pullBusy.value = value;
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
 * 把指示圈相关的状态全部归零，换页时由外壳调用。
 *
 * 换页之后上一页的手势与在途动画一律作废：`generation` 加一让滑入 / 滑出与 hold 循环
 * 手里的 token 失效，四个状态清掉，指示圈不会留在新页面上。参数不用，清的是模块级状态。
 */
export function resetPullVisual(): void {
  generation += 1;
  holding = false;
  holdingEntry = undefined;
  pullDragging.value = false;
  pullOffset.value = 0;
  pullSpinning.value = false;
  pullSettling.value = false;
}

/**
 * 手势被浏览器接管（`pointercancel`）时的收尾：复位视觉、作废在途动画，
 * 但**绝不发请求**——`pointercancel` 不是松手，刷新只能由 `pointerup` 触发。
 * 清的就是换页时 `resetPullVisual()` 清的那一组状态，直接复用；
 * 里面的 `generation += 1` 顺带让还在跑的 hold 循环 token 失效，动画不会再把状态改回去。
 */
function abortPull(): void {
  resetPullVisual();
}

/**
 * 页面自己的横滑处理器接管手势时调用（首页日历判定要横滑的那一刻）。
 *
 * 为什么用「宿主主动接管」而不是继续调 PULL_AXIS_RATIO：比例调高会一起误伤正常的
 * 竖直下拉（手指总会带一点横向偏移）；而宿主已经确定要横滑，这是确定性信号，
 * 外壳这次手势直接作废即可。同时复位视觉，让已经露出来的指示圈立刻消失。
 */
export function suppressPull(): void {
  suppressed = true;
  resetPullVisual();
}

/**
 * 把下拉手势绑到滚动容器上。
 * 先分清横滑和竖拉，横滑不 `preventDefault`，首页日历的左右滑动仍由页面自己处理。
 * 竖拉期间持续复核方向（见 `onMove`），请求在松手并越过阈值之后才发出。
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
    // 新手势从头开始：上一次被宿主接管的压制不再生效。
    suppressed = false;
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    // 宿主已经接管这次手势（横滑）：不跟手、不改位移，也不 preventDefault。
    if (suppressed) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === 'undecided') {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
      if (axis === 'h') {
        resetTracking();
        return;
      }
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      // 方向要持续复核：斜划（先竖后横）时前面判成竖拉，这里横向一追平就放弃这次下拉。
      // 复位但不 preventDefault，横滑交回页面自己的处理器（首页日历的月切换）。
      pullOffset.value = 0;
      pullDragging.value = false;
      resetTracking();
      return;
    }
    if (element.scrollTop > 0 || dy <= 0) {
      pullOffset.value = 0;
      pullDragging.value = false;
      return;
    }
    // 死区内的向下漂移不算下拉：状态与位移都不动，只有超过死区才照旧跟手。
    if (dy <= PULL_DEAD_ZONE) {
      pullOffset.value = 0;
      pullDragging.value = false;
      return;
    }
    // 纵向不够占优（刚过死区的斜划）也不跟手：门槛收紧，避免闪圈。
    if (dy <= Math.abs(dx) * PULL_AXIS_RATIO) {
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

  /**
   * 浏览器中途接管手势（原生滚动）发的是 pointercancel，不是松手：
   * 只复位、绝不刷新；刷新只能由真正的 pointerup 触发。
   */
  function onCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    resetTracking();
    abortPull();
  }

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove, { passive: false });
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancel);
  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
    generation += 1;
    holding = false;
    holdingEntry = undefined;
    pullDragging.value = false;
    pullSettling.value = false;
    pullSpinning.value = false;
    pullOffset.value = 0;
  };
}
