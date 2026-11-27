import { nextTick, ref, type Ref } from 'vue';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { t } from '@/i18n';

const DECODE_WIDTH = 640;
const DECODE_INTERVAL = 120;

type StageMode = 'idle' | 'live' | 'error' | 'stopped' | 'detected';

interface CheckinScannerOptions {
  videoEl: Ref<HTMLVideoElement | undefined>;
  canvasEl: Ref<HTMLCanvasElement | undefined>;
  onCode: (raw: string) => void | Promise<void>;
  setStage: (mode: StageMode, title: string, description: string) => void;
  showNotice: (message: string, tone?: 'neutral' | 'error') => void;
  clearStatus: () => void;
}

/** 管理扫码页的解码器、摄像头流和逐帧识别生命周期。 */
export function useCheckinScanner(options: CheckinScannerOptions) {
  const starting = ref(false);
  const scanning = ref(false);
  const decoderReady = ref(false);
  const decoderFailed = ref(false);

  let stream: MediaStream | null = null;
  let frameHandle = 0;
  let lastDecodeAt = 0;
  let decoder: QrDecoder | null = null;
  let decodeBusy = false;
  let scanEpoch = 0;
  let alive = true;

  function cameraErrorNotice(reason: unknown): string {
    const name = String((reason as { name?: unknown } | null)?.name ?? '');
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return t('checkin.scan.cameraDenied');
    }
    if (
      name === 'NotFoundError' ||
      name === 'DevicesNotFoundError' ||
      name === 'OverconstrainedError' ||
      name === 'ConstraintNotSatisfiedError'
    ) {
      return t('checkin.scan.cameraNotFound');
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') return t('checkin.scan.cameraBusy');
    return t('checkin.scan.cameraUnsupported');
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
    if (options.videoEl.value) options.videoEl.value.srcObject = null;
  }

  function decoderUnavailable(): void {
    if (!alive) return;
    releaseCamera();
    decoderReady.value = false;
    decoderFailed.value = true;
    options.showNotice(t('checkin.scan.decoderUnavailable'), 'error');
  }

  function initialize(): void {
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

  async function decodeFrame(): Promise<void> {
    if (!decoderReady.value || decodeBusy || !alive || !scanning.value) return;
    const node = options.videoEl.value;
    const target = options.canvasEl.value;
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
      if (alive && scanning.value && epoch === scanEpoch && found) await options.onCode(found);
    } catch {
      if (epoch === scanEpoch) decoderUnavailable();
    } finally {
      if (alive) decodeBusy = false;
    }
  }

  async function startCamera(): Promise<void> {
    const epoch = ++scanEpoch;
    if (nativeBridge.hasNative()) {
      try {
        const granted = await device.ensureCameraPermission();
        if (!alive || epoch !== scanEpoch || decoderFailed.value) return;
        if (granted !== true) {
          options.showNotice(t('checkin.scan.permissionDenied'), 'error');
          return;
        }
      } catch (reason) {
        if (alive && epoch === scanEpoch) {
          options.showNotice(reason instanceof Error ? reason.message : String(reason), 'error');
        }
        return;
      }
      if (!alive) return;
    }

    options.setStage('live', '', '');
    options.showNotice(t('checkin.scan.opening'));

    let request: Promise<{ stream: MediaStream } | { error: unknown }>;
    try {
      request = navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        .then(
          (media) => ({ stream: media }) as const,
          (error: unknown) => ({ error }) as const,
        );
    } catch (reason) {
      options.setStage('error', t('checkin.scan.openFailed'), cameraErrorNotice(reason));
      options.clearStatus();
      return;
    }
    await nextTick();

    const settled = await request;
    if (!alive || epoch !== scanEpoch) {
      if ('stream' in settled) settled.stream.getTracks().forEach((track) => track.stop());
      return;
    }
    if ('error' in settled) {
      options.setStage('error', t('checkin.scan.openFailed'), cameraErrorNotice(settled.error));
      options.clearStatus();
      return;
    }

    const media = settled.stream;
    if (!alive || epoch !== scanEpoch || decoderFailed.value) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }

    const node = options.videoEl.value;
    if (!node) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = media;
    node.srcObject = media;
    try {
      await node.play();
    } catch {
      // 部分内核要求用户手势才自动播放，识别循环仍会尝试取帧。
    }
    if (!alive || epoch !== scanEpoch || stream !== media) return;
    scanning.value = true;
    options.showNotice(t('checkin.scan.placeCode'));
    scheduleFrame();
  }

  async function start(): Promise<void> {
    if (starting.value || scanning.value) return;
    if (decoderFailed.value) {
      decoderUnavailable();
      return;
    }
    const supported =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.getUserMedia === 'function';
    if (!supported) {
      options.showNotice(t('checkin.scan.unsupported'), 'error');
      return;
    }

    starting.value = true;
    try {
      await startCamera();
    } finally {
      if (alive) starting.value = false;
    }
  }

  async function decodeImage(image: ImageData): Promise<string | null> {
    if (!decoder) {
      decoderUnavailable();
      return null;
    }
    if (!decoderReady.value) {
      try {
        await decoder.ready;
        if (alive) decoderReady.value = true;
      } catch {
        decoderUnavailable();
        return null;
      }
    }
    if (!alive) return null;
    try {
      return await decoder.decode(image);
    } catch {
      decoderUnavailable();
      return null;
    }
  }

  function dispose(): void {
    alive = false;
    releaseCamera();
    decoder?.dispose();
  }

  return {
    starting,
    scanning,
    decoderReady,
    decoderFailed,
    initialize,
    start,
    releaseCamera,
    decodeImage,
    decoderUnavailable,
    dispose,
  };
}
