<script setup lang="ts">
/**
 * 反馈状态块：空、加载失败、成功、找不到目标都用它。
 *
 * 规则来自 docs/engineering.md：状态必须同时给出文字与视觉差异，并在原位给出下一步。
 * `description` 说明原因，`action` 是唯一的下一步入口。
 */
import AppIcon from './AppIcon.vue';

const props = withDefaults(
  defineProps<{
    tone?: 'neutral' | 'error' | 'success';
    title?: string;
    description?: string;
    icon?: string;
    actionLabel?: string;
  }>(),
  { tone: 'neutral', title: '', description: '', icon: '', actionLabel: '' },
);

const emit = defineEmits<{ action: [] }>();

function iconName(): string {
  if (props.icon) return props.icon;
  return props.tone === 'error' ? 'info' : props.tone === 'success' ? 'check' : 'list';
}
</script>

<template>
  <div class="state" :data-tone="props.tone">
    <span class="state-icon"><AppIcon :name="iconName()" size="icon icon-sm" /></span>
    <strong v-if="props.title">{{ props.title }}</strong>
    <p v-if="props.description" class="muted">{{ props.description }}</p>
    <button v-if="props.actionLabel" class="cta ghost" type="button" @click="emit('action')">
      {{ props.actionLabel }}
    </button>
    <slot />
  </div>
</template>

<style>
.state {
  display: grid;
  gap: var(--s2);
  justify-items: center;
  padding: var(--s5) var(--s4);
  border: var(--hairline) dashed var(--stroke);
  border-radius: var(--r-card);
  background: var(--f3);
  color: var(--ink-2);
  text-align: center;
}

.state strong {
  color: var(--ink);
  font-size: var(--fs-body);
}

.state .state-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--ink-3);
  border-radius: var(--r-pill);
  color: var(--ink-2);
}

.state[data-tone='success'] {
  border-color: var(--ok-ink);
  border-style: solid;
  background: var(--ok);
  color: var(--ok-ink);
}

.state[data-tone='success'] strong {
  color: var(--ok-ink);
}

.state[data-tone='error'] {
  border-color: var(--danger-ink);
  border-style: solid;
  background: var(--danger-tint);
  color: var(--danger-ink);
}

.state[data-tone='error'] strong {
  color: var(--danger-ink);
}
</style>
