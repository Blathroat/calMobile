// @vitest-environment node
/**
 * 二维码绘制：默认仍是白底深点（报名码 / 验证器），透明导出只画点、不铺白底。
 *
 * 用像素缓冲记录 `fillRect` 的真实落点，锁住「透明 PNG 里没有底色」这条：
 * 白底只由展示容器和 CSS 提供，一旦画进画布，导出的 PNG 就会带一块白板。
 */
import { describe, expect, it } from 'vitest';
import { drawQr } from './qr-encoder';

const COLORS: Record<string, [number, number, number, number]> = {
  '#ffffff': [255, 255, 255, 255],
  '#20252b': [32, 37, 43, 255],
  '#000000': [0, 0, 0, 255],
};

interface PixelCanvas {
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
  size: number;
  fills: { style: string; x: number; y: number; width: number; height: number }[];
}

/** 最小 2D 上下文替身：只实现 drawQr 用到的 fillStyle / fillRect / clearRect。 */
function pixelCanvas(size: number): PixelCanvas {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const fills: PixelCanvas['fills'] = [];
  const context = {
    fillStyle: '#000000',
    fillRect(x: number, y: number, width: number, height: number) {
      const style = String(context.fillStyle);
      fills.push({ style, x, y, width, height });
      const rgba = COLORS[style.toLowerCase()];
      if (!rgba) throw new Error(`未预期的颜色：${style}`);
      for (let row = Math.max(0, y); row < Math.min(size, y + height); row += 1) {
        for (let column = Math.max(0, x); column < Math.min(size, x + width); column += 1) {
          pixels.set(rgba, (row * size + column) * 4);
        }
      }
    },
    clearRect(x: number, y: number, width: number, height: number) {
      for (let row = Math.max(0, y); row < Math.min(size, y + height); row += 1) {
        for (let column = Math.max(0, x); column < Math.min(size, x + width); column += 1) {
          pixels.fill(0, (row * size + column) * 4, (row * size + column) * 4 + 4);
        }
      }
    },
  };
  const canvas = {
    width: size,
    height: size,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, pixels, size, fills };
}

function pixelAt(target: PixelCanvas, x: number, y: number): number[] {
  const offset = (y * target.size + x) * 4;
  return Array.from(target.pixels.slice(offset, offset + 4));
}

const SHARE_LINK = 'https://example.com/e/8b15d2ab-024c-4452-97a2-2d294b015325';

describe('二维码绘制', () => {
  it('默认白底深点，四角是白底（报名码与验证器沿用）', async () => {
    const target = pixelCanvas(220);
    await expect(drawQr(target.canvas, SHARE_LINK)).resolves.toBe(true);

    expect(pixelAt(target, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(target.fills[0]).toMatchObject({ style: '#ffffff', width: 220, height: 220 });
    expect(target.fills.some((fill) => fill.style === '#20252b')).toBe(true);
  });

  it('透明导出只画纯黑点，不铺任何底色（四角保持 alpha 0）', async () => {
    const target = pixelCanvas(480);
    await expect(
      drawQr(target.canvas, SHARE_LINK, 4, { background: 'transparent', foreground: '#000000' }),
    ).resolves.toBe(true);

    // 没有整幅画布的底色填充，所有 fillRect 都是黑点。
    expect(target.fills.some((fill) => fill.width === 480 && fill.height === 480)).toBe(false);
    expect(target.fills.every((fill) => fill.style === '#000000')).toBe(true);
    expect(pixelAt(target, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(target, 479, 479)).toEqual([0, 0, 0, 0]);
    expect(target.fills.length).toBeGreaterThan(0);
  });

  it('透明导出会先清掉同一画布上一轮的白底，不残留白点', async () => {
    const target = pixelCanvas(220);
    await drawQr(target.canvas, SHARE_LINK);
    expect(pixelAt(target, 0, 0)).toEqual([255, 255, 255, 255]);

    await drawQr(target.canvas, SHARE_LINK, 4, { background: 'transparent', foreground: '#000000' });
    expect(pixelAt(target, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('内容超长、二维码装不下时返回 false，不画半张图', async () => {
    const target = pixelCanvas(220);
    await expect(drawQr(target.canvas, 'x'.repeat(5000))).resolves.toBe(false);
    expect(target.fills).toHaveLength(0);
  });

  it('画布拿不到 2D 上下文时返回 false', async () => {
    const canvas = { width: 220, height: 220, getContext: () => null } as unknown as HTMLCanvasElement;
    await expect(drawQr(canvas, SHARE_LINK)).resolves.toBe(false);
  });
});
