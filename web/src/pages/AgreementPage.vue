<script setup lang="ts">
/**
 * 用户协议浏览页（应用与报名站共用，`/agreement`）。
 *
 * 正文由管理员在「管理-设置-用户协议」上传 Markdown，接口是公开读取的
 * （`GET /agreement`，不走查询缓存：正文可能很大且会随管理员保存而变化）。
 * 关闭协议或正文为空时给空态，不画半截页面；加载失败与原位重试交给 StateBlock。
 *
 * 渲染与展会简介同一条链路：`loadMarkdownParser()` → `markdownToHtml()`（内部已清洗），
 * 结果落到 `.rich-content`。版本与更新时间放在正文上方，格式与其它日期一致用中文日期。
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { loadMarkdownParser, markdownToHtml } from '@/services/markdown';
import { formatLocalChineseDate } from '@/services/format';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { AgreementInfo } from '@/api/types';
import { t } from '@/i18n';

const query = useAsync<AgreementInfo>();
/** 渲染后的正文；与原始 Markdown 分开存，避免每次重渲染都重新解析。 */
const html = ref('');
const rendering = ref(false);
const renderError = ref('');

const info = computed(() => query.data.value);
const enabled = computed(() => info.value?.enabled === true);
const content = computed(() => String(info.value?.content ?? '').trim());
const version = computed(() => Number(info.value?.version ?? 0) || 0);
/** 更新时间：能解析成日期就用中文日期，解析不出就显示接口原值，不吞掉信息。 */
const dateLabel = computed(() => {
  const raw = String(info.value?.updatedAt ?? '');
  return formatLocalChineseDate(raw) || raw;
});
/** 版本与更新时间合成一行；只有其中一项时只显示那一项。 */
const metaLabel = computed(() => {
  if (version.value > 0 && dateLabel.value)
    return t('agreement.versionDate', { version: version.value, date: dateLabel.value });
  if (version.value > 0) return t('agreement.versionOnly', { version: version.value });
  if (dateLabel.value) return t('agreement.updatedOnly', { date: dateLabel.value });
  return '';
});

/** 取数并渲染；失败与重试都留在原位（StateBlock 的按钮再走一遍这里）。 */
async function load(): Promise<void> {
  html.value = '';
  renderError.value = '';
  const data = await query.run(() => api.agreement.get());
  if (!data || data.enabled !== true || !String(data.content ?? '').trim()) return;
  rendering.value = true;
  try {
    await loadMarkdownParser();
    html.value = markdownToHtml(String(data.content));
  } catch (reason) {
    // 解析器按需加载失败（新文件还没下发、网络断）时仍要有可见的失败与重试入口。
    renderError.value = reason instanceof Error && reason.message ? reason.message : t('agreement.loadFailed');
  } finally {
    rendering.value = false;
  }
}

onMounted(load);
</script>

<template>
  <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="6" />
  <StateBlock
    v-else-if="query.error.value"
    tone="error"
    :title="t('agreement.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <StateBlock
    v-else-if="renderError"
    tone="error"
    :title="t('agreement.loadFailed')"
    :description="renderError"
    :action-label="t('common.retry')"
    @action="load"
  />
  <StateBlock
    v-else-if="!enabled"
    :title="t('agreement.disabledTitle')"
    :description="t('agreement.disabledDescription')"
    icon="info"
  />
  <StateBlock
    v-else-if="!content"
    :title="t('agreement.emptyTitle')"
    :description="t('agreement.emptyDescription')"
    icon="info"
  />
  <template v-else>
    <p v-if="metaLabel" class="agreement-meta">{{ metaLabel }}</p>
    <SkeletonBlock v-if="rendering" :rows="6" />
    <div v-else-if="html" class="rich-content" v-html="html" />
  </template>
</template>

<style>
/* 版本与更新时间：小字、次级色，别和正文抢。 */
.agreement-meta {
  color: var(--ink-3);
  font-size: var(--fs-meta);
  font-variant-numeric: tabular-nums;
}
</style>
