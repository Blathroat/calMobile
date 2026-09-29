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
