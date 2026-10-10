<script setup lang="ts">
/** 圆形头像：有图显示图片，没有头像时回落到昵称首字。 */
import { t } from '@/i18n';
import { resolveMediaUrl } from '@/services/media-url';

const props = withDefaults(defineProps<{ src?: string; name?: string; large?: boolean }>(), {
  src: '',
  name: '',
  large: false,
});

const initial = (): string => (props.name || t('s_cmla8n')).slice(0, 1);
</script>

<template>
  <span
    class="avatar"
    :class="{ 'has-image': Boolean(props.src), 'avatar-lg': props.large }"
    :aria-label="`${props.name || t('s_1in002o')}的头像`"
  >
    <img v-if="props.src" :src="resolveMediaUrl(props.src)" alt="" />
    <span v-else aria-hidden="true">{{ initial() }}</span>
  </span>
</template>
