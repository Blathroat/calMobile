<script setup lang="ts">
/**
 * 底部导航：选中项由路由给出，指示条与图标弹跳都在 motion.css 里，
 * 这里只负责结构与可访问性（`aria-current="page"` 由 RouterLink 维护）。
 */
import { RouterLink } from 'vue-router';
import AppIcon from './AppIcon.vue';
import { preloadTab } from '@/app/preload';
import { t } from '@/i18n';
import type { TabItem } from '@/app/shell';

defineProps<{ items: TabItem[] }>();
</script>

<template>
  <nav class="tabbar" :aria-label="t('nav.tabBar')">
    <RouterLink v-for="item in items" :key="item.id" class="tab" :to="item.path" @pointerdown="preloadTab(item.id)">
      <AppIcon :name="item.icon" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style>
.tab {
  flex: 1 1 0;
  min-width: 0;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 4px var(--s1);
  border-radius: var(--r-input);
  text-decoration: none;
  color: var(--ink-3);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.tab svg {
  width: 19px;
  height: 19px;
}

.tab[aria-current='page'] {
  color: var(--accent-ink);
  background: transparent;
  font-weight: 600;
}
</style>
