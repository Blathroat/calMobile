// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { drawQr } from './qr-encoder';

const require = createRequire(import.meta.url);
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });

/** 记录生产绘制函数落下的真实像素，不替换二维码生成或识别算法。 */
function pixelCanvas(size: number): { canvas: HTMLCanvasElement; image: ImageData } {
  const data = new Uint8ClampedArray(size * size * 4);
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, width: number, height: number) {
      const rgb = context.fillStyle === '#ffffff' ? [255, 255, 255] : [32, 37, 43];
      for (let row = y; row < Math.min(size, y + height); row += 1) {
        for (let column = x; column < Math.min(size, x + width); column += 1) {
          data.set([...rgb, 255], (row * size + column) * 4);
        }
      }
    },
  };
  return {
    canvas: { width: size, height: size, getContext: () => context } as unknown as HTMLCanvasElement,
    image: { data, width: size, height: size, colorSpace: 'srgb' } as ImageData,
  };
}

describe('屏幕二维码与 ZXing WASM 的真实往返', () => {
  it.each([
    'CALMOBILE-CHECKIN|8b15d2ab-024c-4452-97a2-2d294b015325',
    'otpauth://totp/CalMobile:test%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=CalMobile&algorithm=SHA1&digits=6&period=30',
  ])('220px 画布能完整识别 %s', async (text) => {
    const { canvas, image } = pixelCanvas(220);
    expect(await drawQr(canvas, text)).toBe(true);
    const results = await readBarcodes(image, { formats: ['QRCode'], maxNumberOfSymbols: 1, tryInvert: false });
    expect(results.map((result) => result.text)).toEqual([text]);
  });
});
