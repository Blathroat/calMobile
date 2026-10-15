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
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { REGISTRATION_STATUS, statusTone } from '@/services/status';
import { answerDocument } from '@domain/answer-document';
import { formatMeetingWhen } from '@/services/format';
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
  return record && typeof record === 'object' ? record as JsonObject : undefined;
});
const answers = computed(() => answerDocument({ source: { text: meeting.value?.answers } }).lines);
const status = computed(() => String(meeting.value?.status || ''));
const pending = computed(() => status.value === REGISTRATION_STATUS.PENDING);
const approved = computed(() => status.value === REGISTRATION_STATUS.APPROVED);
const cancelled = computed(() => status.value === REGISTRATION_STATUS.CANCELLED);
const allowCancel = computed(() => meeting.value?.allowCancel === true);
const canCancel = computed(() => pending.value || (approved.value && allowCancel.value));

const COPY = {
  missingTitle: t('s_ayrmp1'),
  missingHint: t('s_1l0pgdi'),
  backToList: t('s_qdioah'),
  answers: t('s_vrp4t3'),
  emptyAnswers: t('s_jsf2l3'),
  status: t('s_c6rjk'),
  cancel: t('s_f6wghx'),
  cancelTitle: t('s_24n9uu'),
  confirm: t('s_zfeh7n'),
  pendingHint: t('s_e5loml'),
  approvedHint: t('s_vj0ed7'),
  approvedLocked: t('s_1d35a7g'),
  rejectedHint: t('s_1glfkb6'),
  cancelledHint: t('s_r6lbmi'),
  cancelFailed: t('s_qqaurb'),
  cancelDone: t('s_n7nxjq'),
};

function statusHint(): string {
  if (pending.value) return COPY.pendingHint;
  if (approved.value) return allowCancel.value ? COPY.approvedHint : COPY.approvedLocked;
  if (status.value === REGISTRATION_STATUS.REJECTED) return COPY.rejectedHint;
  if (cancelled.value) return COPY.cancelledHint;
  return COPY.approvedHint;
}

function load(): void {
  void query.run(() => api.meetings.get(String(route.params.id ?? '')));
}

onMounted(load);

function askCancel(): void {
  const item = meeting.value;
  if (!item || !canCancel.value) return;
  const name = String(item.exhibitorName || '');
  confirmSheet({
    title: COPY.cancelTitle,
    message: `确定撤销与「${name}」的这场会议吗？`,
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
        item.status = REGISTRATION_STATUS.CANCELLED;
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
    :title="t('s_kvpltc')"
    :description="query.error.value.message"
    :action-label="t('s_lswd2v')"
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
    <div class="card" data-tone="fill">
      <span class="name-line">
        <strong>{{ meeting.exhibitorName }}</strong>
        <RoleTag :role-code="String(meeting.exhibitorRole || '')" />
      </span>
      <span class="row-meta">{{ formatMeetingWhen(meeting.meetingDate, meeting.meetingTime) }}</span>
    </div>

    <div class="card">
      <span class="section-label">{{ COPY.answers }}</span>
      <div v-if="answers.length > 0" class="stack" data-gap="sm">
        <div v-for="(line, index) in answers" :key="`${line.label}-${index}`" class="row" data-between="true">
          <span class="row-meta">{{ line.label || t('s_otl7kf') }}</span>
          <span class="strong">{{ line.value || '—' }}</span>
        </div>
      </div>
      <p v-else class="row-meta">{{ COPY.emptyAnswers }}</p>
    </div>

    <div class="card">
      <span class="section-label">{{ COPY.status }}</span>
      <div class="row" data-gap="md">
        <StatusTag :text="status" :tone="statusTone(status)" />
        <span class="row-meta">{{ statusHint() }}</span>
      </div>
    </div>
  </template>

  <Teleport v-if="meeting" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <button class="cta danger" type="button" :disabled="!canCancel || cancelling" @click="askCancel">
          {{ cancelled ? REGISTRATION_STATUS.CANCELLED : COPY.cancel }}
        </button>
        <p class="field-hint text-center">{{ statusHint() }}</p>
      </div>
    </div>
  </Teleport>
</template>
