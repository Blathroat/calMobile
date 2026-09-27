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
