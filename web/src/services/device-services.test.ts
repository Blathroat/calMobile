/**
 * 浏览器里的设备能力兜底：没有原生桥时 `device.*` 走 `browser-device` 的标准 Web API，
 * 结果形状与原生回调一致；用户取消是稳定的 `cancelled` 码（页面不弹错），其余失败都带 `t()` 文案。
 *
 * 原生动作名那条契约见 native-bridge.test.ts；这里只锁「浏览器分支」与「原生分支的委托关系」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { NativeBridgeError } from './native-bridge';
import { device } from './device-services';

const mocks = vi.hoisted(() => ({
  hasNative: vi.fn(),
  call: vi.fn(),
  pickFile: vi.fn(),
  compressImage: vi.fn(),
  imageFileToJpegDataUrl: vi.fn(),
  downloadBlob: vi.fn(),
  shareText: vi.fn(),
  shareFile: vi.fn(),
  requestNotificationPermission: vi.fn(),
}));

vi.mock('./browser-device', () => ({
  pickFile: mocks.pickFile,
  compressImage: mocks.compressImage,
  imageFileToJpegDataUrl: mocks.imageFileToJpegDataUrl,
  downloadBlob: mocks.downloadBlob,
  shareText: mocks.shareText,
  shareFile: mocks.shareFile,
  requestNotificationPermission: mocks.requestNotificationPermission,
  isAbortError: (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError',
}));

vi.mock('./native-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./native-bridge')>();
  return { ...actual, nativeBridge: { hasNative: mocks.hasNative, call: mocks.call } };
});

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
let createObjectUrl: ReturnType<typeof vi.fn<(blob: Blob) => string>>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasNative.mockReturnValue(false);
  createObjectUrl = vi.fn<(blob: Blob) => string>(() => 'blob:test');
  URL.createObjectURL = createObjectUrl;
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  vi.unstubAllGlobals();
});

/** 取一个拒绝的 `NativeBridgeError`，便于同时断言类型与文案。 */
async function rejection(promise: Promise<unknown>): Promise<NativeBridgeError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(NativeBridgeError);
  return error as NativeBridgeError;
}

describe('pickImage（浏览器）', () => {
  it('选图成功转成 JPEG dataUrl', async () => {
    const file = new File(['x'], 'photo.heic', { type: 'image/heic' });
    mocks.pickFile.mockResolvedValue(file);
    mocks.imageFileToJpegDataUrl.mockResolvedValue('data:image/jpeg;base64,abc');

    await expect(device.pickImage()).resolves.toEqual({ dataUrl: 'data:image/jpeg;base64,abc' });
    expect(mocks.pickFile).toHaveBeenCalledWith('image/*');
    expect(mocks.imageFileToJpegDataUrl).toHaveBeenCalledWith(file);
  });

  it('用户取消选择器抛稳定 cancelled 码', async () => {
    mocks.pickFile.mockResolvedValue(null);
    await expect(device.pickImage()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('读图失败给「读不到刚选择的文件」', async () => {
    mocks.pickFile.mockResolvedValue(new File(['x'], 'bad.heic', { type: 'image/heic' }));
    mocks.imageFileToJpegDataUrl.mockRejectedValue(new Error('decode failed'));

    const error = await rejection(device.pickImage());
    expect(error.message).toBe(t('media.unreadableFile'));
  });
});

describe('importMedia（浏览器）', () => {
  it('图片压缩后返回 object URL 与 JPEG 元信息', async () => {
    const file = new File(['raw'], 'photo.heic', { type: 'image/heic' });
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    mocks.pickFile.mockResolvedValue(file);
    mocks.compressImage.mockResolvedValue({ blob, width: 800, height: 600 });

    const result = await device.importMedia('image');

    expect(result).toEqual({
      url: 'blob:test',
      kind: 'image',
      fileName: 'photo.heic',
      bytes: blob.size,
      mimeType: 'image/jpeg',
      compressed: true,
    });
    expect(mocks.pickFile).toHaveBeenCalledWith('image/*');
    expect(mocks.compressImage).toHaveBeenCalledWith(file);
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
  });

  it('视频直接返回原文件的 object URL，不压缩', async () => {
    const file = new File(['video'], 'clip.mov', { type: 'video/quicktime' });
    mocks.pickFile.mockResolvedValue(file);

    const result = await device.importMedia('video');

    expect(result).toMatchObject({
      url: 'blob:test',
      kind: 'video',
      fileName: 'clip.mov',
      bytes: file.size,
      mimeType: 'video/quicktime',
      compressed: false,
    });
    expect(mocks.pickFile).toHaveBeenCalledWith('video/*');
    expect(mocks.compressImage).not.toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalledWith(file);
  });

  it('取消选择抛稳定 cancelled 码', async () => {
    mocks.pickFile.mockResolvedValue(null);
    await expect(device.importMedia('image')).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('importText（浏览器）', () => {
  it('读回文本、文件名与字节数', async () => {
    const file = new File(['{"a":1}'], 'pack.json', { type: 'application/json' });
    mocks.pickFile.mockResolvedValue(file);

    await expect(device.importText('application/json', 1024)).resolves.toEqual({
      text: '{"a":1}',
      fileName: 'pack.json',
      bytes: file.size,
    });
    expect(mocks.pickFile).toHaveBeenCalledWith('application/json');
  });

  it('超过大小上限按读不出处理', async () => {
    mocks.pickFile.mockResolvedValue(new File(['0123456789'], 'big.json', { type: 'application/json' }));
    const error = await rejection(device.importText('application/json', 4));
    expect(error.message).toBe(t('media.unreadableFile'));
  });

  it('取消选择抛稳定 cancelled 码', async () => {
    mocks.pickFile.mockResolvedValue(null);
    await expect(device.importText()).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('导出与分享（浏览器）', () => {
  it('exportCsv 下载 CSV 并返回 exported', async () => {
    await expect(device.exportCsv('list.csv', 'a,b\n1,2')).resolves.toEqual({ exported: true });
    const call = mocks.downloadBlob.mock.calls[0]!;
    expect((call[0] as Blob).type).toContain('text/csv');
    expect(call[1]).toBe('list.csv');
  });

  it('exportText 下载文本并带回文件名', async () => {
    await expect(device.exportText('pack.json', '{"a":1}', 'application/json')).resolves.toEqual({
      exported: true,
      fileName: 'pack.json',
    });
    const call = mocks.downloadBlob.mock.calls[0]!;
    expect((call[0] as Blob).type).toBe('application/json');
    expect(call[1]).toBe('pack.json');
  });

  it('shareText 返回 shared / copied 两个事实', async () => {
    mocks.shareText.mockResolvedValue({ shared: true, copied: false });
    await expect(device.shareText('标题', '正文')).resolves.toEqual({ shared: true, copied: false });

    mocks.shareText.mockResolvedValue({ shared: false, copied: true });
    await expect(device.shareText('标题', '正文')).resolves.toEqual({ shared: false, copied: true });
  });

  it('分享面板与剪贴板都不可用时抛分享不可用', async () => {
    mocks.shareText.mockRejectedValue(new Error('copyFailed'));
    const error = await rejection(device.shareText('标题', '正文'));
    expect(error.message).toBe(t('device.shareUnavailable'));
  });

  it('用户取消分享不是错误：原样返回 shared:false', async () => {
    mocks.shareText.mockResolvedValue({ shared: false, copied: false });
    await expect(device.shareText('标题', '正文')).resolves.toEqual({ shared: false, copied: false });
  });

  it('requestNotificationPermission 直接返回浏览器结果', async () => {
    mocks.requestNotificationPermission.mockResolvedValue(true);
    await expect(device.requestNotificationPermission()).resolves.toBe(true);
  });
});

describe('其它浏览器兜底', () => {
  it('ensureCameraPermission 只看有没有 getUserMedia', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    await expect(device.ensureCameraPermission()).resolves.toBe(true);

    vi.stubGlobal('navigator', {});
    await expect(device.ensureCameraPermission()).resolves.toBe(false);
  });

  it('saveImage 把 dataUrl 转成图片下载并返回 saved', async () => {
    await expect(device.saveImage('data:image/png;base64,iVBORw0KGgo=', '')).resolves.toEqual({ saved: true });
    const call = mocks.downloadBlob.mock.calls[0]!;
    expect((call[0] as Blob).type).toBe('image/png');
    expect(call[1]).toBe('image.png');
  });

  it('saveImage 遇到非法 dataUrl 返回 saved:false，不抛异常', async () => {
    await expect(device.saveImage('not-a-data-url', 'x.png')).resolves.toEqual({ saved: false });
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  it('discardMedia 在浏览器里是空操作', async () => {
    await expect(device.discardMedia('temp.jpg')).resolves.toEqual({ ok: true });
  });

  it('storeMedia / sync 只在原生里有，浏览器里以能力缺失失败', async () => {
    for (const error of [
      await rejection(device.storeMedia({ dataUrl: 'data:image/png;base64,x', kind: 'avatar' })),
      await rejection(device.sync({ mode: 'light' })),
    ]) {
      expect(error.message).toBe(t('device.featureUnavailable'));
    }
    expect(mocks.call).not.toHaveBeenCalled();
  });
});

describe('有原生桥时委托给原生动作', () => {
  it('浏览器实现完全不介入，动作名与参数原样交给 bridge.call', async () => {
    mocks.hasNative.mockReturnValue(true);
    mocks.call.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,native' });

    await expect(device.pickImage()).resolves.toEqual({ dataUrl: 'data:image/jpeg;base64,native' });

    expect(mocks.call).toHaveBeenCalledWith('media.pickImage', {});
    expect(mocks.pickFile).not.toHaveBeenCalled();
    expect(mocks.imageFileToJpegDataUrl).not.toHaveBeenCalled();
  });
});

describe('旧壳没有某个原生动作时回退浏览器实现', () => {
  /** 旧 APK：动作不认识，回稳定码 unsupported。 */
  function unsupported(): NativeBridgeError {
    mocks.hasNative.mockReturnValue(true);
    const error = new NativeBridgeError('未实现的动作：media.pickImage', 'unsupported');
    mocks.call.mockRejectedValue(error);
    return error;
  }

  it('pickImage 回退到浏览器选图，动作名仍然对得上', async () => {
    unsupported();
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    mocks.pickFile.mockResolvedValue(file);
    mocks.imageFileToJpegDataUrl.mockResolvedValue('data:image/jpeg;base64,fallback');

    await expect(device.pickImage()).resolves.toEqual({ dataUrl: 'data:image/jpeg;base64,fallback' });
    expect(mocks.call).toHaveBeenCalledWith('media.pickImage', {});
    expect(mocks.pickFile).toHaveBeenCalledWith('image/*');
  });

  it('用户取消不触发回退：原样返回 cancelled', async () => {
    mocks.hasNative.mockReturnValue(true);
    mocks.call.mockRejectedValue(new NativeBridgeError('已取消选择', 'cancelled'));

    const error = await rejection(device.pickImage());
    expect(error.code).toBe('cancelled');
    expect(mocks.pickFile).not.toHaveBeenCalled();
  });

  it('其它失败照旧抛出，不改用浏览器实现', async () => {
    mocks.hasNative.mockReturnValue(true);
    mocks.call.mockRejectedValue(new NativeBridgeError('设备存储已满'));

    const error = await rejection(device.saveImage('data:image/png;base64,x'));
    expect(error.message).toBe('设备存储已满');
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  it('有浏览器实现的动作都能回退', async () => {
    unsupported();
    const file = new File(['{"a":1}'], 'pack.json', { type: 'application/json' });
    mocks.pickFile.mockResolvedValue(file);
    mocks.compressImage.mockResolvedValue({ blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 1, height: 1 });
    mocks.shareText.mockResolvedValue({ shared: true, copied: false });
    mocks.requestNotificationPermission.mockResolvedValue(true);

    await expect(device.importMedia('image')).resolves.toMatchObject({ url: 'blob:test', kind: 'image' });
    await expect(device.importMedia('video')).resolves.toMatchObject({ kind: 'video' });
    await expect(device.importText()).resolves.toMatchObject({ text: '{"a":1}' });
    await expect(device.saveImage('data:image/png;base64,iVBORw0KGgo=')).resolves.toEqual({ saved: true });
    await expect(device.shareText('标题', '正文')).resolves.toEqual({ shared: true, copied: false });
    await expect(device.exportCsv('a.csv', 'a,b')).resolves.toEqual({ exported: true });
    await expect(device.exportText('pack.json', '{}')).resolves.toEqual({ exported: true, fileName: 'pack.json' });
    await expect(device.requestNotificationPermission()).resolves.toBe(true);
    await expect(device.ensureCameraPermission()).resolves.toBe(false);
    await expect(device.discardMedia('temp.jpg')).resolves.toEqual({ ok: true });

    expect(mocks.downloadBlob).toHaveBeenCalledTimes(3);
  });
});
