import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useCheckinScanner } from './useCheckinScanner';

/**
 * 扫码解码器的失败与恢复：识别库可能是瞬时失败（分包加载失败、初始化超时），
 * 「开始扫码」要能重建一次；选图解码成功后不能再被旧的失败标记挡住结果。
 */

const hoisted = vi.hoisted(() => ({ createQrDecoder: vi.fn() }));
vi.mock('@/services/qr-decoder', () => ({ createQrDecoder: hoisted.createQrDecoder }));

const stopTrack = vi.fn();
const media = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const getUserMedia = vi.fn(async () => media);

function fakeDecoder(ready: Promise<void> = Promise.resolve()) {
  return { ready, decode: vi.fn(async () => null as string | null), dispose: vi.fn() };
}

function mountScanner() {
  const videoEl = ref<HTMLVideoElement>();
  const canvasEl = ref<HTMLCanvasElement>();
  const onCode = vi.fn();
  const setStage = vi.fn();
  const showNotice = vi.fn();
  const clearStatus = vi.fn();
  const scanner = useCheckinScanner({ videoEl, canvasEl, onCode, setStage, showNotice, clearStatus });
  return { scanner, setStage, showNotice };
}

/** 解码用的一帧像素：内容不重要，解码器是假的。 */
const IMAGE = { width: 8, height: 8, data: new Uint8ClampedArray(256), colorSpace: 'srgb' } as unknown as ImageData;

beforeEach(() => {
  vi.clearAllMocks();
  stopTrack.mockClear();
  getUserMedia.mockClear();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('扫码解码器的失败与恢复', () => {
  it('初始化失败后点「开始扫码」会重建解码器，成功后才打开相机', async () => {
    const broken = fakeDecoder(Promise.reject(new Error('wasm 分包加载失败')));
    const healthy = fakeDecoder();
    hoisted.createQrDecoder.mockReturnValueOnce(broken).mockReturnValueOnce(healthy);
    const { scanner, setStage } = mountScanner();

    scanner.initialize();
    await vi.waitFor(() => expect(scanner.decoderFailed.value).toBe(true));
    expect(getUserMedia).not.toHaveBeenCalled();

    await scanner.start();

    expect(hoisted.createQrDecoder).toHaveBeenCalledTimes(2);
    expect(scanner.decoderFailed.value).toBe(false);
    expect(scanner.decoderReady.value).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(setStage).toHaveBeenCalledWith('live', '', '');
    scanner.dispose();
  });

  it('重建仍失败时不开相机，提示保持可见', async () => {
    hoisted.createQrDecoder.mockImplementation(() => fakeDecoder(Promise.reject(new Error('still broken'))));
    const { scanner, showNotice } = mountScanner();

    scanner.initialize();
    await vi.waitFor(() => expect(scanner.decoderFailed.value).toBe(true));
    await scanner.start();

    expect(hoisted.createQrDecoder).toHaveBeenCalledTimes(2);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalled();
    scanner.dispose();
  });

  it('一次解码失败后，成功解码会清掉失败标记并返回结果', async () => {
    const decoder = fakeDecoder();
    decoder.decode.mockRejectedValueOnce(new Error('瞬时解码失败')).mockResolvedValueOnce('CALMOBILE-CHECKIN|ok');
    hoisted.createQrDecoder.mockReturnValue(decoder);
    const { scanner } = mountScanner();

    scanner.initialize();
    await vi.waitFor(() => expect(scanner.decoderReady.value).toBe(true));

    expect(await scanner.decodeImage(IMAGE)).toBeNull();
    expect(scanner.decoderFailed.value).toBe(true);

    expect(await scanner.decodeImage(IMAGE)).toBe('CALMOBILE-CHECKIN|ok');
    expect(scanner.decoderFailed.value).toBe(false);
    scanner.dispose();
  });

  it('卸载时释放解码器', async () => {
    const decoder = fakeDecoder();
    hoisted.createQrDecoder.mockReturnValue(decoder);
    const { scanner } = mountScanner();
    scanner.initialize();
    await vi.waitFor(() => expect(scanner.decoderReady.value).toBe(true));

    scanner.dispose();

    expect(decoder.dispose).toHaveBeenCalledOnce();
  });
});
