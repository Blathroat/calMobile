<script setup lang="ts">
/**
 * 身份标签（展商 / 管理员）：采用 Radix Accent Step 3 底色 + Step 6 0.5px 边线 + Step 11 文字。
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
  padding: 2px 6px;
  border: var(--hairline) solid var(--accent-edge);
  border-radius: var(--r-chip);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: var(--fs-xs);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}
</style>
