<script setup lang="ts">
/**
 * 屏幕 08 · 报名详情
 *
 * 展商在展会设置里开启「启用报名二维码」后，审核通过的报名会由后端下发报名码，
 * 用户现场出示、展商扫码后状态变为「已参加」；二维码按需加载生成器，画不出来时
 * 就地说明改用手动输入，不让整页失败。
 *
 * 「修改报名」与「撤销报名」固定在页脚：撤销不可逆，走 confirmSheet 二次确认。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { confirmSheet } from '@/services/sheet';
import { REGISTRATION_STATUS, registrationStatusLabel, roleLabel, statusTone } from '@/services/status';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import QrCanvas from '@/components/QrCanvas.vue';
import { answerDocument } from '@domain/answer-document';
import { formatRecordDate } from '@/services/format';
import type { Registration, RegistrationDetail } from '@/api/types';
import { paths } from '@/app/surface';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();

const query = useAsync<RegistrationDetail>();
const record = computed<Registration | undefined>(() => query.data.value?.registration);
const answers = computed(() => answerDocument({ source: { text: record.value?.answers } }).lines);

const cancelled = computed(() => record.value?.statusCode === REGISTRATION_STATUS.CANCELLED);
/** 已参加是终态：后端不允许再撤销，按钮就不要画成可点的。 */
const attended = computed(() => record.value?.statusCode === REGISTRATION_STATUS.ATTENDED);
const approved = computed(() => record.value?.statusCode === REGISTRATION_STATUS.APPROVED);
/** 已通过的报名还要看展商是否允许撤销。待审核不受这个开关影响。 */
const hostBlocksCancel = computed(() => approved.value && record.value?.allowCancel === false);
const canCancel = computed(() => !cancelled.value && !attended.value && !hostBlocksCancel.value);
const hostCancelHint = t('registration.detail.approvedCancelBlocked');
/** 待审核的报名始终可以改；其余状态由管理员的「是否需要重新审核」决定。 */
const canRevise = computed(
  () => bootstrap.review.canRevise === true || record.value?.statusCode === REGISTRATION_STATUS.PENDING,
);

const cancelling = ref(false);
/** 二维码绘制失败的原因：留在二维码旁边说明，同时给出手动输入的退路。 */
const qrError = ref('');

onMounted(() => {
  void load();
});

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && query.data.value !== undefined),
);

async function load(): Promise<void> {
  qrError.value = '';
  await query.run(() => api.registrations.get(String(route.params.id ?? '')));
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
        // 撤销是服务端已经完成的终态，就地更新本页状态与页脚；
        // 不重新取数：`registrations.get` 的缓存键（`registration:…`）不在 cancel 的失效前缀里。
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

/** 长按判定：按住约 550ms 触发；指头挪动超过 10px 视为滚屏 / 拖动，取消。 */
const HOLD_MS = 550;
const HOLD_MOVE_TOLERANCE = 10;
/** 保存中的 PNG 文件名；原生只拿它当展示名，落盘名由原生补全。 */
const QR_FILE_NAME = 'calmobile-qr.png';

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
  // 二维码本身没画出来时画布是空白的：不要存一张空白 PNG 还说保存成功。
  if (qrError.value) {
    toast(t('registration.detail.checkInQrSaveFailed'), 'error');
    return;
  }
  const dataUrl = qrRef.value?.toPngDataUrl() ?? '';
  if (!dataUrl) {
    toast(t('registration.detail.checkInQrSaveFailed'), 'error');
    return;
  }
  // 浏览器报名站 / 预览里没有原生桥：退回浏览器下载，不假装写进了相册。
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
    // 用户在系统面板里取消按稳定错误码判断，不匹配文案。
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    toast(t('registration.detail.checkInQrSaveFailed'), 'error');
  } finally {
    savingQr = false;
  }
}

/** 没有原生桥时的退路：交给浏览器下载。文件确实落地成 PNG，因此按保存成功提示。 */
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

  <!-- 报名可能刚被撤销或删除：说明原因并返回列表，重试没有意义 -->
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
    <div class="card" data-tone="fill">
      <strong>{{ record.exhibitionTitle }}</strong>
      <span class="row-meta">{{ formatRecordDate(record) }} {{ record.exhibitionTime }}</span>
      <span class="row-meta">{{ record.exhibitionVenue }}</span>
    </div>

    <div class="card">
      <span class="section-label">{{ t('exhibition.detail.registrationInfo') }}</span>
      <div class="stack info-rows" data-gap="sm">
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('registration.detail.registrant') }}</span>
          <span class="strong truncate">{{ record.visitorName || '—' }}</span>
        </div>
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('registration.detail.identity') }}</span>
          <span class="strong truncate">{{ roleLabel(String(record.visitorType || '')) || '—' }}</span>
        </div>
        <template v-if="answers.length > 0">
          <div v-for="(line, index) in answers" :key="`${line.label}-${index}`" class="row" data-between="true">
            <span class="row-meta">{{ line.label || t('exhibition.detail.additionalInfo') }}</span>
            <span class="strong">{{ line.value || '—' }}</span>
          </div>
        </template>
        <div v-else class="row" data-between="true">
          <span class="row-meta">{{ t('exhibition.detail.additionalInfo') }}</span>
          <span class="strong">{{ t('registration.detail.noCollectedInfo') }}</span>
        </div>
      </div>
    </div>

    <!-- 状态区：小标 → 大号状态词（按语义上色）→ 一行说明。
         状态词已经说明了参加状态，不再重复一颗信号灯。 -->
    <div class="card">
      <span class="section-label">{{ t('exhibition.detail.currentStatus') }}</span>
      <strong class="reg-status-word" :data-tone="statusTone(String(record.statusCode || ''))">
        {{ registrationStatusLabel(String(record.statusCode || '')) }}
      </strong>
      <p class="reg-status-hint">{{ statusHint(record.statusCode) }}</p>
    </div>

    <!-- 报名码：只有后端下发了 checkInCode（已通过 / 已参加且展商启用二维码）才渲染 -->
    <div v-if="record.checkInCode" class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('registration.detail.checkInCode') }}</span>
        <StatusTag
          :text="attended ? t('registration.detail.checkedIn') : t('registration.detail.pendingCheckIn')"
          :tone="attended ? 'ok' : 'pending'"
        />
      </div>
      <!-- 长按约 550ms 保存 PNG：pointerdown 起定时器，抬起 / 划走 / 挪动超阈值都取消；
           contextmenu.prevent 挡掉系统菜单，免得长按弹出「拷贝图片」把保存入口盖住。 -->
      <div
        class="qr-wrap qr-hold"
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
      <!-- 只在二维码画不出来时说明退路（让展商手动输入上方报名码），正常情况不再堆一句提示 -->
      <p v-if="qrError" class="field-hint text-center">
        {{ t('registration.detail.qrErrorHint', { error: qrError }) }}
      </p>
    </div>
  </template>

  <!-- 底部固定操作区：修改报名 + 撤销报名 -->
  <Teleport v-if="record" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
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
                ? REGISTRATION_STATUS.CANCELLED
                : attended
                  ? REGISTRATION_STATUS.ATTENDED
                  : t('registration.detail.cancelRegistration')
            }}
          </button>
        </div>
        <p class="field-hint text-center">
          {{
            cancelled
              ? t('registration.detail.cancelledLeavesReview')
              : attended
                ? t('registration.detail.attendedCannotCancel')
                : hostBlocksCancel
                  ? hostCancelHint
                  : t('registration.detail.reapplyToAttend')
          }}
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* 长按保存的命中区：长按时不要选中文字，也别让内核把它当成双击缩放 */
.qr-hold {
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
</style>

<style scoped>
/* ── 状态区 ───────────────────────────────────────────────────── */

/* 大号状态词：字号抬到 h1、字重 700，颜色只取语义色。 */
.reg-status-word {
  color: var(--ink);
  font-size: var(--fs-h1);
  font-weight: 700;
  line-height: 1.2;
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
  font-size: var(--fs-meta);
}

/* ── 报名信息 ─────────────────────────────────────────────────── */

/* 「标签 / 值」逐条排列：标签不压缩，值可能很长，允许断行并右对齐，不把卡片撑宽。 */
.info-rows .row {
  align-items: flex-start;
}

.info-rows .row > .row-meta {
  flex: none;
}

.info-rows .row > .strong {
  min-width: 0;
  max-width: 66%;
  text-align: end;
  overflow-wrap: anywhere;
}
</style>
