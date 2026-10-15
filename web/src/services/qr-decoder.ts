export interface QrWorkerRequest {
  id: number;
  image: ImageData;
}
export type QrWorkerResponse =
  | { type: 'ready' }
  | { type: 'error' }
  | { type: 'result'; id: number; text: string | null };

export interface QrDecoder {
  ready: Promise<void>;
  /** 消费并转移像素缓冲区；忙碌时跳过新帧，不让摄像头帧排队。 */
  decode(image: ImageData): Promise<string | null>;
  dispose(): void;
}

/** 每个核销页面拥有一个 Worker；退出时终止计算并拒绝所有等待中的调用。 */
export function createQrDecoder(): QrDecoder {
  const worker = new Worker(new URL('./qr-worker.ts', import.meta.url), { type: 'module' });
  let closed = false;
  let sequence = 0;
  let pending: { id: number; resolve: (text: string | null) => void; reject: (error: Error) => void } | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let timer = setTimeout(() => fail(new Error('QR decoder initialization timed out')), 15_000);

  function fail(error: Error): void {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    worker.terminate();
    rejectReady(error);
    pending?.reject(error);
    pending = null;
  }

  worker.onmessage = (event: MessageEvent<QrWorkerResponse>) => {
    if (closed) return;
    const message = event.data;
    if (message.type === 'ready') {
      clearTimeout(timer);
      resolveReady();
    } else if (message.type === 'error') {
      fail(new Error('QR decoder failed'));
    } else if (pending?.id === message.id) {
      clearTimeout(timer);
      const resolve = pending.resolve;
      pending = null;
      resolve(message.text);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail(new Error('QR worker failed'));
  };
  worker.onmessageerror = () => fail(new Error('QR worker message failed'));

  return {
    ready,
    async decode(image) {
      await ready;
      if (closed) throw new DOMException('QR decoder disposed', 'AbortError');
      if (pending) return null;
      return new Promise<string | null>((resolve, reject) => {
        const id = ++sequence;
        pending = { id, resolve, reject };
        timer = setTimeout(() => fail(new Error('QR decoding timed out')), 5_000);
        try {
          worker.postMessage({ id, image } satisfies QrWorkerRequest, [image.data.buffer]);
        } catch {
          fail(new Error('QR frame transfer failed'));
        }
      });
    },
    dispose: () => fail(new DOMException('QR decoder disposed', 'AbortError')),
  };
}
