<script setup lang="ts">
/**
 * 图片或占位：`src` 为空时保留线框的斜线占位，不显示破图。
 * 展会图统一 9:16（`thumb thumb-cover`），头像用 `AvatarBox`。
 */
withDefaults(defineProps<{ src?: string; className?: string; alt?: string }>(), {
  src: '',
  className: 'thumb',
  alt: '',
});
</script>

<template>
  <span class="ph-img" :class="className" :aria-hidden="src ? undefined : 'true'">
    <img v-if="src" :src="src" :alt="alt" />
  </span>
</template>
