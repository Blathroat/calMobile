<script setup lang="ts">
/**
 * 细线图标：与 `docs/newUI` 的 `.icon` 规格一致（24 视窗、1.5 描边、无填充）。
 * 图标只在这里维护一份，页面写 `<AppIcon name="home" />`。
 */
import { computed } from 'vue';

const PATHS: Record<string, string> = {
  back: '<path d="m14 5-7 7 7 7"/>',
  chevronLeft: '<path d="m14 5-7 7 7 7"/>',
  chevronRight: '<path d="m10 5 7 7-7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3.5v3M16 3.5v3M3.5 10h17"/>',
  check: '<path d="m5 12.5 4.5 4.5 9-10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M7 7l1 12.2h8L17 7"/>',
  edit: '<path d="M4.5 19.5h4l11-11-4-4-11 11v4Z"/><path d="m14.5 6.5 4 4"/>',
  home: '<path d="m4 11 8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1Z"/>',
  ticket: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 3.9v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-3.9Z"/><path d="M12 8v8"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4S17.8 16.4 19 20"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.9M3.5 12.5h17"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6Z"/><path d="m9 12 2 2 4-4.5"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  video: '<rect x="3.5" y="6" width="12" height="12" rx="2"/><path d="m15.5 12 5-3v6Z"/>',
  save: '<path d="M6 4.5h9.5L20 9v10.5H6z"/><path d="M9 4.5v5h6v-5M9 19.5v-5h6v5"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19.5h14"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5 1.5 5H5s1.5-1 1.5-5Z"/><path d="M10.5 18.5a1.8 1.8 0 0 0 3 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  // 齿轮：旧版的「圆点 + 六条短线」看着像太阳/亮度调节，换成真正的齿轮轮廓。
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8.2v.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5.5V11h-5.5"/>',
};

const props = withDefaults(defineProps<{ name: string; size?: 'icon' | 'icon icon-sm' }>(), { size: 'icon' });
const path = computed(() => PATHS[props.name] ?? PATHS.info);
</script>

<template>
  <svg :class="props.size" viewBox="0 0 24 24" aria-hidden="true" v-html="path" />
</template>
