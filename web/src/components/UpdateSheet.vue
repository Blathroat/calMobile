<script setup lang="ts">
/**
 * 「发现新版本」抽屉内容（由 `services/sheet.ts` 的 `openSheet({ component })` 打开）。
 *
 * 只负责展示与下载：关闭抽屉、检查失败等反馈都留在调用页。
 * 「下载并安装」只是打开下载地址 —— 应用 WebView 里除 `/app/` 之外的链接
 * 本来就交给系统浏览器，安装由系统完成，不调用原生桥。
 */
import { computed } from 'vue';
import { currentVersion } from '@/services/update-check';
import { t } from '@/i18n';
import type { ReleaseInfo } from '@/api/types';

const props = defineProps<{ release: ReleaseInfo }>();

const version = computed(() => String(props.release.version ?? '').trim());
const url = computed(() => String(props.release.url ?? '').trim());
const notes = computed(() => String(props.release.notes ?? '').trim());
/** 更新日志只有 GitHub 源才有。 */
const showNotes = computed(() => props.release.source === 'github' && notes.value !== '');
const title = computed(() =>
  version.value
    ? t('settings.update.availableTitle', { version: version.value })
    : t('settings.update.availableNoVersion'),
);
const current = computed(() => currentVersion());

/** 交给系统浏览器下载：与报名站的下载条同一条外链路径。 */
function download(): void {
  if (!url.value) return;
  window.open(url.value, '_blank', 'noopener');
}
</script>

<template>
  <div class="update-content">
    <!-- 版本行：GitHub 源带版本号；直链没有版本号，只说「发现新版本」 -->
    <div class="update-version">
      <strong class="update-title">{{ title }}</strong>
      <span v-if="current" class="row-meta">{{ t('settings.update.currentVersion', { version: current }) }}</span>
    </div>

    <!-- 更新日志：纯文本保留换行，不解析 Markdown -->
    <div v-if="showNotes" class="update-log">
      <span class="section-label">{{ t('settings.update.notes') }}</span>
      <p class="update-notes">{{ notes }}</p>
    </div>
    <p v-else class="field-hint">{{ t('settings.update.noNotes') }}</p>

    <button class="cta" type="button" :disabled="!url" @click="download">
      {{ t('settings.update.download') }}
    </button>
  </div>
</template>

<style scoped>
.update-content {
  display: grid;
  gap: var(--s3);
  min-width: 0;
}

.update-version {
  display: grid;
  gap: var(--s1);
  min-width: 0;
}

.update-title {
  color: var(--ink);
  font-size: var(--fs-h3);
  font-weight: 700;
  line-height: 1.35;
}

.update-log {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}

/* 更新日志是 Release 里的纯文本：保留换行，长链接也允许断行。 */
.update-notes {
  margin: 0;
  padding: var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
  color: var(--ink-2);
  font-size: var(--fs-meta);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
