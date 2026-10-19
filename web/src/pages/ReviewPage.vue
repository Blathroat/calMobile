<script setup lang="ts">
/**
 * 屏幕 13 · 报名管理 / 审核
 *
 * 状态为待审核 / 已通过 / 已拒绝 / 已参加；展商能否重新审核由管理员设置决定
 * （`bootstrap.review.canRevise`），管理员自己不受该开关限制。
 * 「已参加」退回另有一条策略（`bootstrap.review.canReviseAttended`，默认关闭）。
 *
 * 筛选切换只改本地状态并复用已取到的数据：分段上的数量与顶部统计都从这一份记录算出来，
 * 切筛选不重新取数，也不清空上一份结果（只在原位标记忙碌）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import type { SheetAction } from '@/services/sheet';
import { device } from '@/services/device-services';
import {
  FILTER_ALL,
  REGISTRATION_STATUS,
  REVIEW_FILTERS,
  exhibitionStatusLabel,
  registrationStatusLabel,
  statusTone,
} from '@/services/status';
import { answerDocument } from '@domain/answer-document';
import { truncate } from '@/services/format';
import SegControl from '@/components/SegControl.vue';
import AppIcon from '@/components/AppIcon.vue';
import RegistrationDetailSheet from '@/components/RegistrationDetailSheet.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import type { Exhibition, Registration, ReviewList } from '@/api/types';
import { t } from '@/i18n';

const COPY = {
  /** 详情面板里的主按钮：详情只读，点它才进状态选择。 */
  adjustStatus: t('admin.users.adjustStatus'),
  detail: t('registration.review.viewDetail'),
};

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
const filterItems = computed(() =>
  REVIEW_FILTERS.map((value) => ({
    value,
    label: `${value === FILTER_ALL ? t('common.all') : registrationStatusLabel(value)} ${countOf(value)}`,
  })),
);

/** 当前筛选下的记录：`全部` 不过滤，其余按状态。 */
const filtered = computed<Registration[]>(() =>
  filter.value === FILTER_ALL ? records.value : records.value.filter((item) => item.statusCode === filter.value),
);

const pendingCount = computed(() => countOf(REGISTRATION_STATUS.PENDING));

function countOf(status: string): number {
  const known = status === FILTER_ALL ? counts.value.total : counts.value[status];
  if (typeof known === 'number') return known;
  if (status === FILTER_ALL) return records.value.length;
  return records.value.filter((item) => item.statusCode === status).length;
}

// ── 取数 ─────────────────────────────────────────────────────────

function loadExhibitions(): Promise<unknown> {
  return list.run(() => api.exhibitions.list());
}

function load(): Promise<unknown> {
  if (!exhibitionId.value) return loadExhibitions();
  return review.run(() => api.review.list({ exhibitionId: exhibitionId.value }));
}

onMounted(() => {
  void load();
});

usePullRefresh(
  () => load(),
  computed(() =>
    exhibitionId.value ? review.loading.value && hasRecords.value : list.loading.value && list.data.value !== undefined,
  ),
);

// ── 审核动作 ─────────────────────────────────────────────────────

/**
 * 可选动作必须与后端状态机一致（`server/src/routes/review-hono.ts` 的
 * REGISTRATION_TRANSITIONS）：已参加可以退回已通过 / 已拒绝，但默认关闭，
 * 只有管理员或 `canReviseAttended` 打开时展商才看得到入口；展商在
 * 「允许修改已通过或已拒绝的报名」关闭时不能动已审核的记录，管理员不受该策略限制，
 * 但仍受状态机限制。
 */
const TRANSITIONS: Record<string, string[]> = {
  [REGISTRATION_STATUS.PENDING]: [REGISTRATION_STATUS.APPROVED, REGISTRATION_STATUS.REJECTED],
  [REGISTRATION_STATUS.APPROVED]: [REGISTRATION_STATUS.ATTENDED, REGISTRATION_STATUS.REJECTED],
  [REGISTRATION_STATUS.REJECTED]: [REGISTRATION_STATUS.APPROVED],
  [REGISTRATION_STATUS.CANCELLED]: [REGISTRATION_STATUS.APPROVED],
};

function targetsFor(record: Registration): string[] {
  const status = String(record.statusCode ?? '');
  // 已参加不是终态，但默认只有管理员能动：管理员没打开 canReviseAttended 时
  // 展商看不到「调整状态」（详情里的 attendedLocked 提示仍会说明原因）。
  if (status === REGISTRATION_STATUS.ATTENDED) {
    return isAdmin.value || bootstrap.review.canReviseAttended === true
      ? [REGISTRATION_STATUS.APPROVED, REGISTRATION_STATUS.REJECTED]
      : [];
  }
  const reviewed = status !== REGISTRATION_STATUS.PENDING;
  const mayRevise = isAdmin.value || !reviewed || bootstrap.review.canRevise === true;
  return mayRevise ? (TRANSITIONS[status] ?? []) : [];
}

function canMarkAttended(record: Registration): boolean {
  return targetsFor(record).includes(REGISTRATION_STATUS.ATTENDED);
}

function targetLabel(target: string): string {
  if (target === REGISTRATION_STATUS.APPROVED) return t('registration.review.approve');
  if (target === REGISTRATION_STATUS.REJECTED) return t('registration.review.reject');
  return t('registration.review.markAttended');
}

function statusMessage(status: string): string {
  if (status === REGISTRATION_STATUS.APPROVED) return t('registration.review.approvedToast');
  if (status === REGISTRATION_STATUS.REJECTED) return t('registration.review.rejectedToast');
  return t('review.page.markedStatus', { status: registrationStatusLabel(status) });
}

/**
 * 报名详情：结构化面板（状态 / 时间 / 收集项分组），而不是把内容拼成一段文字。
 *
 * 状态动作放在同一面板的按钮里：详情只读，改状态要先点「调整状态」——
 * 动作数量随状态机变化，摆在详情里会让面板忽长忽短。
 */
function openVisitor(record: Registration): void {
  const id = String(record.visitorId || '');
  if (!id) return;
  const nickname = String(record.visitorName || 'user');
  void router.push({
    path: `/user-public/${encodeURIComponent(nickname)}`,
    query: { userId: id },
  });
}

function openDetail(record: Registration): void {
  const answers = answerDocument({ source: { text: record.answers } }).lines;
  const targets = targetsFor(record);
  const hint =
    record.statusCode === REGISTRATION_STATUS.ATTENDED
      ? t('registration.review.attendedLocked')
      : t('registration.review.reviseDenied');
  const actions: SheetAction[] = [];
  if (targets.length > 0) {
    actions.push({
      label: COPY.adjustStatus,
      variant: 'primary',
      onClick: (close) => {
        close();
        openActions(record);
      },
    });
  }
  actions.push({ label: t('common.close'), onClick: (close) => close() });
  openSheet({
    title: String(record.visitorName ?? ''),
    // 收集项可能很多，用高面板并让内容自己滚动。
    size: 'full',
    component: RegistrationDetailSheet,
    props: {
      status: registrationStatusLabel(String(record.statusCode ?? '')),
      statusTone: statusTone(String(record.statusCode ?? '')),
      registrationTime: String(record.registrationTime ?? ''),
      answers: answers.map((line) => ({
        label: line.label || t('exhibition.detail.additionalInfo'),
        value: line.value || '—',
      })),
      hint: targets.length > 0 ? '' : hint,
    },
    actions,
  });
}

/** 状态动作面板：可选动作与后端状态机一致，拒绝走二次确认。 */
function openActions(record: Registration): void {
  const targets = targetsFor(record);
  if (targets.length === 0) {
    toast(t('registration.review.reviseDenied'), 'error');
    return;
  }
  openSheet({
    title: t('registration.review.status'),
    message: t('review.page.currentStatus', { status: registrationStatusLabel(String(record.statusCode ?? '')) }),
    // 与用户状态面板同一套排布：选项竖排，选中/主推动作一眼可辨。
    layout: 'stack',
    actions: targets
      .map((target): SheetAction => ({
        label: targetLabel(target),
        variant: target === REGISTRATION_STATUS.APPROVED ? 'primary' : 'ghost',
        onClick: async (close) => {
          close();
          if (target === REGISTRATION_STATUS.REJECTED) askReject(record);
          else await changeStatus(record, target);
        },
      }))
      .concat([{ label: t('common.cancel'), onClick: (close) => close() }]),
  });
}

async function changeStatus(record: Registration, status: string): Promise<void> {
  try {
    const result = await api.review.updateStatus(String(record.id), status);
    if (result?.ok !== true) {
      toast(String(result?.error || t('admin.users.updateFailed')), 'error');
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
    title: t('registration.review.reject'),
    message: t('review.page.rejectConfirm', { name: String(record.visitorName ?? '') }),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('registration.review.reject'),
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
    [
      t('registration.detail.registrant'),
      t('registration.detail.registeredAt'),
      t('admin.exhibitions.status'),
      t('registration.review.filledAnswers'),
    ],
    ...filtered.value.map((record) => [
      String(record.visitorName ?? ''),
      String(record.registrationTime ?? ''),
      registrationStatusLabel(String(record.statusCode ?? '')),
      String(record.answers ?? '').replace(/\n/g, ' '),
    ]),
  ];
  // 带 BOM，Excel 打开中文表头才不会乱码。
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const filename = `registrations-${exhibitionId.value || 'all'}.csv`;
  try {
    await device.exportCsv(filename, content);
    toast(t('review.page.exportDone', { count: filtered.value.length, file: filename }), 'success');
  } catch (reason) {
    // 用户在系统保存框点了取消：按码判断，不给红色错误，只说明没有导出。
    if (reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled') {
      toast(t('admin.exhibitions.exportCancelled'));
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
        <h2>{{ t('registration.review.title') }}</h2>
      </div>
      <span class="pill">{{ t('review.page.exhibitionCount', { count: exhibitions.length }) }}</span>
    </header>

    <SkeletonBlock v-if="list.loading.value && list.data.value === undefined" :rows="2" />
    <StateBlock
      v-else-if="list.error.value && list.data.value === undefined"
      tone="error"
      :title="t('common.loadFailed')"
      :description="list.error.value.message"
      :action-label="t('common.retry')"
      @action="loadExhibitions"
    />
    <template v-else>
      <span class="section-label">{{ t('registration.review.chooseExhibition') }}</span>
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
            <span class="row-meta">{{
              t('review.page.exhibitionMeta', {
                date: String(item.dateLabel ?? ''),
                count: String(item.registrationCount ?? 0),
              })
            }}</span>
          </span>
          <StatusTag
            :text="exhibitionStatusLabel(String(item.statusCode || ''))"
            :tone="statusTone(String(item.statusCode || ''))"
          />
        </button>
      </div>
    </template>
  </template>

  <template v-else>
    <div class="row" data-between="true">
      <div class="stack" data-gap="sm">
        <span class="eyebrow">{{ bootstrap.brand.en }}</span>
        <h2>{{ t('registration.review.title') }}</h2>
      </div>
      <span class="pill">{{ t('review.page.pendingCount', { count: pendingCount }) }}</span>
    </div>

    <SegControl v-model="filter" :items="filterItems" :label="t('registration.review.status')" />

    <SkeletonBlock v-if="reviewLoading" :rows="3" />

    <StateBlock
      v-else-if="review.error.value && !hasRecords"
      tone="error"
      :title="t('registration.review.listLoadFailed')"
      :description="review.error.value.message"
      :action-label="t('common.retry')"
      @action="refresh"
    />

    <!-- 切换筛选时旧结果留在原位，只标记忙碌，不清空 -->
    <div v-if="review.error.value && hasRecords" class="notice" data-tone="accent">
      <span>{{ review.error.value.message }}</span>
    </div>

    <StateBlock
      v-else-if="filtered.length === 0"
      icon="ticket"
      :title="t('review.page.emptyTitle', { scope: filter === FILTER_ALL ? '' : registrationStatusLabel(filter) })"
      :description="t('registration.review.emptyHint')"
    />

    <div v-else class="list" data-gap="sm" :data-busy="review.loading.value ? 'true' : undefined">
      <div v-for="record in filtered" :key="String(record.id)" class="card">
        <div class="row" data-gap="md">
          <button
            v-if="record.visitorId"
            class="avatar"
            type="button"
            :aria-label="t('review.page.viewProfile', { name: String(record.visitorName ?? '') })"
            @click="openVisitor(record)"
          >
            {{ String(record.visitorName ?? t('registration.review.initialFallback')).slice(0, 1) }}
          </button>
          <span v-else class="avatar" aria-hidden="true">{{
            String(record.visitorName ?? t('registration.review.initialFallback')).slice(0, 1)
          }}</span>
          <button
            class="row-card"
            type="button"
            data-pressable="true"
            style="flex: 1 1 auto; min-width: 0; border: 0; padding: 0; background: transparent"
            :aria-label="t('review.page.viewDetail', { name: String(record.visitorName ?? '') })"
            @click="openDetail(record)"
          >
            <span class="row-copy">
              <span class="name-line">
                <strong class="row-title">{{ record.visitorName }}</strong>
                <RoleTag :role-code="String(record.visitorRole || '')" />
              </span>
              <span class="row-meta">{{
                t('review.page.registeredAt', { time: String(record.registrationTime ?? '') })
              }}</span>
              <span class="row-meta truncate">{{ truncate(record.summary, 34) }}</span>
            </span>
            <StatusTag
              :text="registrationStatusLabel(String(record.statusCode || ''))"
              :tone="statusTone(String(record.statusCode || ''))"
            />
          </button>
        </div>
        <div v-if="record.statusCode === REGISTRATION_STATUS.PENDING" class="action-row">
          <button
            class="cta"
            data-size="small"
            type="button"
            @click="changeStatus(record, REGISTRATION_STATUS.APPROVED)"
          >
            {{ t('registration.review.approve') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" @click="askReject(record)">
            {{ t('registration.review.reject') }}
          </button>
        </div>
        <div v-else class="action-row">
          <button
            v-if="canMarkAttended(record)"
            class="cta ghost"
            data-size="small"
            type="button"
            @click="changeStatus(record, REGISTRATION_STATUS.ATTENDED)"
          >
            {{ t('registration.review.markAttended') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" @click="openDetail(record)">
            {{ COPY.detail }}
          </button>
        </div>
      </div>
    </div>

    <button class="cta ghost" type="button" :disabled="filtered.length === 0" @click="exportCsv">
      <AppIcon name="download" size="icon icon-sm" />
      {{ t('admin.exhibitions.exportCsv') }}
    </button>
  </template>
</template>
