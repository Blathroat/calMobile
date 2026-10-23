<script setup lang="ts">
/**
 * 名字后面的身份小签（展商 / 管理员）。普通用户与访客不显示。
 *
 * 身份不是状态，所以这里**不用** `StatusTag` 的信号灯，而是保留项目原来的方框小签：
 * 浅底 + 细描边 + 强调色文字，跟状态标签在视觉上区分得开。
 */
import { t } from '@/i18n';

const props = defineProps<{ roleCode?: string }>();

const COPY = {
  exhibitor: t('nav.exhibitor'),
  admin: t('app.administrator'),
};

function label(): string {
  if (props.roleCode === 'exhibitor') return COPY.exhibitor;
  if (props.roleCode === 'admin') return COPY.admin;
  return '';
}
</script>

<template>
  <span v-if="label()" class="role-tag">{{ label() }}</span>
</template>

<style>
.role-tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border: var(--hairline) solid var(--accent-edge);
  border-radius: var(--r-chip);
  background: var(--screen);
  color: var(--accent-ink);
  font-size: var(--fs-tag);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}
</style>
