<script setup lang="ts">
/**
 * 屏幕 13 · 报名管理 / 审核
 * 线框：docs/newUI/remaining-ui.html #screen-registration-management
 *
 * 状态为待审核 / 已通过 / 已拒绝 / 已参加；展商能否重新审核由管理员设置决定
 * （`bootstrap.review.canRevise`），管理员自己不受该开关限制。
 *
 * 筛选切换只改本地状态并复用已取到的数据：分段上的数量与顶部统计都从这一份记录算出来，
 * 切筛选不重新取数，也不清空上一份结果（只在原位标记忙碌）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import type { SheetAction } from '@/services/sheet';
import { device } from '@/services/device-services';
import { REGISTRATION_STATUS, REVIEW_FILTERS, statusTone } from '@/services/status';
import { answerLines, truncate } from '@/services/format';
import SegControl from '@/components/SegControl.vue';
import AppIcon from '@/components/AppIcon.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { Exhibition, Registration, ReviewList } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

/** 路由查询参数带展会：`/review?exhibitionId=…`；不带时先让展商挑一个展会。 */
const exhibitionId = computed(() => String(route.query.exhibitionId ?? route.params.exhibitionId ?? ''));
const isAdmin = computed(() => session.user.can?.admin === true);

const list = useAsync<Exhibition[]>();
const review = useAsync<ReviewList>();
/** 筛选只改本地状态：数据已经全量取回，切换不重新请求。 */
const filter = ref<string>(REGISTRATION_STATUS.PENDING);

const exhibitions = computed<Exhibition[]>(() => list.data.value ?? []);
// `/review` 返回的是 `{ records, counts }`：记录列表与各状态数量都在返回体里，
// 直接当数组用会让整页渲染时抛错（这正是「查看报名打不开」的原因）。
const records = computed<Registration[]>(() => review.data.value?.records ?? []);
const counts = computed<Record<string, number>>(() => review.data.value?.counts ?? {});
const hasRecords = computed(() => review.data.value !== undefined);
const reviewLoading = computed(() => review.loading.value && !hasRecords.value);

/** 筛选条顺序沿用 `REVIEW_FILTERS`；数量优先用后端统计，缺失时按已取到的记录算。 */
const filterItems = computed(() => REVIEW_FILTERS.map((value) => ({
  value,
  label: `${value} ${countOf(value)}`,
})));

/** 当前筛选下的记录：`全部` 不过滤，其余按状态。 */
const filtered = computed<Registration[]>(() => (
  filter.value === '全部' ? records.value : records.value.filter((item) => item.status === filter.value)
));

const pendingCount = computed(() => countOf(REGISTRATION_STATUS.PENDING));

function countOf(status: string): number {
  const known = status === '全部' ? counts.value.total : counts.value[status];
  if (typeof known === 'number') return known;
  if (status === '全部') return records.value.length;
  return records.value.filter((item) => item.status === status).length;
}

// ── 取数 ─────────────────────────────────────────────────────────

function loadExhibitions(): void {
  void list.run(() => api.exhibitions.list());
}

function load(): void {
  if (!exhibitionId.value) {
    loadExhibitions();
    return;
  }
  void review.run(() => api.review.list({ exhibitionId: exhibitionId.value }));
}

onMounted(load);

// ── 审核动作 ─────────────────────────────────────────────────────

/**
 * 可选动作必须与后端状态机一致（`server/src/routes/review-hono.ts` 的
 * REGISTRATION_TRANSITIONS）：已参加是终态；展商在「允许修改已通过或已拒绝的报名」
 * 关闭时不能动已审核的记录，管理员不受该策略限制，但仍受状态机限制。
 */
const TRANSITIONS: Record<string, string[]> = {
  [REGISTRATION_STATUS.PENDING]: [
    REGISTRATION_STATUS.APPROVED,
    REGISTRATION_STATUS.REJECTED,
  ],
  [REGISTRATION_STATUS.APPROVED]: [
    REGISTRATION_STATUS.ATTENDED,
    REGISTRATION_STATUS.REJECTED,
  ],
  [REGISTRATION_STATUS.REJECTED]: [REGISTRATION_STATUS.APPROVED],
  [REGISTRATION_STATUS.CANCELLED]: [REGISTRATION_STATUS.APPROVED],
};

function targetsFor(record: Registration): string[] {
  const status = String(record.status ?? '');
  const reviewed = status !== REGISTRATION_STATUS.PENDING;
  const mayRevise = isAdmin.value || !reviewed || bootstrap.review.canRevise === true;
  return mayRevise ? (TRANSITIONS[status] ?? []) : [];
}

function targetLabel(target: string): string {
  if (target === REGISTRATION_STATUS.APPROVED) return t('s_j666m6');
  if (target === REGISTRATION_STATUS.REJECTED) return t('s_1qrntx4');
  return t('s_crec0c');
}

function statusMessage(status: string): string {
  if (status === REGISTRATION_STATUS.APPROVED) return t('s_1j0wkqr');
  if (status === REGISTRATION_STATUS.REJECTED) return t('s_yxll7l');
  return `已将报名标记为${status}`;
}

/**
 * 报名详情：回答逐条列出，状态动作放在同一面板的按钮里。
 * 面板只支持「一句话 + 一组按钮」，因此详情与动作分成两步：
 * 先看回答，再点「调整状态」打开动作面板——按钮数量随状态机变化，不会挤在一起。
 */
function openDetail(record: Registration): void {
  const answers = answerLines(record.answers);
  const targets = targetsFor(record);
  const hint = record.status === REGISTRATION_STATUS.ATTENDED
    ? t('s_159zzbg')
    : t('s_1e05tqn');
  const lines = [
    `${record.status} · 报名于 ${record.registrationTime}`,
    ...(answers.length > 0
      ? answers.map((line) => `${line.label || t('s_otl7kf')}：${line.value || '—'}`)
      : [t('s_v8pba2')]),
  ];
  const actions: SheetAction[] = [];
  if (targets.length > 0) {
    actions.push({
      label: t('s_j666m6'),
      variant: 'primary',
      onClick: (close) => {
        close();
        openActions(record);
      },
    });
  } else {
    lines.push(hint);
  }
  actions.push({ label: t('s_g0fanx'), onClick: (close) => close() });
  openSheet({ title: String(record.visitorName ?? ''), message: lines.join('\n'), actions });
}

/** 状态动作面板：可选动作与后端状态机一致，拒绝走二次确认。 */
function openActions(record: Registration): void {
  const targets = targetsFor(record);
  if (targets.length === 0) {
    toast(t('s_1e05tqn'), 'error');
    return;
  }
  openSheet({
    title: t('s_1r4txyl'),
    message: `当前：${record.status}`,
    actions: targets.map((target): SheetAction => ({
      label: targetLabel(target),
      variant: target === REGISTRATION_STATUS.APPROVED ? 'primary' : 'ghost',
      onClick: async (close) => {
        close();
        if (target === REGISTRATION_STATUS.REJECTED) askReject(record);
        else await changeStatus(record, target);
      },
    })).concat([{ label: t('s_1589w37'), onClick: (close) => close() }]),
  });
}

async function changeStatus(record: Registration, status: string): Promise<void> {
  try {
    const result = await api.review.updateStatus(String(record.id), status);
    if (result?.ok !== true) {
      toast(String(result?.error || t('s_10lkv9z')), 'error');
      return;
    }
    toast(statusMessage(status), 'success');
    await refresh();
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

/** 拒绝前二次确认：拒绝会通知报名人，误点代价高。 */
function askReject(record: Registration): void {
  openSheet({
    title: t('s_1qrntx4'),
    message: `将「${record.visitorName}」的报名标记为已拒绝？审核结果会同步到用户的“我的报名”。`,
    actions: [
      { label: t('s_1589w37'), onClick: (close) => close() },
      {
        label: t('s_1qrntx4'),
        variant: 'danger',
        onClick: async (close) => {
          close();
          await changeStatus(record, REGISTRATION_STATUS.REJECTED);
        },
      },
    ],
  });
}

async function refresh(): Promise<void> {
  await review.run(() => api.review.list({ exhibitionId: exhibitionId.value }));
}

// ── CSV 导出 ─────────────────────────────────────────────────────

/** CSV 字段转义：含逗号、引号或换行时用双引号包住，内部引号翻倍。 */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportCsv(): Promise<void> {
  const rows = [
    [t('s_33njx3'), t('s_17yba4l'), t('s_1ccx4t4'), t('s_rxiw2v')],
    ...filtered.value.map((record) => [
      String(record.visitorName ?? ''),
      String(record.registrationTime ?? ''),
      String(record.status ?? ''),
      String(record.answers ?? '').replace(/\n/g, ' '),
    ]),
  ];
  // 带 BOM，Excel 打开中文表头才不会乱码。
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const filename = `registrations-${exhibitionId.value || 'all'}.csv`;
  try {
    await device.exportCsv(filename, content);
    toast(`已导出 ${filtered.value.length} 条报名到 ${filename}`, 'success');
  } catch (reason) {
    // 用户在系统保存框点了取消：按码判断，不给红色错误，只说明没有导出。
    if (reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled') {
      toast(t('s_1va7jf9'));
      return;
    }
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}
</script>

<template>
  <!-- 未指定展会：先让展商选择要审核的展会 -->
  <template v-if="!exhibitionId">
    <header class="row" data-between="true">
      <div class="stack" data-gap="sm">
        <span class="eyebrow">{{ bootstrap.brand.en }}</span>
        <h2>{{ t('s_7xrrf0') }}</h2>
      </div>
      <span class="pill">{{ `${exhibitions.length} 个展会` }}</span>
    </header>
    <p class="row-meta">{{ t('s_1dkg6y4') }}</p>

    <SkeletonBlock v-if="list.loading.value && list.data.value === undefined" :rows="2" />
    <StateBlock
      v-else-if="list.error.value && list.data.value === undefined"
      tone="error"
      :title="t('s_kvpltc')"
      :description="list.error.value.message"
      :action-label="t('s_lswd2v')"
      @action="loadExhibitions"
    />
    <template v-else>
      <span class="section-label">{{ t('s_1yn5q3y') }}</span>
      <div class="list" data-gap="sm">
        <button
          v-for="item in exhibitions"
          :key="String(item.id)"
          class="row-card"
          type="button"
          data-pressable="true"
          @click="router.replace(`/review?exhibitionId=${encodeURIComponent(String(item.id))}`)"
        >
          <span class="row-copy">
            <strong class="row-title truncate">{{ item.title }}</strong>
            <span class="row-meta">{{ `${item.dateLabel} · ${item.registrationCount ?? 0} 条报名` }}</span>
          </span>
          <StatusTag :text="String(item.status || '')" :tone="statusTone(String(item.status || ''))" />
        </button>
      </div>
    </template>
  </template>

  <template v-else>
    <div class="row" data-between="true">
      <div class="stack" data-gap="sm">
        <span class="eyebrow">{{ bootstrap.brand.en }}</span>
        <h2>{{ t('s_7xrrf0') }}</h2>
      </div>
      <span class="pill">{{ `待审核 ${pendingCount}` }}</span>
    </div>
    <p class="row-meta">{{ t('s_1dkg6y4') }}</p>
    <p v-if="isAdmin" class="field-hint">{{ t('s_17zufsn') }}</p>

    <SegControl v-model="filter" :items="filterItems" :label="t('s_1r4txyl')" />

    <SkeletonBlock v-if="reviewLoading" :rows="3" />

    <StateBlock
      v-else-if="review.error.value && !hasRecords"
      tone="error"
      :title="t('s_1f0wrbh')"
      :description="review.error.value.message"
      :action-label="t('s_lswd2v')"
      @action="refresh"
    />

    <!-- 切换筛选时旧结果留在原位，只标记忙碌，不清空 -->
    <div v-if="review.error.value && hasRecords" class="notice" data-tone="accent">
      <span>{{ review.error.value.message }}</span>
    </div>

    <StateBlock
      v-else-if="filtered.length === 0"
      icon="ticket"
      :title="`没有${filter === '全部' ? '' : filter}的报名`"
      :description="t('s_z599mr')"
    />

    <div v-else class="list" data-gap="sm" :data-busy="review.loading.value ? 'true' : undefined">
      <div v-for="record in filtered" :key="String(record.id)" class="card">
        <button
          class="row-card"
          type="button"
          data-pressable="true"
          style="border: 0; padding: 0; background: transparent"
          :aria-label="`查看 ${record.visitorName} 的报名详情`"
          @click="openDetail(record)"
        >
          <span class="avatar" aria-hidden="true">{{ String(record.visitorName ?? t('s_18ko8bk')).slice(0, 1) }}</span>
          <span class="row-copy">
            <strong class="row-title">{{ record.visitorName }}</strong>
            <span class="row-meta">{{ `报名于 ${record.registrationTime}` }}</span>
            <span class="row-meta truncate">{{ truncate(record.summary, 34) }}</span>
          </span>
          <StatusTag :text="String(record.status || '')" :tone="statusTone(String(record.status || ''))" />
        </button>
        <div v-if="targetsFor(record).length > 0" class="grid-cols-2">
          <button
            v-for="target in targetsFor(record)"
            :key="target"
            class="cta"
            :class="{ ghost: target !== REGISTRATION_STATUS.APPROVED }"
            data-size="small"
            type="button"
            @click="target === REGISTRATION_STATUS.REJECTED ? askReject(record) : changeStatus(record, target)"
          >
            {{ targetLabel(target) }}
          </button>
        </div>
        <p v-else class="field-hint">
          {{ record.status === REGISTRATION_STATUS.ATTENDED ? t('s_159zzbg') : t('s_1e05tqn') }}
        </p>
      </div>
    </div>

    <button class="cta ghost" type="button" :disabled="filtered.length === 0" @click="exportCsv">
      <AppIcon name="download" size="icon icon-sm" />
      {{ t('s_1ogoh03') }}
    </button>
    <p class="field-hint text-center">{{ t('s_nsnwn6') }}</p>
  </template>
</template>
