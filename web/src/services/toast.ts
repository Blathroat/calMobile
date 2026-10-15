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

export const toasts = readonly(items);
