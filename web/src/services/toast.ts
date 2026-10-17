/**
 * 轻提示队列。
 *
 * 只作为附加反馈：页面内的原位状态说明必须同时保留（docs/engineering.md）。
 * 队列放在这里而不是组件里，页面不需要各自挂载提示容器。
 */
import { reactive, readonly } from 'vue';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
  leaving: boolean;
}

const items = reactive<ToastItem[]>([]);
let sequence = 0;

const VISIBLE_MS = 2400;
const LEAVE_MS = 200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** 弹出一条提示；空白文案直接忽略，避免出现空心气泡。 */
export function toast(message: unknown, tone: ToastTone = 'neutral'): void {
  const text = String(message ?? '').trim();
  if (!text) return;
  const item = reactive<ToastItem>({ id: ++sequence, text, tone, leaving: false });
  items.push(item);
  // 退场动画结束后再移除，避免提示突然消失。
  window.setTimeout(() => {
    item.leaving = true;
    window.setTimeout(
      () => {
        const index = items.findIndex((entry) => entry.id === item.id);
        if (index >= 0) items.splice(index, 1);
      },
      prefersReducedMotion() ? 0 : LEAVE_MS,
    );
  }, VISIBLE_MS);
}

/** 重载前排队的那一条提示。`sessionStorage` 跨重载保留，关掉标签页即失效。 */
const DEFERRED_KEY = 'calmobile.toast.pending';

function isTone(value: unknown): value is ToastTone {
  return value === 'neutral' || value === 'success' || value === 'error';
}

/**
 * 排队一条「重载之后再弹」的提示。
 *
 * 场景：切换语言 / 安装语言包会整页重载，当场 `toast()` 弹出来的气泡会被重载冲掉。
 * 文案存进 `sessionStorage`，重载后由外壳调用 `flushDeferredToast()` 取出来弹。
 * 只留最近排队的一条；存储不可用时静默放弃——它只是附加反馈，不该让主流程失败。
 */
export function toastAfterReload(message: unknown, tone: ToastTone = 'neutral'): void {
  const text = String(message ?? '').trim();
  if (!text) return;
  try {
    window.sessionStorage.setItem(DEFERRED_KEY, JSON.stringify({ text, tone }));
  } catch {
    // 隐私模式或配额满：放弃这条附加反馈，重载照常。
  }
}

/**
 * 取出重载前排队的提示并弹一次。外壳在挂载时调用（两份构建共用外壳）。
 * 取到就删，所以同一条最多弹一次；存储不可用或内容解析不了时静默返回。
 */
export function flushDeferredToast(): void {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(DEFERRED_KEY);
    if (raw !== null) window.sessionStorage.removeItem(DEFERRED_KEY);
  } catch {
    // 读不到存储就当没有排队的提示。
    return;
  }
  if (!raw) return;
  try {
    const stored = JSON.parse(raw) as { text?: unknown; tone?: unknown };
    const text = String(stored.text ?? '').trim();
    if (!text) return;
    toast(text, isTone(stored.tone) ? stored.tone : 'neutral');
  } catch {
    // 不是本模块写的内容（或被写坏），丢掉即可。
  }
}

export const toasts = readonly(items);
