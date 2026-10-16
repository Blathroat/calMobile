<script setup lang="ts">
/**
 * 加载骨架：只在确实没有内容可显示时使用。
 * 页面已有数据时刷新只标记 `data-busy`，不清空旧内容（见 motion.css）。
 */
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 });
</script>

<template>
  <div class="skeleton" aria-hidden="true">
    <div v-for="row in rows" :key="row" class="skeleton-row" />
  </div>
</template>

<style>
.skeleton {
  display: grid;
  gap: var(--s3);
  padding: var(--s4);
}

.skeleton-row {
  height: 72px;
  border-radius: var(--r-card);
  background: linear-gradient(90deg, var(--f1) 25%, var(--f3) 37%, var(--f1) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
}
</style>
