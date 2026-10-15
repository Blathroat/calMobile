<script setup lang="ts">
/**
 * 手动输入报名码的面板（共享底部面板的自定义内容）。
 *
 * 与粘贴面板同一套约定：输入值放在调用方传入的响应式对象里，
 * 校验失败时把错误文案写回 `model.error` 并留在面板里，由调用方决定何时关闭。
 */
import { t } from '@/i18n';

const props = withDefaults(defineProps<{
  model: { code: string; error?: string };
  hint?: string;
  placeholder?: string;
}>(), {
  hint: '',
  placeholder: '',
});
</script>

<template>
  <div class="stack" data-gap="sm">
    <div class="field" :data-invalid="props.model.error ? 'true' : 'false'">
      <label for="checkin-code">{{ t('checkin.manual.codeContent') }}</label>
      <input
        id="checkin-code"
        v-model="props.model.code"
        class="input"
        type="text"
        autocomplete="off"
        :placeholder="props.placeholder || t('checkin.manual.example')"
      />
      <p v-if="props.hint" class="field-hint">{{ props.hint }}</p>
      <p v-if="props.model.error" class="field-error" role="alert">{{ props.model.error }}</p>
    </div>
  </div>
</template>
