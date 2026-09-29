<script setup lang="ts">
/** 状态标签：颜色 + 文字双重线索，颜色只表示语义。 */
import { statusTone, type StatusTone } from '@/services/status';

const props = withDefaults(defineProps<{ text?: string; tone?: StatusTone }>(), { text: '', tone: undefined });
const resolved = (): StatusTone => props.tone ?? statusTone(props.text);
</script>

<template>
  <span v-if="props.text" class="status-tag" :data-tone="resolved()">{{ props.text }}</span>
</template>
