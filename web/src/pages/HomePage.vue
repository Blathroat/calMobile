<script setup lang="ts">
import { t } from '@/i18n';
</script>

<template>
  <section class="migration-home" aria-labelledby="migration-title">
    <p class="eyebrow">calMobile</p>
    <h1 id="migration-title">{{ t('s_1ow5v10', '首页') }}</h1>
    <p>Vue 3 + TypeScript 前端基础工程已就绪。</p>
  </section>
</template>

<style scoped>
.migration-home { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
.eyebrow { color: #626a74; font-size: 0.875rem; letter-spacing: 0.08em; }
</style>
