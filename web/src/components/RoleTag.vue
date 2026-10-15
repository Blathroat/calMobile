<script setup lang="ts">
/**
 * 名字后面的蓝色小标签，样子跟展会卡片上的「仅展示」一样。
 * 展商写「展商」，管理员写「管理员」，普通用户和访客不显示。
 */
import StatusTag from './StatusTag.vue';
import { t } from '@/i18n';

const props = defineProps<{ roleCode?: string }>();

const COPY = {
  exhibitor: t('s_1mdxfsy'),
  admin: t('s_1yxtyq'),
};

function label(): string {
  if (props.roleCode === 'exhibitor') return COPY.exhibitor;
  if (props.roleCode === 'admin') return COPY.admin;
  return '';
}
</script>

<template>
  <StatusTag :text="label()" tone="info" />
</template>
