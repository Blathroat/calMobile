<script setup lang="ts">
/**
 * 屏幕 08 · 报名详情（含工业登机牌式核销凭证与免登录查询链接模式）
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { copyText } from '@/services/clipboard';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { confirmSheet } from '@/services/sheet';
import { REGISTRATION_STATUS, registrationStatusLabel, roleLabel, statusTone } from '@/services/status';
import AppIcon from '@/components/AppIcon.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import QrCanvas from '@/components/QrCanvas.vue';
import { answerDocument } from '@domain/answer-document';
import { formatRecordDate } from '@/services/format';
import type { Registration, RegistrationDetail } from '@/api/types';
import { isJoinSurface, paths } from '@/app/surface';
import { registrationLink } from '@/services/registration-link';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

const query = useAsync<RegistrationDetail>();
const record = computed<Registration | undefined>(() => query.data.value?.registration);
const answers = computed(() => answerDocument({ source: { text: record.value?.answers } }).lines);

const token = computed(() => (isJoinSurface ? String(route.query.token ?? '').trim() : ''));
const tokenMode = computed(() => token.value !== '');
const claimError = ref('');
let claimSettled = false;
const footerShown = computed(() => !tokenMode.value || !session.loggedIn);
const queryLink = computed(() => {
  if (!tokenMode.value) return '';
  const base = registrationLink(bootstrap.publicBaseUrl, record.value?.exhibitionId);
  if (base) return `${base}/status?token=${encodeURIComponent(token.value)}`;
  return typeof window === 'undefined' ? '' : window.location.href;
});

const cancelled = computed(() => record.value?.statusCode === REGISTRATION_STATUS.CANCELLED);
const attended = computed(() => record.value?.statusCode === REGISTRATION_STATUS.ATTENDED);
const canSeeNotice = computed(() => {
  const status = String(record.value?.statusCode || '');
  return status === REGISTRATION_STATUS.APPROVED || status === REGISTRATION_STATUS.ATTENDED;
});
const approved = computed(() => record.value?.statusCode === REGISTRATION_STATUS.APPROVED);
const hostBlocksCancel = computed(() => approved.value && record.value?.allowCancel === false);
const canCancel = computed(() => !cancelled.value && !attended.value && !hostBlocksCancel.value);
const hostCancelHint = t('registration.detail.approvedCancelBlocked');
const canRevise = computed(
  () => bootstrap.review.canRevise === true || record.value?.statusCode === REGISTRATION_STATUS.PENDING,
);

const cancelling = ref(false);
const qrError = ref('');

onMounted(() => {
  void refresh();
});

usePullRefresh(
  () => refresh(),
  computed(() => query.loading.value && query.data.value !== undefined),
);

watch(
  () => session.loggedIn,
  () => {
    void tryClaim();
  },
);

async function refresh(): Promise<void> {
  await load();
  await tryClaim();
}

async function load(): Promise<void> {
  qrError.value = '';
  if (tokenMode.value) {
    claimError.value = '';
    claimSettled = false;
    await query.run(() => api.registrations.queryByToken(token.value));
    return;
  }
  await query.run(() => api.registrations.get(String(route.params.id ?? '')));
}

async function tryClaim(): Promise<void> {
  if (claimSettled || !tokenMode.value || !session.loggedIn) return;
  if (query.data.value?.found !== true) return;
  await claim();
}

async function claim(): Promise<void> {
  claimSettled = true;
  claimError.value = '';
  try {
    const result = await api.registrations.claim(token.value);
    const id = String(result?.registration?.id || record.value?.id || '');
    if (id) {
      await router.replace(paths.registrationDetail(id));
      return;
    }
    claimError.value = t('registration.detail.claimFailed');
  } catch (reason) {
    claimError.value = reason instanceof Error ? reason.message : String(reason);
  }
}

function goLogin(): void {
  void router.push({ path: '/login', query: { redirect: route.fullPath } });
}

function goRegister(): void {
  void router.push({ path: '/register', query: { redirect: route.fullPath } });
}

async function copyQueryLink(): Promise<void> {
  const ok = queryLink.value ? await copyText(queryLink.value) : false;
  toast(
    ok ? t('registration.detail.queryLinkCopied') : t('registration.detail.queryLinkCopyFailed'),
    ok ? 'success' : 'error',
  );
}

function statusHint(status: unknown): string {
  if (status === REGISTRATION_STATUS.PENDING) return t('registration.detail.pendingExhibitorReview');
  if (status === REGISTRATION_STATUS.APPROVED) {
    return bootstrap.review.canRevise === true
      ? t('registration.detail.reviewStillEditable')
      : t('registration.detail.reviewFinished');
  }
  if (status === REGISTRATION_STATUS.ATTENDED) return t('registration.detail.checkInWish');
  if (status === REGISTRATION_STATUS.CANCELLED) return t('registration.detail.cancelledByYou');
  return t('registration.detail.contactExhibitor');
}

function modifyRegistration(): void {
  const item = record.value;
  if (!item) return;
  void router.push({
    path: paths.registrationForm(String(item.exhibitionId)),
    query: { registrationId: item.id },
  });
}

function askCancel(): void {
  const item = record.value;
  if (!item) return;
  confirmSheet({
    title: t('registration.detail.cancelRegistration'),
    message: t('registration.detail.cancelConfirmMessage', { title: String(item.exhibitionTitle ?? '') }),
    confirmLabel: t('exhibition.detail.confirmCancel'),
    tone: 'danger',
    onConfirm: async () => {
      cancelling.value = true;
      try {
        const result = await api.registrations.cancel(String(item.id));
        if (!result?.ok) {
          toast(String(result?.error || t('exhibition.detail.cancelFailed')), 'error');
          return;
        }
        item.statusCode = REGISTRATION_STATUS.CANCELLED;
        toast(t('registration.detail.registrationCancelled'), 'success');
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      } finally {
        cancelling.value = false;
      }
    },
  });
}

// ── 长按保存报名二维码 ─────────────────────────────────────────

const HOLD_MS = 550;
const HOLD_MOVE_TOLERANCE = 10;
const QR_FILE_NAME = 'check-in-qr.png';

const qrRef = ref<InstanceType<typeof QrCanvas> | null>(null);
let holdTimer = 0;
let holdOrigin = { x: 0, y: 0 };
let savingQr = false;

function cancelQrHold(): void {
  if (!holdTimer) return;
  window.clearTimeout(holdTimer);
  holdTimer = 0;
}

function startQrHold(event: PointerEvent): void {
  if (savingQr) return;
  cancelQrHold();
  holdOrigin = { x: event.clientX, y: event.clientY };
  holdTimer = window.setTimeout(() => {
    holdTimer = 0;
    void saveCheckInQr();
  }, HOLD_MS);
}

function moveQrHold(event: PointerEvent): void {
  if (!holdTimer) return;
  const dx = event.clientX - holdOrigin.x;
  const dy = event.clientY - holdOrigin.y;
  if (Math.hypot(dx, dy) > HOLD_MOVE_TOLERANCE) cancelQrHold();
}

async function saveCheckInQr(): Promise<void> {
  if (savingQr) return;
  if (qrError.value) {
    toast(t('registration.detail.checkInQrSaveFailed'), 'error');
    return;
  }
  const dataUrl = qrRef.value?.toPngDataUrl() ?? '';
  if (!dataUrl) {
    toast(t('registration.detail.checkInQrSaveFailed'), 'error');
    return;
  }
  if (!nativeBridge.hasNative()) {
    downloadQr(dataUrl);
    return;
  }
  savingQr = true;
  try {
    const result = await device.saveImage(dataUrl, QR_FILE_NAME);
    if (result?.saved === false) {
      toast(t('registration.detail.checkInQrSaveFailed'), 'error');
      return;
    }
    toast(t('registration.detail.checkInQrSaved'), 'success');
  } catch (reason) {
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    toast(t('registration.detail.checkInQrSaveFailed'), 'error');
  } finally {
    savingQr = false;
  }
}

function downloadQr(dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = QR_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast(t('registration.detail.checkInQrSaved'), 'success');
}

onBeforeUnmount(cancelQrHold);
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
    v-else-if="!record"
    tone="error"
    icon="info"
    :title="t('registration.detail.registrationMissing')"
    :description="String(query.data.value?.error || t('registration.detail.recordMaybeCancelled'))"
    :action-label="t('registration.detail.backToList')"
    @action="router.push(paths.registrations)"
  />

  <template v-else>
    <p v-if="claimError" class="field-error reg-claim-error" role="alert">{{ claimError }}</p>

    <!-- 展会摘要铭牌 -->
    <div class="card reg-summary-card">
      <div class="reg-summary-head">
        <span class="reg-summary-icon" aria-hidden="true"><AppIcon name="ticket" /></span>
        <strong class="reg-summary-title">{{ record.exhibitionTitle }}</strong>
      </div>
      <div class="reg-summary-meta">
        <span class="row-meta">{{ formatRecordDate(record) }} {{ record.exhibitionTime }}</span>
        <span class="row-meta">{{ record.exhibitionVenue }}</span>
      </div>
    </div>

    <!-- 状态指示卡 -->
    <div class="card reg-status-card" :data-tone-border="statusTone(String(record.statusCode || ''))">
      <span class="section-label">{{ t('exhibition.detail.currentStatus') }}</span>
      <strong class="reg-status-word" :data-tone="statusTone(String(record.statusCode || ''))">
        {{ registrationStatusLabel(String(record.statusCode || '')) }}
      </strong>
      <p class="reg-status-hint">{{ statusHint(record.statusCode) }}</p>
    </div>

    <!-- 注意事项 -->
    <div v-if="canSeeNotice && record.exhibitionNotice" class="card" data-action="registration-notice">
      <span class="section-label">{{ t('registration.detail.noticeTitle') }}</span>
      <p class="reg-notice-copy">{{ record.exhibitionNotice }}</p>
    </div>

    <!-- 报名码：工业登机牌式核销票根 -->
    <div v-if="record.checkInCode" class="card pass-ticket-card">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('registration.detail.checkInCode') }}</span>
        <StatusTag
          :text="attended ? t('registration.detail.checkedIn') : t('registration.detail.pendingCheckIn')"
          :tone="attended ? 'ok' : 'pending'"
        />
      </div>
      <div class="pass-perforation" aria-hidden="true" />
      <div
        class="qr-wrap qr-hold pass-qr-stage"
        data-action="check-in-qr"
        @pointerdown="startQrHold"
        @pointerup="cancelQrHold"
        @pointercancel="cancelQrHold"
        @pointerleave="cancelQrHold"
        @pointermove="moveQrHold"
        @contextmenu.prevent
      >
        <QrCanvas
          ref="qrRef"
          :text="String(record.checkInCode)"
          :size="480"
          :label="t('registration.detail.checkInQr')"
          @error="qrError = $event"
        />
      </div>
      <p class="field-hint text-center">{{ t('registration.detail.checkInQrLongPress') }}</p>
      <code class="qr-code-text">{{ record.checkInCode }}</code>
      <p v-if="qrError" class="field-hint text-center">
        {{ t('registration.detail.qrErrorHint', { error: qrError }) }}
      </p>
    </div>

    <!-- 报名填写信息 -->
    <div class="card">
      <span class="section-label">{{ t('exhibition.detail.registrationInfo') }}</span>
      <div class="stack info-rows" data-gap="sm">
        <div class="row info-line" data-between="true">
          <span class="row-meta">{{ t('registration.detail.registrant') }}</span>
          <span class="strong truncate">{{ record.visitorName || '—' }}</span>
        </div>
        <div class="row info-line" data-between="true">
          <span class="row-meta">{{ t('registration.detail.identity') }}</span>
          <span class="strong truncate">{{ roleLabel(String(record.visitorType || '')) || '—' }}</span>
        </div>
        <template v-if="answers.length > 0">
          <div
            v-for="(line, index) in answers"
            :key="`${line.label}-${index}`"
            class="row info-line"
            data-between="true"
          >
            <span class="row-meta">{{ line.label || t('exhibition.detail.additionalInfo') }}</span>
            <span class="strong">{{ line.value || '—' }}</span>
          </div>
        </template>
        <div v-else class="row info-line" data-between="true">
          <span class="row-meta">{{ t('exhibition.detail.additionalInfo') }}</span>
          <span class="strong">{{ t('registration.detail.noCollectedInfo') }}</span>
        </div>
      </div>
    </div>

    <!-- 查询链接（免登录凭据） -->
    <div v-if="tokenMode" class="card" data-action="query-link-card">
      <span class="section-label">{{ t('registration.detail.queryLink') }}</span>
      <code class="reg-query-link">{{ queryLink }}</code>
      <button class="cta ghost" type="button" data-action="copy-query-link" @click="copyQueryLink">
        {{ t('registration.detail.copyQueryLink') }}
      </button>
      <p class="field-hint">{{ t('registration.detail.queryLinkHint') }}</p>
    </div>
  </template>

  <Teleport v-if="record && footerShown" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <template v-if="tokenMode">
          <div class="grid-cols-2">
            <button class="cta ghost" type="button" data-action="query-login" @click="goLogin">
              {{ t('auth.login.title') }}
            </button>
            <button class="cta" type="button" data-action="query-register" @click="goRegister">
              {{ t('auth.register.title') }}
            </button>
          </div>
          <p class="field-hint text-center">{{ t('registration.detail.loginToManageHint') }}</p>
        </template>
        <template v-else>
          <div class="grid-cols-2">
            <button
              class="cta ghost"
              type="button"
              :disabled="cancelled || !canRevise || cancelling"
              @click="modifyRegistration"
            >
              {{ t('registration.detail.changeRegistration') }}
            </button>
            <button class="cta danger" type="button" :disabled="!canCancel || cancelling" @click="askCancel">
              {{
                cancelled
                  ? t('status.registration.cancelled')
                  : attended
                    ? t('status.registration.attended')
                    : t('registration.detail.cancelRegistration')
              }}
            </button>
          </div>
          <p v-if="cancelled || attended || hostBlocksCancel" class="field-hint text-center">
            {{
              cancelled
                ? t('registration.detail.cancelledLeavesReview')
                : attended
                  ? t('registration.detail.attendedCannotCancel')
                  : hostCancelHint
            }}
          </p>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style>
.qr-hold {
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
</style>

<style scoped>
.reg-summary-card {
  gap: var(--s2);
}

.reg-summary-head {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.reg-summary-icon {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
  color: var(--ink-2);
}

.reg-summary-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-tight);
}

.reg-summary-meta {
  display: grid;
  gap: 2px;
}

.reg-status-word {
  color: var(--ink);
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: 1.25;
}

.reg-status-word[data-tone='ok'] {
  color: var(--ok-ink);
}

.reg-status-word[data-tone='pending'],
.reg-status-word[data-tone='warn'] {
  color: var(--warn-ink);
}

.reg-status-word[data-tone='danger'] {
  color: var(--danger-ink);
}

.reg-status-word[data-tone='info'] {
  color: var(--info-ink);
}

.reg-status-hint {
  color: var(--ink-2);
  font-size: var(--fs-xs);
}

.pass-ticket-card {
  position: relative;
  overflow: hidden;
}

.pass-perforation {
  height: 0;
  border-top: var(--hairline) dashed var(--stroke-strong);
}

.pass-qr-stage {
  padding: var(--s3);
}

.reg-query-link {
  padding: var(--s2) var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-chip);
  background: var(--f3);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-normal);
  overflow-wrap: anywhere;
  word-break: break-all;
  user-select: all;
  -webkit-user-select: all;
}

.reg-claim-error {
  margin-bottom: var(--s3);
}

.info-rows .info-line {
  align-items: flex-start;
  padding-block: 4px;
}

.info-rows .info-line + .info-line {
  border-top: var(--hairline) solid var(--stroke);
  padding-top: 8px;
}

.info-rows .row > .row-meta {
  flex: none;
}

.info-rows .row > .strong {
  min-width: 0;
  max-width: 68%;
  text-align: end;
  overflow-wrap: anywhere;
}

.reg-notice-copy {
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--ink-2);
}
</style>
