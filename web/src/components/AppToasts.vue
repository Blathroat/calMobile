<script setup lang="ts">
/** 轻提示容器：固定在视口下方，`role="status"` 供读屏播报。 */
import { toasts } from '@/services/toast';
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <div
      v-for="item in toasts"
      :key="item.id"
      class="toast"
      :data-tone="item.tone"
      :data-leaving="item.leaving ? 'true' : 'false'"
    >
      {{ item.text }}
    </div>
  </div>
</template>

<style>
.toast-host {
  position: fixed;
  inset-inline: 0;
  bottom: calc(var(--s6) + var(--safe-bottom));
  z-index: 60;
  display: grid;
  justify-items: center;
  gap: var(--s2);
  pointer-events: none;
}

.toast {
  max-width: min(88vw, 420px);
  padding: 8px 14px;
  border: var(--hairline) solid var(--stroke-strong);
  border-radius: var(--r-card);
  background: var(--toast-bg);
  color: #ffffff;
  font-size: var(--fs-xs);
  font-weight: 500;
  box-shadow: var(--shadow-overlay);
}

.toast[data-tone='error'] {
  background: var(--toast-error);
  border-color: var(--danger-border);
  color: #ffffff;
}

.toast[data-tone='success'] {
  background: var(--toast-ok);
  border-color: var(--ok-border);
  color: #ffffff;
}
</style>
