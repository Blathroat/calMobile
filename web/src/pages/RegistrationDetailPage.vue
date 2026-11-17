<script setup lang="ts">
/**
 * 屏幕 08 · 报名详情
 *
 * 展商在展会设置里开启「启用报名二维码」后，审核通过的报名会由后端下发报名码，
 * 用户现场出示、展商扫码后状态变为「已参加」；二维码按需加载生成器，画不出来时
 * 就地说明改用手动输入，不让整页失败。
 *
 * 「修改报名」与「撤销报名」固定在页脚：撤销不可逆，走 confirmSheet 二次确认。
 *
 * **查询链接模式**（报名站 `/e/:id/status?token=`）：未登录报名的人没有账号可查，
 * 凭据在 `?token=` 里，页面走公开接口取数。未登录时页脚换成「登录 / 注册」，
 * 页面上多一张卡展示这条查询链接与「必须保存」的提示。已登录用户打开这种链接时
 * 先调认领接口把报名并进账号，再换成普通的详情页（页脚恢复修改 / 撤销）。
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

/** 查询链接的凭据。只有报名站的状态页会带 `?token=`；应用内不认这个参数。 */
const token = computed(() => (isJoinSurface ? String(route.query.token ?? '').trim() : ''));
/** 凭据就是身份：这一模式公开取数，未登录也能看自己的报名。 */
const tokenMode = computed(() => token.value !== '');
/** 认领失败的可见提示（例如报名已经属于别的账号）；仍留在本页看内容。 */
const claimError = ref('');
/** 认领是否已经发起过：登录态晚到、下拉刷新时都只做一次，避免重复请求。 */
let claimSettled = false;
/** 页脚：查询链接且未登录时换成登录 / 注册；其余情况保持原来的修改 / 撤销。 */
const footerShown = computed(() => !tokenMode.value || !session.loggedIn);
/** 查询链接本身：配了对外域名就拼公开地址，否则用当前页地址（浏览器里它就是可分享的那条）。 */
const queryLink = computed(() => {
  if (!tokenMode.value) return '';
  const base = registrationLink(bootstrap.publicBaseUrl, record.value?.exhibitionId);
  if (base) return `${base}/status?token=${encodeURIComponent(token.value)}`;
  return typeof window === 'undefined' ? '' : window.location.href;
});

const cancelled = computed(() => record.value?.statusCode === REGISTRATION_STATUS.CANCELLED);
/** 已参加是终态：后端不允许再撤销，按钮就不要画成可点的。 */
const attended = computed(() => record.value?.statusCode === REGISTRATION_STATUS.ATTENDED);
/** 注意事项只对审核通过 / 已参加展示；服务端也只在两种状态下下发正文，这里再兜一层。 */
const canSeeNotice = computed(() => {
  const status = String(record.value?.statusCode || '');
  return status === REGISTRATION_STATUS.APPROVED || status === REGISTRATION_STATUS.ATTENDED;
});
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
  void refresh();
});

usePullRefresh(
  () => refresh(),
  computed(() => query.loading.value && query.data.value !== undefined),
);

/**
 * 冷启动恢复登录态可能晚于本页挂载（浏览器里刷新令牌在本机，`bootApp()` 先恢复会话）：
 * 会话一变成已登录就补一次认领，否则用户带着登录态打开保存的链接会停在未登录版式上。
 */
watch(
  () => session.loggedIn,
  () => {
    void tryClaim();
  },
);

/** 取数后再尝试认领；下拉刷新也走这里（网络失败时能给一次重试机会）。 */
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

/** 认领只发起一次；查询链接 + 已登录 + 已经取到报名时才做。 */
async function tryClaim(): Promise<void> {
  if (claimSettled || !tokenMode.value || !session.loggedIn) return;
  if (query.data.value?.found !== true) return;
  await claim();
}

/**
 * 把查询链接对应的报名认领到当前账号。
 * 失败（已属于别的账号、与该账号已有报名冲突、凭据失效）时把服务端文案留在页面上，
 * 用户仍能继续看这条报名；不把他踢到别的页面。
 */
async function claim(): Promise<void> {
  claimSettled = true;
  claimError.value = '';
  try {
    const result = await api.registrations.claim(token.value);
    const id = String(result?.registration?.id || record.value?.id || '');
    if (id) {
      // 认领成功：报名已属于当前账号，换成登录后的详情页（页脚出现修改 / 撤销）。
      await router.replace(paths.registrationDetail(id));
      return;
    }
    claimError.value = t('registration.detail.claimFailed');
  } catch (reason) {
    claimError.value = reason instanceof Error ? reason.message : String(reason);
  }
}

/** 未登录状态页的登录 / 注册入口：带上当前完整地址，登录或注册后回到这一页并完成认领。 */
function goLogin(): void {
  void router.push({ path: '/login', query: { redirect: route.fullPath } });
}

function goRegister(): void {
  void router.push({ path: '/register', query: { redirect: route.fullPath } });
}

/** 复制查询链接：复制失败也要说清楚，不能静默。 */
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
    <!-- 认领失败（例如这条报名已经属于别的账号）：说明原因，内容照常展示 -->
    <p v-if="claimError" class="field-error reg-claim-error" role="alert">{{ claimError }}</p>

    <div class="card" data-tone="fill">
      <strong>{{ record.exhibitionTitle }}</strong>
      <span class="row-meta">{{ formatRecordDate(record) }} {{ record.exhibitionTime }}</span>
      <span class="row-meta">{{ record.exhibitionVenue }}</span>
    </div>

    <!-- 注意事项：展商在编辑展会时填的「注意事项」，只给审核通过 / 已参加的报名者看。 -->
    <div v-if="canSeeNotice && record.exhibitionNotice" class="card" data-action="registration-notice">
      <span class="section-label">{{ t('registration.detail.noticeTitle') }}</span>
      <p class="reg-notice-copy">{{ record.exhibitionNotice }}</p>
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

    <!-- 状态区：小标 → 大号状态词（按语义上色）→ 一行说明；不再重复一枚信号灯状态。 -->
    <div class="card">
      <span class="section-label">{{ t('exhibition.detail.currentStatus') }}</span>
      <strong class="reg-status-word" :data-tone="statusTone(String(record.statusCode || ''))">
        {{ registrationStatusLabel(String(record.statusCode || '')) }}
      </strong>
      <p class="reg-status-hint">{{ statusHint(record.statusCode) }}</p>
    </div>

    <!-- 查询链接：凭据只在这一条链接里，未登录时这是唯一能回来看状态的方式，必须提示保存 -->
    <div v-if="tokenMode" class="card" data-action="query-link-card">
      <span class="section-label">{{ t('registration.detail.queryLink') }}</span>
      <code class="reg-query-link">{{ queryLink }}</code>
      <button class="cta ghost" type="button" data-action="copy-query-link" @click="copyQueryLink">
        {{ t('registration.detail.copyQueryLink') }}
      </button>
      <p class="field-hint">{{ t('registration.detail.queryLinkHint') }}</p>
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

  <!-- 底部固定操作区：本人详情是「修改报名 + 撤销报名」；
       未登录从查询链接进来时换成「登录 + 注册」（都带回本页地址，登录后自动认领）。 -->
  <Teleport v-if="record && footerShown" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <!-- 未登录的查询链接：修改 / 撤销都要账号，先登录或注册 -->
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
        </template>
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

/* ── 查询链接（未登录报名后的唯一凭据） ───────────────────────── */

/* 链接很长（展会 id + 43 位凭据）：允许任意位置断行，不把卡片撑出屏幕。 */
.reg-query-link {
  color: var(--ink-2);
  font-size: var(--fs-meta);
  line-height: var(--lh-normal);
  overflow-wrap: anywhere;
  word-break: break-all;
  user-select: all;
  -webkit-user-select: all;
}

/* 认领失败的提示独立成行，与下面的卡片拉开一档。 */
.reg-claim-error {
  margin-bottom: var(--s3);
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

/* 注意事项正文：展商可能按条换行，保留换行比压成一段更易读。 */
.reg-notice-copy {
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--ink-2);
}
</style>
