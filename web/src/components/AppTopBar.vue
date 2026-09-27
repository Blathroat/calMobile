<script setup lang="ts">
/**
 * 顶栏：返回按钮 + 标题 + 页面级操作。
 * 高度由 tokens.css 的 `--topbar-h` 统一，有返回键与只有标题的页面因此对齐。
 */
import { useRouter } from 'vue-router';
import AppIcon from './AppIcon.vue';
import { t } from '@/i18n';

const props = withDefaults(defineProps<{
  title?: string;
  showBack?: boolean;
  /** 没有历史可退时（深链进入）回落到这个路由 */
  backTo?: string;
}>(), { title: '', showBack: false, backTo: '/home' });

const router = useRouter();

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.push(props.backTo);
}
</script>

<template>
  <header class="topbar">
    <button
      v-if="props.showBack"
      class="icon-button"
      type="button"
      :aria-label="t('s_omytgn')"
      :title="t('s_omytgn')"
      @click="goBack"
    >
      <AppIcon name="back" />
    </button>
    <span v-else class="topbar-side" aria-hidden="true" />
    <h1 class="topbar-title">{{ props.title }}</h1>
    <div class="topbar-side">
      <slot name="actions" />
    </div>
  </header>
</template>
