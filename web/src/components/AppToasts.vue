<script setup lang="ts">
/** 轻提示容器：固定在外壳底部之上，`role="status"` 让读屏软件播报。 */
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
  max-width: min(88vw, 460px);
  padding: var(--s3) var(--s4);
  border-radius: var(--r-pill);
  background: var(--toast-bg);
  color: var(--on-dark);
  font-size: var(--fs-label);
  box-shadow: var(--shadow-float);
  animation: toast-in var(--motion-base) var(--ease) both;
}

.toast[data-tone='error'] {
  background: var(--toast-error);
}

.toast[data-tone='success'] {
  background: var(--toast-ok);
}
</style>
