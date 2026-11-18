<script setup lang="ts">
/**
 * 屏幕 · 最近日志（管理员）
 *
 * 只读列表：顶部是服务器上的日志概况（条数、已用空间与上限），下面是最近 100 条，
 * 可按级别（全部 / 信息 / 警告 / 错误）筛选。
 *
 * 取数直接走 `api.logs.list`，不走查询缓存：日志每秒都在变，缓存一份旧的没有意义，
 * 每次进入、切筛选或下拉刷新都拿最新的一批。只显示最近 100 条由请求参数限定，
 * 页脚再说明一次，避免被当成全部历史。
 *
 * 时间是服务器下发的 ISO 串：日期用 services/format.ts 的中文日期，
 * 时分秒在页面里补（`YYYY-MM-DD HH:mm:ss` 这类格式不进文案表）。
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { formatLocalChineseDate } from '@/services/format';
import type { StatusTone } from '@/services/status';
import SegControl from '@/components/SegControl.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { LogEntry, LogsResult } from '@/api/types';
import { t } from '@/i18n';

/** 筛选条上的「全部」：只在本机作哨兵，不发给服务端。 */
const ALL_LEVELS = 'all';
const LEVELS = [
  { value: ALL_LEVELS, label: t('logs.level.all') },
  { value: 'info', label: t('logs.level.info') },
  { value: 'warn', label: t('logs.level.warn') },
  { value: 'error', label: t('logs.level.error') },
];
/** 级别 → 信号灯色调：信息灰蓝、警告琥珀、错误砖红，与服务端只约定 code。 */
const LEVEL_TONES: Record<string, StatusTone> = { info: 'info', warn: 'pending', error: 'danger' };

/** 一次最多取多少条：与服务端的分页上限一致，页脚据此说明。 */
const PAGE_SIZE = 100;
/** 一 MB 的字节数：统计行把服务端下发的字节数换成 MB。 */
const BYTES_PER_MB = 1024 * 1024;

const level = ref(ALL_LEVELS);
const logsQuery = useAsync<LogsResult>();

function load(): Promise<unknown> {
  return logsQuery.run(() =>
    api.logs.list({
      limit: PAGE_SIZE,
      level: level.value === ALL_LEVELS ? undefined : level.value,
    }),
  );
}

function changeLevel(value: string): void {
  if (value === level.value) return;
  level.value = value;
  void load();
}

onMounted(() => {
  void load();
});

// 刷新时保留已画出的列表，只在后台重取；指示圈只属于用户的手动下拉。
usePullRefresh(
  load,
  computed(() => logsQuery.loading.value && logsQuery.data.value !== undefined),
);

const logs = computed<LogEntry[]>(() => logsQuery.data.value?.logs ?? []);
const stats = computed(() => logsQuery.data.value?.stats);

/** 字节数 → MB（保留一位小数）；统计与进度条都用它。 */
function formatMegabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

const entryCount = computed(() => Number(stats.value?.entryCount) || 0);
const usedBytes = computed(() => Number(stats.value?.usedBytes) || 0);
const limitBytes = computed(() => {
  const limit = Number(stats.value?.limitBytes) || 0;
  // 上限以字节为准；没有时退回 MB 字段（与服务端设置同口径）。
  return limit > 0 ? limit : (Number(stats.value?.storageMb) || 0) * BYTES_PER_MB;
});
const usedCaption = computed(() => formatMegabytes(usedBytes.value));
const limitCaption = computed(() => formatMegabytes(limitBytes.value));
const usageCaption = computed(() =>
  limitBytes.value > 0
    ? t('logs.stats.usage', { used: usedCaption.value, limit: limitCaption.value })
    : t('logs.stats.usageNoLimit', { used: usedCaption.value }),
);
const storageFull = computed(() => limitBytes.value > 0 && usedBytes.value >= limitBytes.value);
const storagePercent = computed(() => {
  if (limitBytes.value <= 0) return 0;
  return Math.min(100, Math.round((usedBytes.value / limitBytes.value) * 100));
});
const emptyTitle = computed(() => (level.value === ALL_LEVELS ? t('logs.empty') : t('logs.emptyFiltered')));

/** 日志时间：中文日期 + 时分秒。非法值原样显示，不编造时间。 */
function formatLogTime(value: unknown): string {
  const raw = String(value ?? '');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return `${formatLocalChineseDate(raw)} ${clock}`;
}

/** 级别 code → 文案；不认识的 code 原样显示，方便看出后端加了新级别。 */
function levelLabel(value: unknown): string {
  const code = String(value ?? '');
  if (code === 'info' || code === 'warn' || code === 'error') return t(`logs.level.${code}`);
  return code;
}

function levelTone(value: unknown): StatusTone {
  return LEVEL_TONES[String(value ?? '')] ?? 'muted';
}

/** 操作人：有名字用名字；没有名字但有关联账号时是访客，否则是系统自己写的日志。 */
function actorLabel(entry: LogEntry): string {
  const name = String(entry.actorName ?? '').trim();
  if (name) return name;
  return String(entry.actorId ?? '').trim() ? t('logs.actor.guest') : t('logs.actor.system');
}

/** 请求行：`GET /exhibitions`。方法或路径缺失时只显示能显示的那一段。 */
function requestLine(entry: LogEntry): string {
  const method = String(entry.method ?? '').trim();
  const path = String(entry.path ?? '').trim();
  return method && path ? `${method} ${path}` : method || path;
}

/** 一行次要信息：分类 · 操作人 · IP · 状态码；空字段不占位。 */
function metaLine(entry: LogEntry): string {
  const parts: string[] = [];
  const category = String(entry.category ?? '').trim();
  if (category) parts.push(t('logs.meta.category', { value: category }));
  parts.push(t('logs.meta.actor', { value: actorLabel(entry) }));
  const ip = String(entry.ip ?? '').trim();
  if (ip) parts.push(t('logs.meta.ip', { value: ip }));
  const status = Number(entry.status);
  if (Number.isFinite(status) && status > 0) parts.push(t('logs.meta.status', { value: status }));
  return parts.join('  ');
}
</script>

<template>
  <SkeletonBlock v-if="logsQuery.loading.value && logsQuery.data.value === undefined" :rows="5" />
  <StateBlock
    v-else-if="logsQuery.error.value && logsQuery.data.value === undefined"
    tone="error"
    :title="t('logs.loadFailed')"
    :description="logsQuery.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <template v-else>
    <div v-if="stats" class="card logs-stats">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('logs.stats.title') }}</span>
        <span class="pill">{{ t('logs.stats.count', { count: entryCount }) }}</span>
      </div>
      <div class="logs-meter" :data-full="storageFull ? 'true' : 'false'">
        <span :style="{ width: storagePercent + '%' }" />
      </div>
      <p class="field-hint">{{ usageCaption }}</p>
    </div>

    <SegControl :model-value="level" :items="LEVELS" :label="t('logs.filter')" @update:model-value="changeLevel" />

    <!-- 后台刷新失败时保留旧列表，只在原位提示，不清空已经画出来的内容。 -->
    <div v-if="logsQuery.error.value" class="notice" data-tone="accent">
      <span>{{ logsQuery.error.value.message }}</span>
    </div>

    <StateBlock v-if="logs.length === 0" :title="emptyTitle" />

    <!-- 全部日志放在一张卡里、行之间用发丝线分隔：行数多，每行再套一张卡会太碎。
         切级别时已有内容只弱化（data-busy），不整块换成骨架屏。 -->
    <div
      v-else
      class="card logs-list"
      :data-busy="logsQuery.loading.value && logsQuery.data.value !== undefined ? 'true' : undefined"
    >
      <div v-for="entry in logs" :key="entry.id" class="log-row">
        <div class="log-head">
          <time class="log-time" :datetime="String(entry.createdAt ?? '')">{{ formatLogTime(entry.createdAt) }}</time>
          <StatusTag :text="levelLabel(entry.level)" :tone="levelTone(entry.level)" />
        </div>
        <p class="log-message">{{ entry.message }}</p>
        <p v-if="requestLine(entry)" class="log-path truncate">{{ requestLine(entry) }}</p>
        <p class="row-meta log-meta">{{ metaLine(entry) }}</p>
      </div>
    </div>

    <p class="field-hint logs-hint">{{ t('logs.recentHint') }}</p>
  </template>
</template>

<style>
/* 概况卡：组标题与条数一行，进度条贴着数字说明，避免一屏出现两处「卡内第二层」。 */
.logs-stats {
  gap: var(--s2);
}

/* 与设置页的存储条同一观感：一条填充线，用满时换成砖红。 */
.logs-meter {
  height: 6px;
  overflow: hidden;
  border-radius: var(--r-pill);
  background: var(--f1);
}

.logs-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-solid);
  transition: width var(--motion-base) var(--ease);
}

.logs-meter[data-full='true'] > span {
  background: var(--danger-ink);
}

/* 列表卡：行与行之间只用发丝线分隔，卡片自身的内距交给行。 */
.logs-list {
  gap: 0;
  padding-block: var(--s1);
}

.log-row {
  display: grid;
  gap: var(--s1);
  min-width: 0;
  padding-block: var(--s3);
}

.log-row + .log-row {
  border-top: var(--hairline) solid var(--stroke);
}

/* 时间在左、级别信号灯在右，长内容先让时间省略，信号灯不被挤掉。 */
.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  min-width: 0;
}

.log-time {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--fs-meta);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 正文是行里的主信息：可以换行，但绝不横向溢出。 */
.log-message {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* 请求行是次要信息：等宽字体、单行截断，长路径不把整行撑宽。 */
.log-path {
  color: var(--ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-meta);
}

.log-meta {
  overflow-wrap: anywhere;
}

.logs-hint {
  margin: var(--s1) 0 0;
}
</style>
