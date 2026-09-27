/**
 * 底部面板（弹层）状态。
 *
 * 二次确认、拒绝理由、选择项这三类操作共用同一个面板：内容是一句话加一组按钮，
 * 所以状态放在服务里，由 `App.vue` 挂载的 `AppSheet` 统一渲染。
 * 需要表单或富内容的弹层请在页面内直接写 `.sheet` 结构，不要往这里塞任意节点。
 */
import { reactive, readonly } from 'vue';
import { t } from '@/i18n';

export interface SheetAction {
  label: string;
  variant?: 'primary' | 'ghost' | 'danger';
  onClick?: (close: () => void) => void | Promise<void>;
}

export interface SheetState {
  title: string;
  message: string;
  actions: SheetAction[];
  size: 'auto' | 'full';
  closing: boolean;
}

const state = reactive<{ current: SheetState | null }>({ current: null });

const LEAVE_MS = 220;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 打开面板：`content` 用一句话说明，`actions` 给出可选动作。 */
export function openSheet(options: {
  title?: string;
  message?: string;
  actions?: SheetAction[];
  size?: 'auto' | 'full';
}): void {
  state.current = {
    title: options.title ?? '',
    message: options.message ?? '',
    actions: options.actions ?? [],
    size: options.size ?? 'auto',
    closing: false,
  };
}

/** 关闭面板：先播放退场动画再移除，抽屉不会瞬间消失。 */
export function closeSheet(): void {
  const current = state.current;
  if (!current || current.closing) return;
  current.closing = true;
  window.setTimeout(() => {
    if (state.current === current) state.current = null;
  }, prefersReducedMotion() ? 0 : LEAVE_MS);
}

/** 二次确认：用于删除、撤销这类不可逆操作。 */
export function confirmSheet(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm?: () => void | Promise<void>;
}): void {
  openSheet({
    title: options.title,
    message: options.message,
    actions: [
      { label: options.cancelLabel ?? t('s_1589w37'), onClick: (close) => close() },
      {
        label: options.confirmLabel ?? t('s_kre8wf'),
        variant: options.tone === 'danger' ? 'danger' : 'primary',
        onClick: (close) => {
          close();
          void options.onConfirm?.();
        },
      },
    ],
  });
}

export const sheet = readonly(state);
