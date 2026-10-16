<script setup lang="ts">
/** 状态标签：颜色 + 文字双重线索，颜色只表示语义。 */
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
  gap: var(--s1);
  padding: 4px 8px;
  border-radius: var(--r-chip);
  background: var(--screen);
  border: var(--hairline) solid var(--accent-edge);
  color: var(--accent-ink);
  font-size: var(--fs-tag);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}

.status-tag[data-tone='ok'] {
  background: var(--screen);
  border-color: var(--ok-ink);
  color: var(--ok-ink);
}

.status-tag[data-tone='pending'] {
  background: var(--screen);
  border-color: var(--accent-edge);
  color: var(--accent-ink);
}

.status-tag[data-tone='warn'] {
  background: var(--screen);
  border-color: var(--warn-ink);
  color: var(--warn-ink);
}

.status-tag[data-tone='danger'] {
  background: var(--danger-tint);
  color: var(--danger-ink);
}

.status-tag[data-tone='info'] {
  background: var(--screen);
  border-color: var(--info-ink);
  color: var(--info-ink);
}

.status-tag[data-tone='muted'] {
  background: var(--f1);
  color: var(--ink-2);
}
</style>
