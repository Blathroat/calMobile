import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCheckinImageData } from './checkin-image';

/**
 * 选图扫码的降级链路：有 createImageBitmap 时优先用它，失败退回 <img> 再试一次；
 * 两条路都必须把临时资源（位图 / objectURL）收回。
 */

const close = vi.fn();
const revokeObjectURL = vi.fn();

/** 可控的「图片」：src 赋上后按 fail 决定走 onload 还是 onerror。 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private value = '';
  constructor(private readonly fail = false) {}
  get src(): string {
    return this.value;
  }
  set src(next: string) {
    this.value = next;
    queueMicrotask(() => {
      if (this.fail) this.onerror?.();
      else this.onload?.();
    });
  }
}

/** 画布只给这里用得到的两个方法。 */
function stubCanvas(options: { context?: boolean } = {}): void {
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    if (tag === 'canvas') {
      (element as HTMLCanvasElement).getContext = (() =>
        options.context === false
          ? null
          : {
              drawImage: vi.fn(),
              getImageData: (_x: number, _y: number, width: number, height: number) => ({
                width,
                height,
                data: new Uint8ClampedArray(width * height * 4),
              }),
            }) as never;
    }
    return element;
  }) as typeof document.createElement);
}

/** createImageBitmap 桩：返回给定位图，读完后 `close`。 */
function stubBitmap(width: number, height: number): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close })),
  );
}

/** 回退到 <img> 的桩：位图解码失败 + objectURL + 可控结果的假图片。 */
function stubImageFallback(options: { fail?: boolean; url?: string; width?: number; height?: number } = {}): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => Promise.reject(new Error('unsupported'))),
  );
  vi.stubGlobal('URL', { createObjectURL: () => options.url ?? 'blob:qr', revokeObjectURL });
  vi.stubGlobal(
    'Image',
    class extends FakeImage {
      constructor() {
        super(options.fail === true);
        this.naturalWidth = options.width ?? 400;
        this.naturalHeight = options.height ?? 200;
      }
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  close.mockClear();
  revokeObjectURL.mockClear();
});

describe('选图扫码的像素读取', () => {
  it('优先用 createImageBitmap，并把最长边缩到 1600 后收回位图', async () => {
    stubCanvas();
    stubBitmap(3200, 1600);
    const image = await readCheckinImageData(new File(['x'], 'qr.png', { type: 'image/png' }));
    expect(image.width).toBe(1600);
    expect(image.height).toBe(800);
    expect(close).toHaveBeenCalledOnce();
  });

  it('createImageBitmap 失败时退回 <img>，读到像素后收回 objectURL', async () => {
    stubCanvas();
    stubImageFallback();
    const image = await readCheckinImageData(new File(['x'], 'qr.heic', { type: 'image/heic' }));
    expect(image.width).toBe(400);
    expect(image.height).toBe(200);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr');
  });

  it('图片加载失败时抛错并收回 objectURL', async () => {
    stubCanvas();
    stubImageFallback({ fail: true, url: 'blob:bad' });
    await expect(readCheckinImageData(new File(['x'], 'bad.png', { type: 'image/png' }))).rejects.toThrow(
      'image load failed',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:bad');
  });

  it('画布拿不到 2d 上下文时抛错，位图照样收回', async () => {
    stubCanvas({ context: false });
    stubBitmap(640, 480);
    await expect(readCheckinImageData(new File(['x'], 'qr.png', { type: 'image/png' }))).rejects.toThrow(
      '2d context unavailable',
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('没有尺寸的图直接抛错并收回位图', async () => {
    stubCanvas();
    stubBitmap(0, 0);
    await expect(readCheckinImageData(new File(['x'], 'qr.png', { type: 'image/png' }))).rejects.toThrow(
      'image has no size',
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
