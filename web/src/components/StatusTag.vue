<script setup lang="ts">
/**
 * 状态标签：颜色 + 文字双重线索，颜色只表示语义。
 * `text` 是给人看的文案（调用方按协议 code 用 `registrationStatusLabel()` 这类函数取好）；
 * 颜色由调用方按 code 传 `tone`（`statusTone(code)`），这里不再从中文文案反推。
 */
import { statusTone, type StatusTone } from '@/services/status';

const props = withDefaults(defineProps<{ text?: string; tone?: StatusTone }>(), { text: '', tone: undefined });
const resolved = (): StatusTone => props.tone ?? statusTone(props.text);
</script>

<template>
  <span v-if="props.text" class="status-tag" :data-tone="resolved()">{{ props.text }}</span>
</template>

<style>
/* 状态标签做成「信号灯」：一个小色点 + 文字，没有边框与底色，颜色只表示语义。
   这样在列表、卡片、详情抬头里都能直接放，不会跟卡片描边打架。 */
.status-tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--s1);
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 600;
  line-height: 1.2;
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

/* 语义色沿用既有的 --ok-ink / --warn-ink / --danger-ink / --info-ink：
   待审核是「要等一下」，用琥珀而不是强调色，避免一屏多处主题色。 */
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
