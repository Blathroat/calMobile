<script setup lang="ts">
/** 全局底部面板：渲染 `services/sheet.ts` 的状态，支持 Esc 与点击遮罩关闭。 */
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { closeSheet, sheet } from '@/services/sheet';

function run(action: { onClick?: (close: () => void) => void | Promise<void> }): void {
  void action.onClick?.(closeSheet);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeSheet();
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

// 打开时把焦点交给面板里的第一个可操作元素，键盘与读屏软件因此能接着走。
watch(() => sheet.current, (current) => {
  if (!current) return;
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>('.sheet-panel textarea, .sheet-panel input, .sheet-panel button');
    target?.focus();
  });
});
</script>

<template>
  <div
    v-if="sheet.current"
    class="sheet"
    role="dialog"
    aria-modal="true"
    :data-closing="sheet.current.closing ? 'true' : 'false'"
    @click.self="closeSheet()"
  >
    <div class="sheet-panel" :data-size="sheet.current.size">
      <h2 v-if="sheet.current.title" class="sheet-title">{{ sheet.current.title }}</h2>
      <p v-if="sheet.current.message" class="muted">{{ sheet.current.message }}</p>
      <div v-if="sheet.current.actions.length > 0" class="sheet-actions">
        <button
          v-for="(action, index) in sheet.current.actions"
          :key="index"
          class="cta"
          :class="{ ghost: action.variant !== 'primary' && action.variant !== 'danger', danger: action.variant === 'danger' }"
          type="button"
          @click="run(action)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </div>
</template>
