/**
 * 底部面板（弹层）状态。
 *
 * 面板内容分两种：
 * - **一句话 + 一组按钮**（确认、选择项）：直接用 `title / message / actions`；
 * - **带输入框或列表的富内容**：传 `component` + `props`，由 `AppSheet` 渲染。
 *   面板组件只负责内容与取值，关闭与动作仍由这里统一管，三处重复的 `.sheet` 结构
 *   因此收回到一个组件里（核销手动输入、富文本粘贴都是这么接的）。
 *
 * `layout: 'stack'` 把按钮竖着排（选项多、文字长短不一时比并排更好读）。
 * `layout: 'list'` 把选项排成一列整行可点的行，`checked` 的那条右侧带对勾：
 * 用来表达「从一组互斥的值里选一个」（展会分类、调整权限），比一排胶囊更好扫。
 * `layout: 'close-below'` 把最后一颗按钮独占下一行并拉满宽度，用来放「关闭」。
 */
import { markRaw, reactive, shallowReadonly, type Component } from 'vue';
import { t } from '@/i18n';

export interface SheetAction {
  label: string;
  disabled?: boolean | (() => boolean);
  variant?: 'primary' | 'ghost' | 'danger';
  /** `layout: 'list'` 时标记当前选中项：右侧画一个对勾，文字加粗。 */
  checked?: boolean;
  onClick?: (close: () => void) => void | Promise<void>;
}

export interface SheetState {
  title: string;
  message: string;
  actions: SheetAction[];
  /** 自定义内容组件；与 `message` 二选一，通常只用其中一个 */
  component: Component | null;
  props: Record<string, unknown>;
  layout: 'row' | 'stack' | 'list' | 'close-below';
  size: 'auto' | 'full';
  closing: boolean;
  onClose?: () => void;
}

const state = reactive<{ current: SheetState | null }>({ current: null });

const LEAVE_MS = 220;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** 打开面板：`message` 是一句话说明，`component` 用于带输入框的富内容。 */
export function openSheet(options: {
  title?: string;
  message?: string;
  actions?: SheetAction[];
  component?: Component;
  props?: Record<string, unknown>;
  layout?: 'row' | 'stack' | 'list' | 'close-below';
  size?: 'auto' | 'full';
  onClose?: () => void;
}): void {
  state.current = {
    title: options.title ?? '',
    message: options.message ?? '',
    actions: options.actions ?? [],
    component: options.component ? markRaw(options.component) : null,
    props: options.props ?? {},
    layout: options.layout ?? 'row',
    size: options.size ?? 'auto',
    closing: false,
    onClose: options.onClose,
  };
}

/** 关闭面板：先播放退场动画再移除，抽屉不会瞬间消失。 */
export function closeSheet(): void {
  const current = state.current;
  if (!current || current.closing) return;
  current.closing = true;
  current.onClose?.();
  window.setTimeout(
    () => {
      if (state.current === current) state.current = null;
    },
    prefersReducedMotion() ? 0 : LEAVE_MS,
  );
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
      { label: options.cancelLabel ?? t('common.cancel'), onClick: (close) => close() },
      {
        label: options.confirmLabel ?? t('app.confirm'),
        variant: options.tone === 'danger' ? 'danger' : 'primary',
        onClick: (close) => {
          close();
          void options.onConfirm?.();
        },
      },
    ],
  });
}

/**
 * 对外只读的面板状态。
 *
 * **为什么是浅只读**：deep readonly 会让 AppSheet 用 v-bind 传下去的内容组件 props
 * 也变成只读代理，面板里的 v-model（手动输入报名码、粘贴 Markdown）于是只在控制台留一句
 * Set operation on key "code" failed: target is readonly，输入值悄悄丢掉，提交时报「请输入报名码」。
 * 这里只需要挡住「页面直接给 sheet.current 赋值」这一种误用，因此用 shallowReadonly：
 * 顶层仍只读，读到的 current / props / model 保持原样的响应式对象，面板能正常写回；
 * closing 这类嵌套字段的变化照旧能触发 AppSheet 重渲染，退场动画不受影响。
 */
export const sheet = shallowReadonly(state);
