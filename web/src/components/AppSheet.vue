<script setup lang="ts">
/**
 * 全局底部面板：渲染 `services/sheet.ts` 的状态。
 *
 * 内容可以是「一句话 + 按钮」，也可以是一个自定义组件（`component` + `props`）——
 * 后者用于带输入框或列表的面板，页面不再各写一遍 `.sheet` 结构。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { closeSheet, sheet } from '@/services/sheet';

const panel = ref<HTMLElement | null>(null);
let restoreFocus: HTMLElement | null = null;

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function run(action: { onClick?: (close: () => void) => void | Promise<void> }): void {
  void action.onClick?.(closeSheet);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeSheet();
    return;
  }
  if (event.key !== 'Tab' || !sheet.current) return;
  const items = [...(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    panel.value?.focus();
  } else if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !panel.value?.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

// 打开时把焦点交给面板里的第一个可操作元素，键盘与读屏软件因此能接着走。
watch(
  () => sheet.current,
  (current, previous) => {
    if (current) {
      if (!previous) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        const target = panel.value?.querySelector<HTMLElement>(FOCUSABLE);
        (target ?? panel.value)?.focus();
      });
      return;
    }
    if (restoreFocus) requestAnimationFrame(() => restoreFocus?.isConnected && restoreFocus.focus());
    restoreFocus = null;
  },
);
</script>

<template>
  <div
    v-if="sheet.current"
    class="sheet"
    role="presentation"
    :data-closing="sheet.current.closing ? 'true' : 'false'"
    @click.self="closeSheet()"
  >
    <div
      ref="panel"
      class="sheet-panel"
      :data-size="sheet.current.size"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-labelledby="sheet.current.title ? 'sheet-title' : undefined"
      :aria-label="sheet.current.title || sheet.current.message"
    >
      <h2 v-if="sheet.current.title" id="sheet-title" class="sheet-title">{{ sheet.current.title }}</h2>
      <p v-if="sheet.current.message" class="muted">{{ sheet.current.message }}</p>
      <!-- custom content：面板组件自己管输入与校验，关闭仍走 closeSheet -->
      <component :is="sheet.current.component" v-if="sheet.current.component" v-bind="sheet.current.props" />
      <div v-if="sheet.current.actions.length > 0" class="sheet-actions" :data-layout="sheet.current.layout">
        <button
          v-for="(action, index) in sheet.current.actions"
          :key="index"
          class="cta"
          :class="{
            ghost: action.variant !== 'primary' && action.variant !== 'danger',
            danger: action.variant === 'danger',
          }"
          type="button"
          :disabled="typeof action.disabled === 'function' ? action.disabled() : action.disabled"
          @click="run(action)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </div>
</template>
