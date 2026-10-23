<script setup lang="ts">
/**
 * 状态标签：颜色 + 文字双重线索，颜色只表示语义。
 *
 * 画成「信号灯」：一个小色点 + 文字，没有边框与底色，所以放进卡片、列表行、
 * 详情抬头都不会和周围的描边打架。身份标签（展商 / 管理员）不是状态，
 * 走 `RoleTag`，那边仍然是方框小签。
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

/* 信号灯的那颗点：跟着文字颜色走，不需要第二个色值。 */
.status-tag::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
  background: currentColor;
}

/* 待审核是「要等一下」，用琥珀而不是强调色，免得一屏出现多处主题色。 */
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
