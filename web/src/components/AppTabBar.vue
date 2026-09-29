<script setup lang="ts">
/**
 * 底部导航：选中项由路由给出，指示条与图标弹跳都在 motion.css 里，
 * 这里只负责结构与可访问性（`aria-current="page"` 由 RouterLink 维护）。
 */
import { RouterLink } from 'vue-router';
import AppIcon from './AppIcon.vue';
import { t } from '@/i18n';
import type { TabItem } from '@/app/shell';

defineProps<{ items: TabItem[] }>();
</script>

<template>
  <nav class="tabbar" :aria-label="t('s_1fe4wn6')">
    <RouterLink v-for="item in items" :key="item.id" class="tab" :to="item.path">
      <AppIcon :name="item.icon" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>
