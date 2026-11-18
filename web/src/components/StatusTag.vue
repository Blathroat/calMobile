<script setup lang="ts">
/**
 * 状态指示标签：圆点 + Radix 语义色文字，光学居中对齐，无外框与光晕。
 */
import { statusTone, type StatusTone } from '@/services/status';

const props = withDefaults(defineProps<{ text?: string; tone?: StatusTone }>(), { text: '', tone: undefined });
const resolved = (): StatusTone => props.tone ?? statusTone(props.text);
</script>

<template>
  <span v-if="props.text" class="status-tag" :data-tone="resolved()">{{ props.text }}</span>
</template>

<style>
.status-tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}

.status-tag::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
  background: currentColor;
}

.status-tag[data-tone='ok'] {
  color: var(--ok-ink);
}

.status-tag[data-tone='pending'],
.status-tag[data-tone='warn'] {
  color: var(--warn-ink);
}

.status-tag[data-tone='danger'] {
  color: var(--danger-ink);
}

.status-tag[data-tone='info'] {
  color: var(--info-ink);
}

.status-tag[data-tone='muted'] {
  color: var(--ink-3);
}
</style>
