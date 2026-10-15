<script setup lang="ts">
/**
 * 一次性提示条。
 *
 * 用在「教用户怎么操作」的地方：只在账号还没看过这条提示时显示，用户做完对应动作
 * （或点「知道了」）后由 `composables/useHint.ts` 记到账号上，之后换设备也不再出现。
 *
 * 与 `.notice` 同一套外观，只是多一个关闭入口——提示是「可以不再看」的，不是必须处理的警告。
 */
import { t } from '@/i18n';

const COPY = {
  /** 关闭入口：把这条提示标记为已看。 */
  dismiss: t('app.gotIt'),
};

const props = withDefaults(defineProps<{ text: string; busy?: boolean }>(), { busy: false });
const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div class="notice hint-note" data-tone="accent" role="status">
    <span>{{ props.text }}</span>
    <button class="text-action" type="button" :disabled="props.busy" @click="emit('dismiss')">
      {{ COPY.dismiss }}
    </button>
  </div>
</template>
