<script setup lang="ts">
/**
 * 私人会议详情。
 *
 * 和展会报名详情同一类页面：状态、时间、收集项，页脚可以撤销。
 * 待审核始终可以撤销；已通过要看主办人是否打开了「通过后允许撤销」。
 * 没有报名码，也没有修改入口。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { paths } from '@/app/surface';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { REGISTRATION_STATUS, registrationStatusLabel, statusTone } from '@/services/status';
import { answerDocument } from '@domain/answer-document';
import { formatMeetingWhen } from '@/services/format';
import AvatarBox from '@/components/AvatarBox.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const query = useAsync<JsonObject>();
const cancelling = ref(false);

const meeting = computed<JsonObject | undefined>(() => {
  const data = query.data.value;
  if (!data || data.found === false) return undefined;
  const record = data.meeting;
  return record && typeof record === 'object' ? (record as JsonObject) : undefined;
});
const answers = computed(() => answerDocument({ source: { text: meeting.value?.answers } }).lines);
const status = computed(() => String(meeting.value?.statusCode || ''));
const pending = computed(() => status.value === REGISTRATION_STATUS.PENDING);
const approved = computed(() => status.value === REGISTRATION_STATUS.APPROVED);
const cancelled = computed(() => status.value === REGISTRATION_STATUS.CANCELLED);
const allowCancel = computed(() => meeting.value?.allowCancel === true);
const canCancel = computed(() => pending.value || (approved.value && allowCancel.value));

const COPY = {
  missingTitle: t('meeting.detail.privateMeetingMissing'),
  missingHint: t('meeting.detail.meetingMaybeDeleted'),
  backToList: t('meeting.detail.backToMyActivities'),
  answers: t('exhibition.detail.registrationInfo'),
  emptyAnswers: t('meeting.detail.noOtherContent'),
  cancel: t('meeting.detail.cancelMeeting'),
  cancelTitle: t('meeting.detail.cancelThisMeeting'),
  confirm: t('exhibition.detail.confirmCancel'),
  pendingHint: t('meeting.detail.hostReviewPending'),
  approvedHint: t('meeting.detail.hostApproved'),
  approvedLocked: t('meeting.detail.approvedMeetingLocked'),
  rejectedHint: t('meeting.detail.hostRejected'),
  cancelledHint: t('meeting.detail.meetingAlreadyCancelled'),
  cancelFailed: t('exhibition.detail.cancelFailed'),
  cancelDone: t('meeting.detail.meetingCancelDone'),
};

function statusHint(): string {
  if (pending.value) return COPY.pendingHint;
  if (approved.value) return allowCancel.value ? COPY.approvedHint : COPY.approvedLocked;
  if (status.value === REGISTRATION_STATUS.REJECTED) return COPY.rejectedHint;
  if (cancelled.value) return COPY.cancelledHint;
  return COPY.approvedHint;
}

function load(): Promise<unknown> {
  return query.run(() => api.meetings.get(String(route.params.id ?? '')));
}

onMounted(() => {
  void load();
});

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && query.data.value !== undefined),
);

function askCancel(): void {
  const item = meeting.value;
  if (!item || !canCancel.value) return;
  const name = String(item.exhibitorName || '');
  confirmSheet({
    title: COPY.cancelTitle,
    message: t('meeting.detail.cancelConfirm', { name }),
    confirmLabel: COPY.confirm,
    tone: 'danger',
    onConfirm: async () => {
      cancelling.value = true;
      try {
        const result = await api.meetings.cancel(String(item.id));
        if (result?.ok === false) {
          toast(String(result.error || COPY.cancelFailed), 'error');
          return;
        }
        item.statusCode = REGISTRATION_STATUS.CANCELLED;
        toast(COPY.cancelDone, 'success');
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      } finally {
        cancelling.value = false;
      }
    },
  });
}
</script>

<template>
  <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="3" />
  <StateBlock
    v-else-if="query.error.value && !query.data.value"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <StateBlock
    v-else-if="!meeting"
    tone="error"
    icon="info"
    :title="COPY.missingTitle"
    :description="String(query.data.value?.error || COPY.missingHint)"
    :action-label="COPY.backToList"
    @action="router.push(paths.registrations)"
  />
  <template v-else>
    <!-- 抬头：信号灯 + 大号状态词 + 一行说明 -->
    <header class="meeting-head">
      <StatusTag :text="registrationStatusLabel(status)" :tone="statusTone(status)" />
      <h2 class="meeting-state">{{ registrationStatusLabel(status) }}</h2>
      <p class="meeting-hint">{{ statusHint() }}</p>
    </header>

    <!-- 明细收成一张卡三段：会议时间 / 对方名片 / 填写内容，段间一条发丝线 -->
    <div class="card meeting-card">
      <section class="meeting-block">
        <span class="section-label">{{ t('meeting.apply.time') }}</span>
        <p class="meeting-when">{{ formatMeetingWhen(meeting.meetingDate, meeting.meetingTime) }}</p>
      </section>

      <hr class="divider" />

      <section class="meeting-block meeting-person">
        <AvatarBox :name="String(meeting.exhibitorName || '')" />
        <span class="row-copy">
          <span class="name-line">
            <strong class="row-title truncate">{{ meeting.exhibitorName }}</strong>
            <RoleTag :role-code="String(meeting.exhibitorRole || '')" />
          </span>
        </span>
      </section>

      <hr class="divider" />

      <section class="meeting-block">
        <span class="section-label">{{ COPY.answers }}</span>
        <div v-if="answers.length > 0" class="stack" data-gap="sm">
          <div v-for="(line, index) in answers" :key="`${line.label}-${index}`" class="row" data-between="true">
            <span class="row-meta">{{ line.label || t('exhibition.detail.additionalInfo') }}</span>
            <span class="strong">{{ line.value || '—' }}</span>
          </div>
        </div>
        <p v-else class="row-meta">{{ COPY.emptyAnswers }}</p>
      </section>
    </div>
  </template>

  <Teleport v-if="meeting" defer to="#app-foot">
    <div class="page-foot">
      <button class="cta danger" type="button" :disabled="!canCancel || cancelling" @click="askCancel">
        {{ cancelled ? registrationStatusLabel(REGISTRATION_STATUS.CANCELLED) : COPY.cancel }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 抬头：信号灯在上，大号状态词为主，说明句跟在后面。 */
.meeting-head {
  display: grid;
  justify-items: start;
  gap: var(--s2);
}

.meeting-state {
  font-size: var(--fs-h2);
  font-weight: 700;
  line-height: var(--lh-tight);
}

.meeting-hint {
  color: var(--ink-2);
  font-size: var(--fs-meta);
}

/* 单卡三段：每段自己排，段与段之间由 hr.divider 断开。 */
.meeting-block {
  display: grid;
  gap: var(--s2);
}

.meeting-person {
  display: flex;
  align-items: center;
  gap: var(--s3);
}

/* 会议时间比说明句重一档：它是这一页的主角信息之一。 */
.meeting-when {
  font-size: var(--fs-h3);
  font-weight: 700;
  line-height: var(--lh-tight);
}

/* 收集项的值右对齐、允许换行，长答案不把卡片撑破。 */
.meeting-card .row > .strong {
  flex: 1 1 auto;
  min-width: 0;
  text-align: end;
  overflow-wrap: anywhere;
}

.meeting-card .row > .row-meta {
  flex: 0 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
