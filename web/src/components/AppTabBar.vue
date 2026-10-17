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
  <nav class="tabbar" :aria-label="t('nav.tabBar')">
    <RouterLink v-for="item in items" :key="item.id" class="tab" :to="item.path">
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
  gap: var(--s1);
  padding: var(--s1);
  border-radius: var(--r-chip);
  /* 底部导航是 RouterLink（`<a>`），浏览器默认给链接加下划线；
       选中线索只用 motion.css 的主题色指示条，不要文字下划线。 */
  text-decoration: none;
  color: var(--ink-3);
  font-size: var(--fs-tag);
  font-weight: 600;
  transition: color var(--motion-fast) var(--ease);
}

.tab svg {
  width: 20px;
  height: 20px;
}

.tab[aria-current='page'] {
  color: var(--accent-ink);
  font-weight: 700;
}
</style>
