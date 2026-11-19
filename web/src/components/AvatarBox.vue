<script setup lang="ts">
/**
 * 圆形头像：有图显示图片；没有头像、图片打不开或解码失败时回落到昵称首字。
 *
 * <img> 的 error 覆盖 404、网络失败与解码失败：这时移除图片改显示首字，不留破图或空白；
 * src 换了（换头像）要清掉失败状态重新尝试。
 */
import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import { resolveMediaUrl } from '@/services/media-url';

const props = withDefaults(defineProps<{ src?: string; name?: string; large?: boolean }>(), {
  src: '',
  name: '',
  large: false,
});

/** 当前地址的图片是否加载失败；失败时改显示首字。 */
const failed = ref(false);

/** 只有确实展示图片时才加 has-image：回落后边框与底色跟无头像时一致。 */
const showImage = computed(() => Boolean(props.src) && !failed.value);

/** 换头像后地址变了，清掉失败状态重新加载一次。 */
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);

/** 图片打不开或解码失败都走这里，由模板把破图换成首字。 */
function onError(event: Event): void {
  const image = event.target as HTMLImageElement | null;
  // 换头像时旧图片可能迟到一个 error，别让它把新图片也切回首字。
  if (image && !image.isConnected) return;
  failed.value = true;
}

const initial = (): string => (props.name || t('profile.avatarInitial')).slice(0, 1);
</script>

<template>
  <span
    class="avatar"
    :class="{ 'has-image': showImage, 'avatar-lg': props.large }"
    :aria-label="t('profile.avatarLabel', { name: props.name || t('admin.users.title') })"
  >
    <img v-if="showImage" :key="props.src" :src="resolveMediaUrl(props.src)" alt="" @error="onError" />
    <span v-else aria-hidden="true">{{ initial() }}</span>
  </span>
</template>

<style>
.avatar-lg {
  width: 56px;
  height: 56px;
  font-size: 21px;
}
</style>
