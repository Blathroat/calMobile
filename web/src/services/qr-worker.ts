import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { QrWorkerRequest, QrWorkerResponse } from './qr-decoder';

/** WASM 与脚本来自同一 pnpm 包，Vite 生成本地资源地址，不使用库的默认 CDN。 */
const ready = prepareZXingModule({
  overrides: { locateFile: () => wasmUrl },
  fireImmediately: true,
});

function reply(message: QrWorkerResponse): void {
  self.postMessage(message);
}

void ready.then(() => reply({ type: 'ready' })).catch(() => reply({ type: 'error' }));

self.onmessage = async (event: MessageEvent<QrWorkerRequest>) => {
  try {
    await ready;
    const results = await readBarcodes(event.data.image, {
      formats: ['QRCode'], maxNumberOfSymbols: 1, tryInvert: false,
    });
    reply({ type: 'result', id: event.data.id, text: results[0]?.text || null });
  } catch {
    reply({ type: 'error' });
  }
};
