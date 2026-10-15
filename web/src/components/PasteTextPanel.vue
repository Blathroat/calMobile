<script setup lang="ts">
/**
 * 粘贴 Markdown 的输入面板（共享底部面板的自定义内容）。
 *
 * 只负责输入与提示，按钮与关闭仍由 `services/sheet.ts` 统一管：
 * 面板通过 `model` 这个响应式对象把文本交回调用方，调用方在动作里读取并决定
 * 「追加」还是「整段替换」，因此这里不需要向外 emit 值。
 */
import { t } from '@/i18n';

const props = withDefaults(
  defineProps<{
    /** 由调用方传入的响应式对象：面板写 `model.text`，调用方在按钮回调里读它 */
    model: { text: string };
    rows?: number;
    placeholder?: string;
    hint?: string;
  }>(),
  {
    rows: 8,
    placeholder: '',
    hint: '',
  },
);
</script>

<template>
  <div class="stack" data-gap="sm">
    <p v-if="props.hint" class="row-meta">{{ props.hint }}</p>
    <textarea
      id="paste-markdown"
      v-model="props.model.text"
      class="textarea"
      :rows="props.rows"
      :placeholder="props.placeholder || t('form.markdownPlaceholder')"
    />
  </div>
</template>
