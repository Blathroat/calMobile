/**
 * 浏览器文件能力的用例：选文件、压缩、下载、分享、通知权限。
 *
 * jsdom 没有 `createImageBitmap`、canvas 与系统分享面板，所以像素级结果不在这里验证：
 * 解码 / 画布 / 编码三步都用 stub 顶掉，只验证分支与尺寸换算；取消、不支持、失败这几条
 * 稳定返回码才是页面真正依赖的契约。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/clipboard', () => ({ copyText: vi.fn() }));

import { copyText } from '@/services/clipboard';
import {
  blobToDataUrl,
  compressImage,
  downloadBlob,
  imageFileToJpegDataUrl,
  isAbortError,
  pickFile,
  requestNotificationPermission,
  shareFile,
  shareText,
} from './browser-device';

const copyTextMock = vi.mocked(copyText);

interface Stub {
  target: object;
  key: string;
  original: PropertyDescriptor | undefined;
}

const stubs: Stub[] = [];

/** 改一个全局属性 / 原型方法并记下原状；afterEach 逆序还原。 */
function stubProperty(target: object, key: string, value: unknown): void {
  stubs.push({ target, key, original: Object.getOwnPropertyDescriptor(target, key) });
  Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true });
}

/** 让 canvas 能画、能编码：不画真实像素，只记录调用与尺寸。 */
function stubCanvas(options: {
  drawImage?: (source: CanvasImageSource, dx: number, dy: number, width: number, height: number) => void;
  blob?: Blob | null;
  onBlob?: (type: string | undefined, quality: number | undefined) => void;
}): void {
  stubProperty(HTMLCanvasElement.prototype, 'getContext', () =>
    options.drawImage ? { drawImage: options.drawImage } : null,
  );
  stubProperty(HTMLCanvasElement.prototype, 'toBlob', (callback: BlobCallback, type?: string, quality?: number) => {
    options.onBlob?.(type, quality);
    callback(options.blob ?? null);
  });
}

function stubCreateImageBitmap(bitmap: { width: number; height: number; close: () => void }): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  );
}

function stubUrlSupport(): void {
  stubProperty(
    URL,
    'createObjectURL',
    vi.fn(() => 'blob:local'),
  );
  stubProperty(URL, 'revokeObjectURL', vi.fn());
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

beforeEach(() => {
  copyTextMock.mockReset();
  copyTextMock.mockResolvedValue(true);
});

afterEach(() => {
  for (let index = stubs.length - 1; index >= 0; index -= 1) {
    const stub = stubs[index];
    if (!stub) continue;
    if (stub.original) Object.defineProperty(stub.target, stub.key, stub.original);
    else Reflect.deleteProperty(stub.target, stub.key);
  }
  stubs.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pickFile', () => {
  it('同步点开选择器，选中后返回文件并清掉临时 input', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

    const pending = pickFile('image/*');

    // 必须是同步点击：iOS 只在用户手势的同一轮里允许打开文件选择器。
    expect(click).toHaveBeenCalledOnce();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('临时 input 没有挂到 DOM 上');
    expect(input.getAttribute('accept')).toBe('image/*');

    const file = new File(['raw'], 'photo.png', { type: 'image/png' });
    // jsdom 的 files 只读，测试里直接换成一个数组即可（实现只按下标取第一个）。
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await expect(pending).resolves.toBe(file);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('用户取消（cancel 事件）返回 null，同样清掉临时 input', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

    const pending = pickFile('image/*');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    input?.dispatchEvent(new Event('cancel'));

    await expect(pending).resolves.toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('compressImage', () => {
  it('等比缩到最长边 maxEdge 并输出 JPEG 0.9', async () => {
    const close = vi.fn();
    stubCreateImageBitmap({ width: 2000, height: 1000, close });
    const drawImage = vi.fn();
    const onBlob = vi.fn();
    stubCanvas({ drawImage, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), onBlob });

    const result = await compressImage(new File(['raw'], 'IMG_0001.HEIC', { type: 'image/heic' }), 1080);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(540);
    expect(result.blob.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 2000 }), 0, 0, 1080, 540);
    expect(onBlob).toHaveBeenCalledWith('image/jpeg', 0.9);
    // ImageBitmap 要显式释放，不能把解码后的整张图留在内存里。
    expect(close).toHaveBeenCalledOnce();
  });

  it('本来就够小的图片保持原尺寸', async () => {
    stubCreateImageBitmap({ width: 800, height: 600, close: vi.fn() });
    stubCanvas({ drawImage: vi.fn(), blob: new Blob(['jpeg'], { type: 'image/jpeg' }) });

    await expect(compressImage(new File(['raw'], 'small.jpg', { type: 'image/jpeg' }))).resolves.toMatchObject({
      width: 800,
      height: 600,
    });
  });

  it('createImageBitmap 失败时退回 <img> 解码（HEIC 在老内核上走这条）', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('不支持的格式');
      }),
    );
    stubUrlSupport();
    class FakeImage {
      naturalWidth = 1600;
      naturalHeight = 1200;
      width = 1600;
      height = 1200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    stubCanvas({ drawImage: vi.fn(), blob: new Blob(['jpeg'], { type: 'image/jpeg' }) });

    const result = await compressImage(new File(['raw'], 'photo.heic', { type: 'image/heic' }), 1080);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(810);
    // objectURL 用完即释放。
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
  });

  it('完全没有解码手段时抛 imageDecodeUnsupported', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('坏文件');
      }),
    );
    // 测试环境可能自带创建 objectURL 的能力（Node 的 Blob 实现），显式摘掉才是「老内核」。
    stubProperty(URL, 'createObjectURL', undefined);

    await expect(compressImage(new File(['raw'], 'broken.heic', { type: 'image/heic' }))).rejects.toThrow(
      'imageDecodeUnsupported',
    );
  });

  it('图片加载失败时抛 imageDecodeFailed', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('坏文件');
      }),
    );
    stubUrlSupport();
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage);

    await expect(compressImage(new File(['raw'], 'broken.heic', { type: 'image/heic' }))).rejects.toThrow(
      'imageDecodeFailed',
    );
  });

  it('画布不可用时抛错并释放已解码的图', async () => {
    const close = vi.fn();
    stubCreateImageBitmap({ width: 400, height: 300, close });
    stubProperty(HTMLCanvasElement.prototype, 'getContext', () => null);

    await expect(compressImage(new File(['raw'], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      'imageCanvasUnavailable',
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('编码器没给出 Blob 时抛 imageEncodeFailed', async () => {
    stubCreateImageBitmap({ width: 400, height: 300, close: vi.fn() });
    stubCanvas({ drawImage: vi.fn(), blob: null });

    await expect(compressImage(new File(['raw'], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      'imageEncodeFailed',
    );
  });
});

describe('图片转 data URL', () => {
  it('imageFileToJpegDataUrl 返回 JPEG data URL', async () => {
    stubCreateImageBitmap({ width: 400, height: 300, close: vi.fn() });
    stubCanvas({ drawImage: vi.fn(), blob: new Blob(['jpeg'], { type: 'image/jpeg' }) });

    const dataUrl = await imageFileToJpegDataUrl(new File(['raw'], 'photo.png', { type: 'image/png' }));

    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('blobToDataUrl 读得到 base64 正文', async () => {
    await expect(blobToDataUrl(new Blob(['hello'], { type: 'text/plain' }))).resolves.toBe(
      'data:text/plain;base64,aGVsbG8=',
    );
  });

  it('没有 FileReader 的环境抛 fileReaderUnavailable', async () => {
    vi.stubGlobal('FileReader', undefined);

    await expect(blobToDataUrl(new Blob(['hello']))).rejects.toThrow('fileReaderUnavailable');
  });
});

describe('downloadBlob', () => {
  it('用临时 <a download> 触发下载，并在下一轮任务释放 objectURL', async () => {
    stubUrlSupport();
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });

    downloadBlob(new Blob(['id,title'], { type: 'text/csv' }), 'registrations.csv');

    expect(clicked?.download).toBe('registrations.csv');
    expect(clicked?.href).toBe('blob:local');
    // 临时节点用完就移除，页面里不留隐藏的 <a>。
    expect(document.querySelector('a[download]')).toBeNull();
    // 立刻释放会让 Safari 来不及读内容，必须挪到下一轮。
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await flush();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
  });

  it('没有 objectURL 的环境里安静返回，不抛异常', () => {
    stubProperty(URL, 'createObjectURL', undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    expect(() => downloadBlob(new Blob(['x']), 'x.txt')).not.toThrow();
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('shareText', () => {
  it('有系统分享面板时交给它，不再碰剪贴板', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubProperty(navigator, 'share', share);

    await expect(shareText('秋季展会', 'https://example.com/e/exh-1')).resolves.toEqual({
      shared: true,
      copied: false,
    });
    expect(share).toHaveBeenCalledWith({ title: '秋季展会', text: 'https://example.com/e/exh-1' });
    expect(copyTextMock).not.toHaveBeenCalled();
  });

  it('用户取消（AbortError）返回两个 false，不复制也不抛错', async () => {
    stubProperty(navigator, 'share', vi.fn().mockRejectedValue(new DOMException('取消', 'AbortError')));

    await expect(shareText('秋季展会', 'https://example.com/e/exh-1')).resolves.toEqual({
      shared: false,
      copied: false,
    });
    expect(copyTextMock).not.toHaveBeenCalled();
  });

  it('分享面板拒绝（非取消）时退回复制', async () => {
    stubProperty(navigator, 'share', vi.fn().mockRejectedValue(new TypeError('没有用户手势')));

    await expect(shareText('秋季展会', 'https://example.com/e/exh-1')).resolves.toEqual({
      shared: false,
      copied: true,
    });
    expect(copyTextMock).toHaveBeenCalledWith('https://example.com/e/exh-1');
  });

  it('没有分享面板时直接复制', async () => {
    await expect(shareText('秋季展会', 'https://example.com/e/exh-1')).resolves.toEqual({
      shared: false,
      copied: true,
    });
  });

  it('复制也失败时抛 Error，由页面提示失败', async () => {
    copyTextMock.mockResolvedValue(false);

    await expect(shareText('秋季展会', 'https://example.com/e/exh-1')).rejects.toThrow('copyFailed');
  });
});

describe('shareFile', () => {
  const file = new File(['id,title'], 'registrations.csv', { type: 'text/csv' });

  it('没有系统分享面板时返回 unsupported', async () => {
    await expect(shareFile(file, '报名记录')).resolves.toBe('unsupported');
  });

  it('canShare 说不能分享文件时返回 unsupported，不去唤起面板', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubProperty(navigator, 'share', share);
    stubProperty(
      navigator,
      'canShare',
      vi.fn(() => false),
    );

    await expect(shareFile(file, '报名记录')).resolves.toBe('unsupported');
    expect(share).not.toHaveBeenCalled();
  });

  it('canShare 抛错时按不支持处理', async () => {
    stubProperty(navigator, 'share', vi.fn().mockResolvedValue(undefined));
    stubProperty(
      navigator,
      'canShare',
      vi.fn(() => {
        throw new Error('不认识的字段');
      }),
    );

    await expect(shareFile(file, '报名记录')).resolves.toBe('unsupported');
  });

  it('分享成功返回 shared，文件放在 files 里', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn(() => true);
    stubProperty(navigator, 'share', share);
    stubProperty(navigator, 'canShare', canShare);

    await expect(shareFile(file, '报名记录')).resolves.toBe('shared');
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(share).toHaveBeenCalledWith({ files: [file], title: '报名记录' });
  });

  it('没有 canShare 时仍然尝试分享', async () => {
    stubProperty(navigator, 'share', vi.fn().mockResolvedValue(undefined));

    await expect(shareFile(file, '报名记录')).resolves.toBe('shared');
  });

  it('用户取消返回 cancelled', async () => {
    stubProperty(navigator, 'share', vi.fn().mockRejectedValue(new DOMException('取消', 'AbortError')));
    stubProperty(
      navigator,
      'canShare',
      vi.fn(() => true),
    );

    await expect(shareFile(file, '报名记录')).resolves.toBe('cancelled');
  });

  it('其它分享失败抛 Error，不冒充取消', async () => {
    stubProperty(navigator, 'share', vi.fn().mockRejectedValue(new Error('系统错误')));
    stubProperty(
      navigator,
      'canShare',
      vi.fn(() => true),
    );

    await expect(shareFile(file, '报名记录')).rejects.toThrow('系统错误');
  });
});

describe('requestNotificationPermission', () => {
  it('没有 Notification 时返回 false', async () => {
    vi.stubGlobal('Notification', undefined);

    await expect(requestNotificationPermission()).resolves.toBe(false);
  });

  it('用户同意时返回 true', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') });

    await expect(requestNotificationPermission()).resolves.toBe(true);
  });

  it('用户拒绝时返回 false', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('denied') });

    await expect(requestNotificationPermission()).resolves.toBe(false);
  });

  it('申请抛错时返回 false，不抛异常', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockRejectedValue(new Error('不允许')) });

    await expect(requestNotificationPermission()).resolves.toBe(false);
  });
});

describe('isAbortError', () => {
  it('认得 AbortError，不把普通 Error 当取消', () => {
    expect(isAbortError(new DOMException('取消', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
