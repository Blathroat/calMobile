<script setup lang="ts">
/**
 * 展商 · 核销报名码
 *
 * 展会在「编辑展会」里开启「是否启用报名二维码」后，报名审核通过的用户会在报名详情
 * 看到报名码。展商在本页用摄像头取景，由 Worker 中的 ZXing WASM 实时识别二维码，
 * 识别成功后调用 `checkin` 把报名状态改为「已参加」。
 *
 * 摄像头不可用（未授权、设备没有摄像头、内核不支持 getUserMedia）时保留「手动输入报名码」
 * 这条降级链路，核销功能仍然可用；识别库按需加载，不拖慢启动，也只在真正进本页才拉取。
 * 离开页面一定要释放摄像头，否则后台会一直占用相机。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { device } from '@/services/device-services';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { REGISTRATION_STATUS } from '@/services/status';
import { useHint } from '@/composables/useHint';
import ManualCodePanel from '@/components/ManualCodePanel.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { ApiResult, JsonObject } from '@/api/types';
import { t } from '@/i18n';

/** 报名码前缀，与原生 WebAppActions.REGISTRATION_CODE_PREFIX 保持一致。 */
const CODE_PREFIX = 'CALMOBILE-CHECKIN|';
const DECODE_WIDTH = 640;
/** 识别节流：约每 120ms 解一帧，既跟得上手势又不占满 CPU。 */
const DECODE_INTERVAL = 120;

/** 取景区只表达一件事：当前是取景、识别中，还是某一步失败 / 已停止。 */
type StageMode = 'idle' | 'live' | 'error' | 'stopped' | 'detected';

interface CheckInOutcome {
  ok: boolean;
  statusText: string;
  message: string;
  record: JsonObject;
}

const router = useRouter();
const session = useSessionStore();

/** 受限账号不能核销（后端 `POST /checkin` 直接 403）：整页换成说明，也不去加载识别库。 */
const limited = computed(() => session.limited === true);
const videoEl = ref<HTMLVideoElement>();
const canvasEl = ref<HTMLCanvasElement>();
const startButton = ref<HTMLButtonElement>();
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

const outcome = ref<CheckInOutcome | null>(null);
const outcomeRecord = computed<JsonObject>(() => outcome.value?.record ?? {});

const starting = ref(false);
const scanning = ref(false);
const submitting = ref(false);
const decoderReady = ref(false);
const decoderFailed = ref(false);

/** 手动输入面板的数据：输入值与原位错误都放在这个响应式对象里（面板组件按引用读写）。 */
const manual = reactive({ code: '', error: '' });

let stream: MediaStream | null = null;
let frameHandle = 0;
let lastDecodeAt = 0;
let decoder: QrDecoder | null = null;
let decodeBusy = false;
let scanEpoch = 0;
/** 页面被替换后置为 false：异步步骤（权限、getUserMedia）回来时据此放弃取景。 */
let alive = true;

onMounted(() => {
  // 进到核销页就说明展商后台那条「怎么核销」的提示已经教到位了：不管从哪个入口进来
  // （后台按钮、深链、返回键回来）都把它记为已读，下次不再显示。
  void dismissCheckinHint();
  if (limited.value) return;
  try {
    decoder = createQrDecoder();
    void decoder.ready.then(() => { if (alive) decoderReady.value = true; }).catch(decoderUnavailable);
  } catch {
    decoderUnavailable();
  }
});

onBeforeUnmount(() => {
  alive = false;
  releaseCamera();
  decoder?.dispose();
});

function decoderUnavailable(): void {
  if (!alive) return;
  releaseCamera();
  decoderReady.value = false;
  decoderFailed.value = true;
  showNotice(t('checkin.scan.decoderUnavailable'), 'error');
}

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

function stageIcon(): string {
  return stageMode.value === 'detected' ? 'check' : 'image';
}

/** 识别到的内容是不是本应用的报名码：不是也要说清楚，而不是笼统失败。 */
function previewOf(raw: string): string {
  return String(raw || '').startsWith(CODE_PREFIX) ? t('checkin.verifying') : t('checkin.notAppCode');
}

// ── 取景与识别 ─────────────────────────────────────────────────

async function toggleScan(): Promise<void> {
  if (starting.value) return;
  if (scanning.value) {
    stopScan();
    return;
  }
  if (decoderFailed.value) {
    decoderUnavailable();
    return;
  }
  const supported = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices)
    && typeof navigator.mediaDevices.getUserMedia === 'function';
  if (!supported) {
    showNotice(t('checkin.scan.unsupported'), 'error');
    return;
  }

  starting.value = true;
  try {
    await startScan();
  } finally {
    if (alive) starting.value = false;
  }
}

async function startScan(): Promise<void> {
  const epoch = ++scanEpoch;
  try {
    // 先让原生确认摄像头权限，用户同意后 WebView 的 getUserMedia 才会放行。
    const granted = await device.ensureCameraPermission();
    if (!alive || epoch !== scanEpoch || decoderFailed.value) return;
    if (granted !== true) {
      showNotice(t('checkin.scan.permissionDenied'), 'error');
      return;
    }
  } catch (reason) {
    if (alive && epoch === scanEpoch) showNotice(reason instanceof Error ? reason.message : String(reason), 'error');
    return;
  }
  if (!alive) return;

  setStage('live', '', '');
  showNotice(t('checkin.scan.opening'));
  await nextTick();
  if (!alive || epoch !== scanEpoch) return;

  let media: MediaStream;
  try {
    media = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '';
    if (!alive || epoch !== scanEpoch) return;
    setStage('error', t('checkin.scan.openFailed'), `${message || t('checkin.scan.previewFailed')}。可以改用“手动输入报名码”。`);
    clearStatus();
    return;
  }
  if (!alive || epoch !== scanEpoch || decoderFailed.value) {
    media.getTracks().forEach((track) => track.stop());
    return;
  }

  const node = videoEl.value;
  if (!node) {
    media.getTracks().forEach((track) => track.stop());
    return;
  }
  stream = media;
  node.srcObject = media;
  try {
    await node.play();
  } catch {
    // 部分内核要求用户手势才自动播放；播放失败时下面的循环仍会尝试取帧。
  }
  if (!alive || epoch !== scanEpoch || stream !== media) return;
  scanning.value = true;
  showNotice(t('checkin.scan.placeCode'));
  scheduleFrame();
}

function stopScan(): void {
  scanning.value = false;
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  releaseCamera();
  setStage('stopped', t('checkin.scan.stopped'), t('checkin.scan.resumeOrType'));
  clearStatus();
}

function releaseCamera(): void {
  scanEpoch += 1;
  scanning.value = false;
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (videoEl.value) videoEl.value.srcObject = null;
}

function scheduleFrame(): void {
  if (!scanning.value) return;
  frameHandle = requestAnimationFrame((timestamp) => {
    if (!scanning.value) return;
    if (timestamp - lastDecodeAt >= DECODE_INTERVAL) {
      lastDecodeAt = timestamp;
      void decodeFrame();
    }
    scheduleFrame();
  });
}

/** 取当前画面中间 4:3 区域解码，兼顾识别率与性能。 */
async function decodeFrame(): Promise<void> {
  if (!decoderReady.value || decodeBusy || !alive || !scanning.value) return;
  const node = videoEl.value;
  const target = canvasEl.value;
  if (!decoder || !node || !target) return;
  const width = node.videoWidth;
  const height = node.videoHeight;
  if (!width || !height) return;

  const cropWidth = Math.min(width, Math.round(height * 4 / 3));
  const cropHeight = Math.min(height, Math.round(cropWidth * 3 / 4));
  const context = target.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  target.width = DECODE_WIDTH;
  target.height = Math.round(DECODE_WIDTH * cropHeight / cropWidth);
  context.drawImage(
    node,
    (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight,
    0, 0, target.width, target.height,
  );
  let image: ImageData;
  try {
    image = context.getImageData(0, 0, target.width, target.height);
  } catch {
    return;
  }
  const epoch = scanEpoch;
  decodeBusy = true;
  try {
    const found = await decoder.decode(image);
    // 停止、重启或离开页面后，旧帧的结果不再触发核销。
    if (alive && scanning.value && epoch === scanEpoch && found) await handleCode(found);
  } catch {
    if (epoch === scanEpoch) decoderUnavailable();
  } finally {
    if (alive) decodeBusy = false;
  }
}

/** 识别到内容后先停止取景，避免同一张码被连续提交。 */
async function handleCode(raw: string): Promise<void> {
  if (submitting.value) return;
  releaseCamera();
  setStage('detected', t('checkin.scan.recognized'), previewOf(raw));
  await verify(raw);
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
    outcome.value = null;
    showVerifyError(t('checkin.verifyFailed'), reason instanceof Error ? reason.message : String(reason));
  } finally {
    if (alive) submitting.value = false;
  }
}

function renderResult(response: ApiResult): void {
  const ok = response?.ok === true;
  clearStatus();
  outcome.value = {
    ok,
    statusText: String(response?.status || t('checkin.notPassed')),
    message: String(response?.message || response?.error || ''),
    record: (response?.record ?? {}) as JsonObject,
  };
  if (ok) toast(String(response?.message || t('checkin.succeeded')), 'success');
  else toast(String(response?.error || t('checkin.unsuccessful')), 'error');
}

function openReview(): void {
  const exhibitionId = String(outcomeRecord.value.exhibitionId ?? '');
  void router.push(exhibitionId ? { path: '/review', query: { exhibitionId } } : { path: '/review' });
}

/** 继续核销：清掉上一次的结果与提示，焦点回到扫码按钮。 */
async function restart(): Promise<void> {
  outcome.value = null;
  clearStatus();
  await nextTick();
  startButton.value?.focus();
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
      { label: t('checkin.manual.checkIn'), variant: 'primary', onClick: (close) => { void submitManual(close); } },
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
  outcome.value = null;
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
    <div class="row" data-between="true">
      <span class="section-label">{{ t('checkin.scan.checkIn') }}</span>
      <span class="pill">{{ REGISTRATION_STATUS.ATTENDED }}</span>
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
    <div
      v-else-if="statusText"
      class="notice"
      :data-tone="statusTone === 'error' ? 'error' : undefined"
      role="status"
    >
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
      <button
        ref="startButton"
        class="cta"
        type="button"
        :disabled="starting"
        :data-loading="starting ? 'true' : 'false'"
        @click="toggleScan"
      >
        {{ t('checkin.scan.start') }}
      </button>
      <button class="cta ghost" type="button" @click="openManual">{{ t('checkin.manual.enterCode') }}</button>
    </div>

    <!-- 核销结果：成功与失败都在原位给出报名人信息与下一步 -->
    <div v-if="outcome" class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ outcome.ok ? t('checkin.succeeded') : t('checkin.unsuccessful') }}</span>
        <StatusTag
          :text="outcome.ok ? REGISTRATION_STATUS.ATTENDED : outcome.statusText"
          :tone="outcome.ok ? 'ok' : 'danger'"
        />
      </div>
      <p class="row-meta">{{ outcome.message }}</p>
      <div class="card" data-tone="fill">
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('admin.exhibitions.title') }}</span>
          <span class="strong truncate">{{ outcomeRecord.exhibitionTitle || '—' }}</span>
        </div>
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('registration.detail.registrant') }}</span>
          <span class="strong truncate">{{ outcomeRecord.visitorName || '—' }}</span>
        </div>
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('registration.detail.registeredAt') }}</span>
          <span class="strong truncate">{{ outcomeRecord.registrationTime || '—' }}</span>
        </div>
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('exhibition.detail.registrationInfo') }}</span>
          <span class="strong">{{ outcomeRecord.answers || t('registration.detail.noCollectedInfo') }}</span>
        </div>
      </div>
      <div class="grid-cols-2">
        <button class="cta ghost" type="button" @click="restart">{{ t('checkin.scan.continue') }}</button>
        <button class="cta" type="button" @click="openReview">{{ t('admin.exhibitions.viewRegistrations') }}</button>
      </div>
    </div>
  </template>
</template>
