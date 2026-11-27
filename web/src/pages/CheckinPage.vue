<script setup lang="ts">
/**
 * 展商 · 核销报名码
 *
 * 展会在「编辑展会」里开启「是否启用报名二维码」后，报名审核通过的用户会在报名详情
 * 看到报名码。展商在本页用摄像头取景，由 Worker 中的 ZXing WASM 实时识别二维码，
 * 识别成功后调用 `checkin` 把报名状态改为「已参加」。
 *
 * 摄像头不可用（未授权、设备没有摄像头、内核不支持 getUserMedia）时保留两条降级链路：
 * 「选择图像扫码」把照片交给同一个解码器（应用里走原生 media.pickImage，浏览器里走 file input），
 * 「手动输入报名码」直接敲码。
 * 识别库按需加载，不拖慢启动，也只在真正进本页才拉取。
 * 离开页面一定要释放摄像头，否则后台会一直占用相机。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { REGISTRATION_STATUS, registrationStatusLabel } from '@/services/status';
import { readCheckinImageData } from '@/services/checkin-image';
import {
  MAX_CHECKIN_OUTCOMES,
  persistCheckinOutcomes,
  readCheckinOutcomes,
  type CheckInOutcome,
} from '@/services/checkin-outcomes';
import { useHint } from '@/composables/useHint';
import { useCheckinScanner } from '@/composables/useCheckinScanner';
import { answerDocument } from '@domain/answer-document';
import AppIcon from '@/components/AppIcon.vue';
import ManualCodePanel from '@/components/ManualCodePanel.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { ApiResult, JsonObject } from '@/api/types';
import { t } from '@/i18n';

/** 取景区只表达一件事：当前是取景、识别中，还是某一步失败 / 已停止。 */
type StageMode = 'idle' | 'live' | 'error' | 'stopped' | 'detected';

/** 列表里一行「标签 + 值」：收集项按行解析后逐行渲染。 */
interface OutcomeRow {
  item: CheckInOutcome;
  lines: Array<{ label: string; value: string }>;
}

const router = useRouter();
const session = useSessionStore();

/** 受限账号不能核销（后端 `POST /checkin` 直接 403）：整页换成说明，也不去加载识别库。 */
const limited = computed(() => session.limited === true);
const videoEl = ref<HTMLVideoElement>();
const canvasEl = ref<HTMLCanvasElement>();
const startButton = ref<HTMLButtonElement>();
/** 选择图像扫码用的隐藏文件输入框：靠用户手势里的 click() 拉起系统选择器。 */
const fileInput = ref<HTMLInputElement>();
/** 展商后台那条「怎么核销」的一次性提示：进过这一页就记为已读。 */
const { dismiss: dismissCheckinHint } = useHint('exhibitor-checkin');

const stageMode = ref<StageMode>('idle');
const stageTitle = ref(t('checkin.scan.ready'));
const stageDescription = ref(t('checkin.scan.startOrType'));

/** 状态区：行内提示（notice）、核销请求中的骨架、以及整段失败时的错误块。 */
const statusText = ref('');
const statusTone = ref<'neutral' | 'error'>('neutral');
const statusLoading = ref(false);
const verifyError = ref<{ title: string; description: string } | null>(null);

/**
 * 顶栏右上角的挂载点由外壳渲染（`App.vue` 的 `#app-top-actions`）。
 * 页面被单独挂载时（测试、嵌入式预览）没有这个节点：此时不投递，
 * 否则 Teleport 找不到目标会打断整棵组件树的 patch。
 */
const topActionsReady = ref(false);

/** 核销结果常驻列表：最新一条排最前，按当前用户分键持久化到本机。 */
const outcomes = ref<CheckInOutcome[]>([]);
/** 每条结果的收集项逐行：与 ReviewPage 共用 answerDocument，不再把整段塞进一个 span。 */
const outcomeRows = computed<OutcomeRow[]>(() =>
  outcomes.value.map((item) => ({ item, lines: answerLines(item.record) })),
);

function answerLines(record: JsonObject): Array<{ label: string; value: string }> {
  const text = String(record.answers ?? '');
  if (!text.trim()) return [];
  return answerDocument({ source: { text } }).lines;
}

function persistOutcomes(): void {
  persistCheckinOutcomes(session.user?.id, outcomes.value);
}

/** 换号时按新键重读，避免把上一个账号的记录留在屏幕上。 */
function loadOutcomes(): void {
  outcomes.value = readCheckinOutcomes(session.user?.id);
}

const submitting = ref(false);
/** 正在读图 / 解码：期间禁用「选择图像扫码」，避免并发解码互相顶掉结果。 */
const picking = ref(false);

/** 手动输入面板的数据：输入值与原位错误都放在这个响应式对象里（面板组件按引用读写）。 */
const manual = reactive({ code: '', error: '' });

/** 页面被替换后置为 false：异步步骤（权限、getUserMedia）回来时据此放弃取景。 */
let alive = true;

onMounted(() => {
  // 外壳的顶栏已经渲染：确认挂载点存在后才允许投递清理按钮。
  topActionsReady.value = document.getElementById('app-top-actions') !== null;
  // 先把本机留下的核销记录读回来，再决定要不要加载识别库。
  loadOutcomes();
  // 进到核销页就说明展商后台那条「怎么核销」的提示已经教到位了：不管从哪个入口进来
  // （后台按钮、深链、返回键回来）都把它记为已读，下次不再显示。
  void dismissCheckinHint();
  if (limited.value) return;
  scanner.initialize();
});

// 换号（含登录后会话落地）时按新用户的键重读历史，不把上一个账号的记录留在屏幕上。
watch(
  () => String(session.user?.id ?? ''),
  () => loadOutcomes(),
);

onBeforeUnmount(() => {
  alive = false;
  scanner.dispose();
});

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearStatus(): void {
  statusText.value = '';
  statusTone.value = 'neutral';
  statusLoading.value = false;
  verifyError.value = null;
}

function showNotice(text: string, tone: 'neutral' | 'error' = 'neutral'): void {
  clearStatus();
  statusText.value = text;
  statusTone.value = tone;
}

function showLoadingStatus(): void {
  clearStatus();
  statusLoading.value = true;
}

function showVerifyError(title: string, description: string): void {
  clearStatus();
  verifyError.value = { title, description };
}

function setStage(mode: StageMode, title: string, description: string): void {
  stageMode.value = mode;
  stageTitle.value = title;
  stageDescription.value = description;
}

const scanner = useCheckinScanner({
  videoEl,
  canvasEl,
  onCode: handleCode,
  setStage,
  showNotice,
  clearStatus,
});

function stageIcon(): string {
  return stageMode.value === 'detected' ? 'check' : 'image';
}

/**
 * 识别到的内容像不像报名码：报名码是竖线分隔的「前缀|展会|报名|凭据」格式。
 * 这里只做形状判断，前缀由服务器按实例配置，真正的校验交给核销接口；
 * 完全不像才提示「不是本应用的报名码」，避免把格式正确的码误判成垃圾内容。
 * @param raw 扫码 / 手动输入得到的原始文本
 */
function looksLikeCheckInCode(raw: string): boolean {
  const text = String(raw || '').trim();
  if (!text || /\s/.test(text)) return false;
  const parts = text.split('|');
  return parts.length >= 3 && parts[0] !== '' && parts[1] !== '';
}

/** 识别后的状态文案：格式对就说「正在核销」，格式不对才说不是本应用的码。 */
function previewOf(raw: string): string {
  return looksLikeCheckInCode(raw) ? t('checkin.verifying') : t('checkin.notAppCode');
}

// ── 取景与识别 ─────────────────────────────────────────────────

async function toggleScan(): Promise<void> {
  if (scanner.starting.value) return;
  if (scanner.scanning.value) {
    stopScan();
    return;
  }
  await scanner.start();
}

function stopScan(): void {
  scanner.releaseCamera();
  setStage('stopped', t('checkin.scan.stopped'), t('checkin.scan.resumeOrType'));
  clearStatus();
}

/** 识别到内容后先停止取景，避免同一张码被连续提交。 */
async function handleCode(raw: string): Promise<void> {
  if (submitting.value) return;
  scanner.releaseCamera();
  setStage('detected', t('checkin.scan.recognized'), previewOf(raw));
  await verify(raw);
}

// ── 选择图像扫码（照片里的报名码，摄像头打不开时的另一条路） ──────

/**
 * 选图总入口，分两条路：
 * - 有原生桥（Android 应用里）：走 device.pickImage —— 原生自己读相册并把图片压到
 *   最长边 <= 1080 的 JPEG，交回 dataUrl。WebView 关着 setAllowFileAccess / setAllowContentAccess，
 *   <input type=file> 拿到的 content:// URI 不保证读得到，所以真机上只走这条。
 * - 没有原生桥（浏览器预览 / 报名站）：用隐藏的 file input 选本地文件。
 * 两条路都汇到 useImageSource，缩放与解码只写一遍。
 */
function pickImage(): void {
  if (picking.value || scanner.starting.value) return;
  // 选图期间不再取景：相机一直占着会挡住系统选择器，也没必要同时解码两路。
  if (scanner.scanning.value) stopScan();
  else scanner.releaseCamera();
  if (nativeBridge.hasNative()) {
    void pickNativeImage();
    return;
  }
  fileInput.value?.click();
}

/** 原生通道：dataUrl 已经在设备上读过并缩过，这里只取像素。 */
async function pickNativeImage(): Promise<void> {
  if (picking.value) return;
  picking.value = true;
  try {
    let dataUrl = '';
    try {
      const result = await device.pickImage();
      if (!alive) return;
      dataUrl = String(result?.dataUrl ?? '');
    } catch (reason) {
      if (!alive) return;
      // 用户在系统相册里取消按稳定错误码判断，不匹配文案；取消保持静默。
      if ((reason as { code?: string } | null)?.code === 'cancelled') return;
      showNotice(t('checkin.scan.pickFailed'), 'error');
      return;
    }
    if (!dataUrl) {
      showNotice(t('checkin.scan.pickFailed'), 'error');
      return;
    }
    await useImageSource(dataUrl);
  } finally {
    if (alive) picking.value = false;
  }
}

async function onImageChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  // 清空才能连续选同一张图；用户取消选择时这里没有文件，静默返回。
  if (input) input.value = '';
  if (!file || !alive || picking.value) return;
  picking.value = true;
  try {
    await useImageSource(file);
  } finally {
    if (alive) picking.value = false;
  }
}

/** 两条选图路径共用：读取像素、等待解码器就绪，再核销或提示。 */
async function useImageSource(source: File | string): Promise<void> {
  // 解码可能要点时间，先用骨架行占位，避免看起来没反应。
  showLoadingStatus();
  let image: ImageData;
  try {
    image = await readCheckinImageData(source);
  } catch {
    if (alive) showNotice(t('checkin.scan.pickFailed'), 'error');
    return;
  }
  if (!alive) return;
  const found = await scanner.decodeImage(image);
  if (!alive || scanner.decoderFailed.value) return;
  if (!found) {
    // 没识别到是常见结果，用行内提示而不是错误块。
    showNotice(t('checkin.scan.pickEmpty'));
    return;
  }
  // 与摄像头识别同一条路：停取景、进入已识别、再核销。
  await handleCode(found);
}

// ── 核销 ───────────────────────────────────────────────────────

async function verify(raw: string): Promise<void> {
  submitting.value = true;
  showLoadingStatus();
  try {
    const response = await api.checkIn(raw);
    if (alive) renderResult(response);
  } catch (reason) {
    if (!alive) return;
    // 网络 / 服务异常不进历史：历史记的是「核销过谁」，不是每一次失败的请求。
    showVerifyError(t('checkin.verifyFailed'), reason instanceof Error ? reason.message : String(reason));
  } finally {
    if (alive) submitting.value = false;
  }
}

function renderResult(response: ApiResult): void {
  const ok = response?.ok === true;
  clearStatus();
  const record = (response?.record ?? {}) as JsonObject;
  // 接口下发的是状态 code；没有 code（老服务端或异常响应）时才退回通用文案。
  const statusCode = String(response?.statusCode ?? '');
  // 最新的排最前；本页只当现场记录用，超过上限就丢掉最旧的。
  outcomes.value = [
    {
      id: `${String(record.recordId ?? 'unknown')}-${Date.now()}-${outcomes.value.length}`,
      ok,
      statusText: statusCode ? registrationStatusLabel(statusCode) : t('checkin.notPassed'),
      message: String(response?.message || response?.error || ''),
      record,
    },
    ...outcomes.value,
  ].slice(0, MAX_CHECKIN_OUTCOMES);
  persistOutcomes();
  if (ok) toast(String(response?.message || t('checkin.succeeded')), 'success');
  else toast(String(response?.error || t('checkin.unsuccessful')), 'error');
}

function openReview(record: JsonObject): void {
  const exhibitionId = String(record.exhibitionId ?? '');
  void router.push(exhibitionId ? { path: '/review', query: { exhibitionId } } : { path: '/review' });
}

/** 继续核销：只清当前状态与错误，焦点回到扫码按钮；历史记录留着。 */
async function restart(): Promise<void> {
  clearStatus();
  await nextTick();
  startButton.value?.focus();
}

/** 顶栏清理图标：清空列表与本机存储，历史不再回来。 */
function clearOutcomes(): void {
  outcomes.value = [];
  persistOutcomes();
  toast(t('checkin.cleared'), 'success');
}

// ── 手动输入（摄像头 / 识别库不可用时的降级入口） ───────────────

/**
 * 手动输入面板走共享底部面板（`ManualCodePanel` 提供输入框）：
 * 校验失败就把错误写回 `manual.error` 并留在面板里，成功才关闭。
 */
function openManual(): void {
  stopScan();
  manual.code = '';
  manual.error = '';
  openSheet({
    title: t('checkin.manual.enterCode'),
    component: ManualCodePanel,
    props: {
      model: manual,
      hint: t('checkin.manual.copyOrType'),
    },
    size: 'full',
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('checkin.manual.checkIn'),
        variant: 'primary',
        onClick: (close) => {
          void submitManual(close);
        },
      },
    ],
  });
}

async function submitManual(close: () => void): Promise<void> {
  const code = manual.code.trim();
  if (!code) {
    // 留在面板里，让用户就地补上
    manual.error = t('checkin.manual.codeRequired');
    return;
  }
  close();
  setStage('detected', t('checkin.manual.submitted'), previewOf(code));
  await verify(code);
}
</script>

<template>
  <!-- 受限账号：说明原因并给出离开的入口，不渲染扫码与手动输入 -->
  <StateBlock
    v-if="limited"
    icon="info"
    :title="t('exhibitor.cannotCheckin')"
    :description="t('exhibition.form.restrictedAccount')"
    :action-label="t('exhibition.form.backToExhibitor')"
    @action="router.push('/exhibitor')"
  />

  <template v-else>
    <!-- 顶栏右上角：有记录时才出现，一次清空本页的核销记录 -->
    <Teleport v-if="topActionsReady" defer to="#app-top-actions">
      <button
        v-if="outcomes.length > 0"
        class="icon-button"
        type="button"
        data-action="clear-outcomes"
        :aria-label="t('checkin.clear')"
        :title="t('checkin.clear')"
        @click="clearOutcomes"
      >
        <AppIcon name="trash" />
      </button>
    </Teleport>

    <div class="row" data-between="true">
      <span class="section-label">{{ t('checkin.scan.checkIn') }}</span>
      <span class="pill">{{ registrationStatusLabel(REGISTRATION_STATUS.ATTENDED) }}</span>
    </div>

    <!-- 取景区：就近显示状态，而不是整页跳转 -->
    <div class="scan-wrap">
      <div v-if="stageMode === 'live'" class="scan-stage">
        <video ref="videoEl" class="scan-video" autoplay muted playsinline />
        <div class="scan-frame" aria-hidden="true" />
      </div>
      <canvas ref="canvasEl" class="scan-canvas" aria-hidden="true" />
      <!-- 解码用的 canvas 夹在中间，这里的条件写全，不用 v-else（v-else 必须紧跟 v-if） -->
      <StateBlock
        v-if="stageMode !== 'live'"
        :tone="stageMode === 'error' ? 'error' : 'neutral'"
        :icon="stageIcon()"
        :title="stageTitle"
        :description="stageDescription"
      />
    </div>

    <SkeletonBlock v-if="statusLoading" :rows="1" />
    <div v-else-if="statusText" class="notice" :data-tone="statusTone === 'error' ? 'error' : undefined" role="status">
      <span>{{ statusText }}</span>
    </div>
    <StateBlock
      v-if="verifyError"
      tone="error"
      :title="verifyError.title"
      :description="verifyError.description"
      :action-label="t('checkin.scan.continue')"
      @action="restart"
    />

    <div class="stack" data-gap="sm">
      <!-- 三条识别入口竖排整宽：摄像头是主操作（实心），另两条是降级链路 -->
      <button
        ref="startButton"
        class="cta"
        type="button"
        data-action="start-scan"
        :disabled="scanner.starting.value"
        :data-loading="scanner.starting.value ? 'true' : 'false'"
        @click="toggleScan"
      >
        {{ t('checkin.scan.start') }}
      </button>
      <button
        class="cta ghost"
        type="button"
        data-action="pick-image"
        :disabled="scanner.starting.value || picking"
        @click="pickImage"
      >
        {{ t('checkin.scan.pickImage') }}
      </button>
      <button class="cta ghost" type="button" data-action="manual" @click="openManual">
        {{ t('checkin.manual.enterCode') }}
      </button>
      <!-- 隐藏的文件输入：只在没有原生桥（浏览器预览 / 报名站）时使用，应用里走 device.pickImage -->
      <input
        ref="fileInput"
        class="sr-only"
        type="file"
        accept="image/*"
        tabindex="-1"
        aria-hidden="true"
        data-action="pick-image-input"
        @change="onImageChosen"
      />
    </div>

    <!-- 核销结果：常驻列表，最新一条排最前，刷新 / 重开页面后仍在 -->
    <div v-if="outcomes.length > 0" class="list" data-gap="sm" data-testid="checkin-outcomes">
      <article v-for="row in outcomeRows" :key="row.item.id" class="card checkin-outcome" data-testid="checkin-outcome">
        <!-- 信号灯 + 大号结论：结论比状态词更响，两者同一行 -->
        <header class="checkin-verdict">
          <StatusTag
            :text="row.item.ok ? registrationStatusLabel(REGISTRATION_STATUS.ATTENDED) : row.item.statusText"
            :tone="row.item.ok ? 'ok' : 'danger'"
          />
          <h2 class="checkin-verdict-title">
            {{ row.item.ok ? t('checkin.succeeded') : t('checkin.unsuccessful') }}
          </h2>
        </header>
        <p class="row-meta">{{ row.item.message }}</p>

        <!-- 逐行明细：展会、报名人、核销 / 报名时间与收集项 -->
        <div class="checkin-detail">
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('admin.exhibitions.title') }}</span>
            <span class="strong truncate">{{ row.item.record.exhibitionTitle || '—' }}</span>
          </div>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('registration.detail.registrant') }}</span>
            <span class="strong truncate">{{ row.item.record.visitorName || '—' }}</span>
          </div>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('checkin.record.checkInTime') }}</span>
            <span class="strong truncate" data-testid="checkin-time">{{ row.item.record.checkInTime || '—' }}</span>
          </div>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('registration.detail.registeredAt') }}</span>
            <span class="strong truncate">{{ row.item.record.registrationTime || '—' }}</span>
          </div>
          <!-- 收集项逐行展示：与报名详情共用同一套文稿解析 -->
          <div v-if="row.lines.length > 0" class="checkin-answers">
            <div v-for="(line, index) in row.lines" :key="index" class="checkin-answer" data-testid="checkin-answer">
              <span class="row-meta">{{ line.label || t('exhibition.detail.additionalInfo') }}</span>
              <span class="strong">{{ line.value || '—' }}</span>
            </div>
          </div>
          <div v-else class="row" data-between="true">
            <span class="row-meta">{{ t('exhibition.detail.registrationInfo') }}</span>
            <span class="strong">{{ t('registration.detail.noCollectedInfo') }}</span>
          </div>
        </div>

        <button class="cta ghost" type="button" @click="openReview(row.item.record)">
          {{ t('admin.exhibitions.viewRegistrations') }}
        </button>
      </article>

      <!-- 继续核销：只清当前状态与错误，历史记录留着 -->
      <button class="cta" type="button" data-action="continue" @click="restart">
        {{ t('checkin.scan.continue') }}
      </button>
    </div>
  </template>
</template>

<style>
.scan-wrap {
  width: 100%;
}

/* 取景框：正方形并居中，二维码放进去即可被识别 */
.scan-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--frame);
  overflow: hidden;
}

.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scan-canvas {
  display: none;
}

/* 收集项逐行：标签独占一行、值另起一行，长内容自然换行（与报名详情同一套读法） */
.checkin-answers {
  display: grid;
  gap: var(--s2);
}

.checkin-answer {
  display: grid;
  gap: var(--s1);
}

.checkin-answer .strong {
  overflow-wrap: anywhere;
}

/* 核销结论卡：信号灯与大号结论同一行，明细用留白隔开，不画分隔线。 */
.checkin-outcome {
  gap: var(--s3);
}

.checkin-verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2);
}

.checkin-verdict-title {
  font-size: var(--fs-h2);
  font-weight: 700;
  line-height: var(--lh-tight);
}

/* 逐行明细：标签在左、值在右，长值允许换行。 */
.checkin-detail {
  display: grid;
  gap: var(--s1);
}

.checkin-detail > .row > .strong {
  flex: 1 1 auto;
  min-width: 0;
  text-align: end;
  overflow-wrap: anywhere;
}

.checkin-detail > .row > .row-meta {
  flex: none;
}

/* 取景提示框：细线方框加四角强调色，不影响识别区域 */
.scan-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 62%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border: 2px solid var(--accent);
  border-radius: var(--r-input);
  box-shadow: 0 0 0 100vmax var(--scrim);
  pointer-events: none;
}
</style>
