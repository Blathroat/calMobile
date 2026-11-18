<script setup lang="ts">
/**
 * 反馈状态块：空状态、异常与完成态统一承载，平直无阴影。
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
    <span class="state-icon"><AppIcon :name="iconName()" /></span>
    <strong v-if="props.title">{{ props.title }}</strong>
    <p v-if="props.description" class="muted">{{ props.description }}</p>
    <button v-if="props.actionLabel" class="cta ghost state-cta" type="button" @click="emit('action')">
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
  padding: var(--s6) var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
  color: var(--ink-2);
  text-align: center;
}

.state strong {
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 600;
}

.state > p {
  max-width: 26em;
  font-size: var(--fs-xs);
  line-height: 1.5;
  text-wrap: balance;
}

.state .state-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--f3);
  color: var(--ink-2);
}

.state .state-cta {
  width: auto;
  min-width: 120px;
  max-width: 100%;
  padding-inline: var(--s4);
  margin-top: var(--s1);
}

.state[data-tone='success'] {
  border-color: var(--ok-border);
  background: var(--surface-card);
}

.state[data-tone='success'] .state-icon {
  border-color: var(--ok-border);
  background: var(--ok);
  color: var(--ok-ink);
}

.state[data-tone='success'] strong {
  color: var(--ok-ink);
}

.state[data-tone='error'] {
  border-color: var(--danger-border);
  background: var(--surface-card);
}

.state[data-tone='error'] .state-icon {
  border-color: var(--danger-border);
  background: var(--danger-tint);
  color: var(--danger-ink);
}

.state[data-tone='error'] strong {
  color: var(--danger-ink);
}
</style>
