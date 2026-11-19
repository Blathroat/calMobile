/**
 * 头像编辑抽屉的内容组件：预览跟着会话里的头像走，选图 → 裁剪 → 上传立即保存，
 * 移除同样立即保存；失败在原位显示错误。抽屉本身的开关在 profile-editor 里，
 * 这里直接挂内容组件，不经过 AppSheet。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ProfileAvatarSheet from './ProfileAvatarSheet.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { device } from '@/services/device-services';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  api: { profile: { uploadAvatar: vi.fn(), removeAvatar: vi.fn() } },
}));
vi.mock('@/services/device-services', () => ({ device: { pickImage: vi.fn() } }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const PROFILE = {
  id: 'u1',
  username: 'user',
  nickname: '旧昵称',
  avatar: '/avatar.jpg',
  can: { profile: true },
};
let app: App | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '<div id="avatar-test"></div>';
  vi.mocked(api.profile.uploadAvatar).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '/new.jpg' } });
  vi.mocked(api.profile.removeAvatar).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '' } });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** 挂载抽屉内容；返回调用方拿到的合流回调。 */
function mountSheet(avatar = '/avatar.jpg', extra: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ ...PROFILE, avatar, ...extra });
  const onAvatarUpdated = vi.fn();
  app = createApp({ render: () => h(ProfileAvatarSheet, { onAvatarUpdated }) });
  app.use(pinia);
  app.mount('#avatar-test');
  return onAvatarUpdated;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
}

/** 让裁剪面板以为图片已经解码，并让导出走 mock 的 canvas。 */
function finishCrop(dataUrl = 'data:image/jpeg;base64,AAAA'): void {
  const image = document.querySelector<HTMLImageElement>('.crop-image')!;
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 400 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 400 });
  image.dispatchEvent(new Event('load'));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl);
}

describe('头像编辑抽屉内容', () => {
  it('换头像：选图 → 裁剪 → 上传后刷新会话并通知调用方', async () => {
    const updated = mountSheet();
    await nextTick();
    // 预览跟着会话里的头像走。
    expect(document.querySelector('.avatar img')?.getAttribute('src')).toBe('/avatar.jpg');
    expect(button('更换头像')).toBeDefined();

    vi.mocked(device.pickImage).mockResolvedValue({ dataUrl: 'data:image/png;base64,AAAA' });
    button('更换头像')!.click();
    // 裁剪面板叠在抽屉上；图片解码完成后才能导出。
    await vi.waitFor(() => expect(document.querySelector('.crop-image')).not.toBeNull());
    finishCrop();
    button('使用这张')!.click();

    await vi.waitFor(() => expect(api.profile.uploadAvatar).toHaveBeenCalledTimes(1));
    // 裁剪结果按字节上传，格式与裁剪导出（jpeg）一致。
    const [bytes, contentType] = vi.mocked(api.profile.uploadAvatar).mock.calls[0]!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe('image/jpeg');
    await vi.waitFor(() => expect(useSessionStore().user.avatar).toBe('/new.jpg'));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ avatar: '/new.jpg' }));
    expect(toast).toHaveBeenCalledWith('头像已更新', 'success');
  });

  it('移除头像：调用接口、刷新会话并通知调用方，按钮变回上传', async () => {
    const updated = mountSheet();
    await nextTick();
    button('移除头像')!.click();
    await vi.waitFor(() => expect(api.profile.removeAvatar).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useSessionStore().user.avatar).toBe(''));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ avatar: '' }));
    expect(toast).toHaveBeenCalledWith('头像已移除', 'success');
    await nextTick();
    // 没有头像之后没有可移除的东西：只剩上传主按钮。
    expect(button('移除头像')).toBeUndefined();
    expect(button('上传头像')).toBeDefined();
  });

  it('没有头像时只有上传主按钮', async () => {
    mountSheet('');
    await nextTick();
    expect(button('上传头像')).toBeDefined();
    expect(button('移除头像')).toBeUndefined();
  });

  it('取消选图保持静默，移除失败在原位显示错误并保留头像', async () => {
    mountSheet();
    await nextTick();
    vi.mocked(device.pickImage).mockRejectedValue(Object.assign(new Error('用户取消'), { code: 'cancelled' }));
    button('更换头像')!.click();
    await vi.waitFor(() => expect(device.pickImage).toHaveBeenCalledTimes(1));
    // 系统选择器里点了取消：不弹提示。
    expect(toast).not.toHaveBeenCalled();
    expect(document.querySelector('.crop-image')).toBeNull();

    vi.mocked(api.profile.removeAvatar).mockRejectedValue(new Error('服务器忙'));
    button('移除头像')!.click();
    await vi.waitFor(() => expect(document.querySelector('.field-error')?.textContent).toContain('服务器忙'));
    expect(toast).toHaveBeenCalledWith('服务器忙', 'error');
    expect(useSessionStore().user.avatar).toBe('/avatar.jpg');
  });

  it('受限账号的动作不可用并原位说明原因', async () => {
    mountSheet('/avatar.jpg', { can: { profile: false } });
    await nextTick();
    expect(button('更换头像')!.disabled).toBe(true);
    expect(button('移除头像')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('账号已被限制，不能编辑个人信息');
  });
});
