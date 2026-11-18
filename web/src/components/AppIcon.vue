<script setup lang="ts">
/**
 * 工业级光学细线图标集：24×24 视窗、1.55 视觉平衡描边、圆角端点。
 * 保持 chevronLeft 首路径不变以兼容外壳路由守卫契约。
 */
import { computed } from 'vue';

const PATHS: Record<string, string> = {
  back: '<path d="m14 5-7 7 7 7"/>',
  chevronLeft: '<path d="m14 5-7 7 7 7"/>',
  chevronRight: '<path d="m10 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.6 15.6 4.9 4.9"/>',
  share:
    '<circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="m8.1 10.8 7.8-4.6M8.1 13.2l7.8 4.6"/>',
  copy: '<rect x="8.8" y="8.8" width="11.2" height="11.2" rx="2.2"/><path d="M5.2 15.2V6.4A1.4 1.4 0 0 1 6.6 5h8.8"/>',
  qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="6" y="6" width="2" height="2" rx="0.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="16" y="6" width="2" height="2" rx="0.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="6" y="16" width="2" height="2" rx="0.5"/><rect x="13.5" y="13.5" width="3.5" height="3.5" rx="0.8"/><path d="M19.5 14v2.5M14 19.5h2.5M19.5 19.5h.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.6"/><path d="M8 3.2v3.2M16 3.2v3.2M3.5 9.8h17"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
  mapPin:
    '<path d="M12 20.5s6.5-5.6 6.5-10.7a6.5 6.5 0 1 0-13 0c0 5.1 6.5 10.7 6.5 10.7Z"/><circle cx="12" cy="9.8" r="2.3"/>',
  check: '<path d="m5 12.5 4.5 4.5 9.5-9.5"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M4.5 7h15M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M7.2 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4L16.8 7"/>',
  edit: '<path d="M4.5 19.5h3.8L19 8.8a1.6 1.6 0 0 0 0-2.3l-1.5-1.5a1.6 1.6 0 0 0-2.3 0L4.5 15.7v3.8Z"/><path d="m13.8 6.4 3.8 3.8"/>',
  home: '<path d="m4 10.8 8-6.4 8 6.4v8.4a1.3 1.3 0 0 1-1.3 1.3h-4.2v-5.2h-5v5.2H5.3A1.3 1.3 0 0 1 4 19.2Z"/>',
  ticket:
    '<path d="M3.8 8.5A1.8 1.8 0 0 1 5.6 6.7h12.8a1.8 1.8 0 0 1 1.8 1.8v1.8a2.1 2.1 0 0 0 0 3.4v1.8a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8v-1.8a2.1 2.1 0 0 0 0-3.4Z"/><path d="M12.5 7.2v1.8M12.5 11.2v1.6M12.5 15v1.8"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5.2 19.8c1.3-3.5 3.9-5.2 6.8-5.2s5.5 1.7 6.8 5.2"/>',
  briefcase:
    '<rect x="3.5" y="7.5" width="17" height="12" rx="2.4"/><path d="M9 7.5V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.9M3.5 12.5h17"/>',
  shield: '<path d="M12 3.4 19 6v5.8c0 4.2-2.9 7.3-7 8.8-4.1-1.5-7-4.6-7-8.8V6Z"/><path d="m9.2 12.1 2 2 3.8-4.2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.4"/><path d="m4.2 7 7.1 5.1a1.2 1.2 0 0 0 1.4 0L19.8 7"/>',
  device: '<rect x="6.5" y="3.2" width="11" height="17.6" rx="2.4"/><path d="M10.5 6.2h3M12 17.8h.01"/>',
  camera:
    '<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.4-2h5.2l1.4 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.8" r="3.2"/>',
  key: '<circle cx="8.2" cy="14.8" r="3.8"/><path d="m11 12 8.2-8.2M16 7l2.5 2.5M18.5 4.5 20.5 6.5"/>',
  arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
  sparkles:
    '<path d="m12 3.5 1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7-4.7-1.8 4.7-1.8ZM18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2.4"/><circle cx="8.8" cy="9.8" r="1.5"/><path d="m4.2 17 4.8-4.4 3.8 3.3 3-2.5 4 3.6"/>',
  video: '<rect x="3.5" y="6" width="11.8" height="12" rx="2.4"/><path d="m15.3 10.6 5.2-2.8v8.4l-5.2-2.8Z"/>',
  save: '<path d="M5.5 4.5h10.2L19.5 8.3v10.2a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z"/><path d="M8.8 4.5v4.5h6.4V4.5M8.5 19.5v-5.2h7v5.2"/>',
  download: '<path d="M12 4v10.8m0 0 4-4m-4 4-4-4M5 19.5h14"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.8 1.6 5 1.6 5H4.9s1.6-1.2 1.6-5Z"/><path d="M10.3 18.4a2 2 0 0 0 3.4 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12M4.2 6.5h.01M4.2 12h.01M4.2 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 8v.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5.5V11h-5.5"/>',
};

const props = withDefaults(defineProps<{ name: string; size?: 'icon' | 'icon icon-sm' }>(), { size: 'icon' });
const path = computed(() => PATHS[props.name] ?? PATHS.info);
</script>

<template>
  <svg :class="props.size" viewBox="0 0 24 24" aria-hidden="true" v-html="path" />
</template>
