import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQrDecoder, type QrWorkerResponse } from './qr-decoder';

class TestWorker {
  static latest: TestWorker;
  onmessage: ((event: MessageEvent<QrWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.latest = this; }
  reply(data: QrWorkerResponse): void { this.onmessage?.({ data } as MessageEvent<QrWorkerResponse>); }
}

const frame = () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2, colorSpace: 'srgb' } as ImageData);

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Worker', TestWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('扫码 Worker 的页面生命周期', () => {
  it('等待 WASM 就绪才传帧，解码期间跳过新帧，结果只完成对应请求', async () => {
    const decoder = createQrDecoder();
    const worker = TestWorker.latest;
    const image = frame();
    const decoding = decoder.decode(image);
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.reply({ type: 'ready' });
    await decoder.ready;
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, image }, [image.data.buffer]);
    await expect(decoder.decode(frame())).resolves.toBeNull();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.reply({ type: 'result', id: 0, text: '旧帧' });
    worker.reply({ type: 'result', id: 1, text: 'CALMOBILE-CHECKIN|123' });
    await expect(decoding).resolves.toBe('CALMOBILE-CHECKIN|123');
    decoder.dispose();
  });

  it('离开页面会终止 Worker，取消未完成帧并忽略迟到结果', async () => {
    const decoder = createQrDecoder();
    const worker = TestWorker.latest;
    worker.reply({ type: 'ready' });
    const decoding = decoder.decode(frame());
    await decoder.ready;
    decoder.dispose();
    worker.reply({ type: 'result', id: 1, text: '不得核销' });
    await expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
    await expect(decoder.decode(frame())).rejects.toMatchObject({ name: 'AbortError' });
    decoder.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'messageerror', 'init-timeout', 'dispose'] as const)('初始化时 %s 会结束等待并释放 Worker', async (failure) => {
    const decoder = createQrDecoder();
    const worker = TestWorker.latest;
    const rejected = expect(decoder.ready).rejects.toMatchObject({ name: failure === 'dispose' ? 'AbortError' : 'Error' });
    if (failure === 'error') worker.onerror?.(new ErrorEvent('error', { cancelable: true }));
    if (failure === 'messageerror') worker.onmessageerror?.();
    if (failure === 'init-timeout') await vi.advanceTimersByTimeAsync(15_000);
    if (failure === 'dispose') decoder.dispose();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['decode-error', 'decode-timeout', 'transfer-error'] as const)('识别时 %s 会明确失败，不永远保持忙碌', async (failure) => {
    const decoder = createQrDecoder();
    const worker = TestWorker.latest;
    worker.reply({ type: 'ready' });
    if (failure === 'transfer-error') worker.postMessage.mockImplementation(() => { throw new Error('transfer'); });
    const decoding = decoder.decode(frame());
    const rejected = expect(decoding).rejects.toBeInstanceOf(Error);
    await decoder.ready;
    if (failure === 'decode-error') worker.reply({ type: 'error' });
    if (failure === 'decode-timeout') await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
