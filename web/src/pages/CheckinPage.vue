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
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { nativeBridge } from '@/services/native-bridge';
import { openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { REGISTRATION_STATUS, registrationStatusLabel } from '@/services/status';
import { useHint } from '@/composables/useHint';
import { answerDocument } from '@domain/answer-document';
import AppIcon from '@/components/AppIcon.vue';
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
/** 选择图像扫码：交给解码器前把图像等比缩到最长边不超过这个像素数。 */
const MAX_IMAGE_EDGE = 1600;
/** 核销结果按账号分键存在本机：换号不会串台，重开页面还能看到之前核销过谁。 */
const OUTCOMES_PREFIX = 'calmobile.checkin.outcomes.';
/** 本页只当现场记录用，最多留这么多条，最新的排最前。 */
const MAX_OUTCOMES = 20;

/** 取景区只表达一件事：当前是取景、识别中，还是某一步失败 / 已停止。 */
type StageMode = 'idle' | 'live' | 'error' | 'stopped' | 'detected';

interface CheckInOutcome {
  /** 列表内的本地唯一键：同一条报名可能先失败几次、最后一次才成功。 */
  id: string;
  ok: boolean;
  statusText: string;
  message: string;
  record: JsonObject;
}

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

/** 按当前登录用户分键；没有 id 时退回一个共享键，不写进别人的记录里。 */
function outcomesKey(): string {
  return `${OUTCOMES_PREFIX}${String(session.user?.id ?? '') || 'anonymous'}`;
}

/** 读本机记录：整份不是数组就当作没有，单条坏数据跳过而不是丢整份。 */
function readOutcomes(): CheckInOutcome[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage?.getItem(outcomesKey()) ?? null;
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const list: CheckInOutcome[] = [];
  for (const item of parsed) {
    const entry = normalizeOutcome(item, list.length);
    if (entry) list.push(entry);
    if (list.length >= MAX_OUTCOMES) break;
  }
  return list;
}

/** 单条记录的形状校验：缺 record 的条目跳过，不影响同一份里的其它条目。 */
function normalizeOutcome(value: unknown, index: number): CheckInOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const record = raw.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `restored-${index}`,
    ok: raw.ok === true,
    statusText: String(raw.statusText ?? ''),
    message: String(raw.message ?? ''),
    record: record as JsonObject,
  };
}

function persistOutcomes(): void {
  try {
    const storage = window.localStorage;
    if (!storage) return;
    if (outcomes.value.length === 0) storage.removeItem(outcomesKey());
    else storage.setItem(outcomesKey(), JSON.stringify(outcomes.value.slice(0, MAX_OUTCOMES)));
  } catch {
    // 本机存储不可用（隐私模式 / 配额满）时列表仍留在内存里，不打断核销。
  }
}

/** 换号时按新键重读，避免把上一个账号的记录留在屏幕上。 */
function loadOutcomes(): void {
  outcomes.value = readOutcomes();
}

const starting = ref(false);
const scanning = ref(false);
const submitting = ref(false);
/** 正在读图 / 解码：期间禁用「选择图像扫码」，避免并发解码互相顶掉结果。 */
const picking = ref(false);
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
  // 外壳的顶栏已经渲染：确认挂载点存在后才允许投递清理按钮。
  topActionsReady.value = document.getElementById('app-top-actions') !== null;
  // 先把本机留下的核销记录读回来，再决定要不要加载识别库。
  loadOutcomes();
  // 进到核销页就说明展商后台那条「怎么核销」的提示已经教到位了：不管从哪个入口进来
  // （后台按钮、深链、返回键回来）都把它记为已读，下次不再显示。
  void dismissCheckinHint();
  if (limited.value) return;
  try {
    decoder = createQrDecoder();
    void decoder.ready
      .then(() => {
        if (alive) decoderReady.value = true;
      })
      .catch(decoderUnavailable);
  } catch {
    decoderUnavailable();
  }
});

// 换号（含登录后会话落地）时按新用户的键重读历史，不把上一个账号的记录留在屏幕上。
watch(
  () => String(session.user?.id ?? ''),
  () => loadOutcomes(),
);

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
  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
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
    setStage(
      'error',
      t('checkin.scan.openFailed'),
      t('checkin.scan.openFailedHint', { reason: message || t('checkin.scan.previewFailed') }),
    );
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

  const cropWidth = Math.min(width, Math.round((height * 4) / 3));
  const cropHeight = Math.min(height, Math.round((cropWidth * 3) / 4));
  const context = target.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  target.width = DECODE_WIDTH;
  target.height = Math.round((DECODE_WIDTH * cropHeight) / cropWidth);
  context.drawImage(
    node,
    (width - cropWidth) / 2,
    (height - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    target.width,
    target.height,
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
  if (picking.value || starting.value) return;
  // 选图期间不再取景：相机一直占着会挡住系统选择器，也没必要同时解码两路。
  if (scanning.value) stopScan();
  else releaseCamera();
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

/** 两条选图路径共用：缩到 MAX_IMAGE_EDGE -> 等解码器就绪 -> 解码 -> 核销或提示。 */
async function useImageSource(source: File | string): Promise<void> {
  // 解码可能要点时间，先用骨架行占位，避免看起来没反应。
  showLoadingStatus();
  let image: ImageData;
  try {
    image = await readImageData(source);
  } catch {
    if (alive) showNotice(t('checkin.scan.pickFailed'), 'error');
    return;
  }
  if (!alive) return;
  if (!decoder) {
    decoderUnavailable();
    return;
  }
  // 解码器就是挂载时创建的那一个：没就绪就在这里等它，不必先开摄像头。
  if (!decoderReady.value) {
    try {
      await decoder.ready;
    } catch {
      decoderUnavailable();
      return;
    }
  }
  let found: string | null;
  try {
    found = await decoder.decode(image);
  } catch {
    decoderUnavailable();
    return;
  }
  if (!alive) return;
  if (!found) {
    // 没识别到是常见结果，用行内提示而不是错误块。
    showNotice(t('checkin.scan.pickEmpty'));
    return;
  }
  // 与摄像头识别同一条路：停取景、进入已识别、再核销。
  await handleCode(found);
}

/** 把选到的图片读成像素：等比缩到最长边 <= MAX_IMAGE_EDGE，再取 ImageData。 */
async function readImageData(source: File | string): Promise<ImageData> {
  const loaded = await loadImageSource(source);
  try {
    const { width, height } = loaded;
    if (!width || !height) throw new Error('image has no size');
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d context unavailable');
    context.drawImage(loaded.source, 0, 0, targetWidth, targetHeight);
    return context.getImageData(0, 0, targetWidth, targetHeight);
  } finally {
    loaded.release();
  }
}

/**
 * File 优先 createImageBitmap（不解码到 DOM，快且省内存），内核解不开这个格式时退回
 * Image + object URL；dataUrl 直接用 Image 解码。release 由调用方取完像素后调用。
 */
async function loadImageSource(
  source: File | string,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof source !== 'string' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 落到下面的 <img> 再试一次
    }
  }
  const objectUrl = typeof source === 'string' ? '' : URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image load failed'));
      image.src = objectUrl || (source as string);
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (reason) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw reason;
  }
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
  ].slice(0, MAX_OUTCOMES);
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
      <!-- 摄像头与选图并排等宽：两条识别入口等价，「手动输入」仍整行在下方 -->
      <div class="grid-cols-2">
        <button
          ref="startButton"
          class="cta"
          type="button"
          data-action="start-scan"
          :disabled="starting"
          :data-loading="starting ? 'true' : 'false'"
          @click="toggleScan"
        >
          {{ t('checkin.scan.start') }}
        </button>
        <button
          class="cta ghost"
          type="button"
          data-action="pick-image"
          :disabled="starting || picking"
          @click="pickImage"
        >
          {{ t('checkin.scan.pickImage') }}
        </button>
      </div>
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
      <div v-for="row in outcomeRows" :key="row.item.id" class="card" data-testid="checkin-outcome">
        <div class="row" data-between="true">
          <span class="section-label">{{ row.item.ok ? t('checkin.succeeded') : t('checkin.unsuccessful') }}</span>
          <StatusTag
            :text="row.item.ok ? registrationStatusLabel(REGISTRATION_STATUS.ATTENDED) : row.item.statusText"
            :tone="row.item.ok ? 'ok' : 'danger'"
          />
        </div>
        <p class="row-meta">{{ row.item.message }}</p>
        <div class="card" data-tone="fill">
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
      </div>

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
  background: #000;
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
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.28);
  pointer-events: none;
}
</style>
