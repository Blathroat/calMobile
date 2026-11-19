/**
 * 头像裁剪抽屉：系统选图之后由个人页 / 用户设置页常驻渲染，裁剪完直接上传。
 *
 * `AvatarCropper` 是独立的全屏面板（依赖图片加载与手势），这里用桩替掉它，只验证
 * `ProfileAvatarCropper` 自己的状态、上传与失败处理；真实裁剪面板另有组件测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ProfileAvatarCropper from './ProfileAvatarCropper.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { closeAvatarCropper, openAvatarCropper } from '@/services/profile-avatar';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  api: { profile: { uploadAvatar: vi.fn() } },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
/** 裁剪面板的桩：点按钮分别发 done / close / error，done 带一张可解析的小 data URL。 */
vi.mock('@/components/AvatarCropper.vue', async () => {
  const { h } = await import('vue');
  const DONE_URL = 'data:image/jpeg;base64,AAAA';
  const stub = {
    props: ['source', 'mime'],
    emits: ['done', 'close', 'error'],
    setup(props: { source?: string }, { emit }: { emit: (event: string, value?: string) => void }) {
      return () =>
        h('div', { class: 'crop-stub', 'data-source': String(props.source ?? '') }, [
          h(
            'button',
            {
              id: 'crop-done',
              type: 'button',
              // source 是 'bad-crop' 时发一个认不出的结果，用来覆盖解析失败分支。
              onClick: () => emit('done', props.source === 'bad-crop' ? 'not-a-data-url' : DONE_URL),
            },
            'done',
          ),
          h('button', { id: 'crop-close', type: 'button', onClick: () => emit('close') }, 'close'),
          h('button', { id: 'crop-error', type: 'button', onClick: () => emit('error', '图片还没加载完') }, 'error'),
        ]);
    },
  };
  return { default: stub };
});

const PROFILE = { id: 'u1', nickname: '旧昵称', avatar: '/avatar.jpg' };
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="avatar-crop-test"></div>';
  closeAvatarCropper();
  vi.mocked(api.profile.uploadAvatar).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '/new.jpg' } });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  closeAvatarCropper();
  document.body.innerHTML = '';
});

function mount(): void {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ ...PROFILE });
  app = createApp(ProfileAvatarCropper).use(pinia);
  app.mount('#avatar-crop-test');
}

describe('头像裁剪抽屉', () => {
  it('没有待裁剪的图片时不渲染裁剪面板', () => {
    mount();
    expect(document.querySelector('.crop-stub')).toBeNull();
  });

  it('选到图后把 source 交给裁剪面板，取消即收起且不留下状态', async () => {
    mount();
    openAvatarCropper('data:image/jpeg;base64,BBBB');
    await nextTick();
    expect(document.querySelector<HTMLElement>('.crop-stub')?.dataset.source).toBe('data:image/jpeg;base64,BBBB');

    document.querySelector<HTMLButtonElement>('#crop-close')!.click();
    await nextTick();
    expect(document.querySelector('.crop-stub')).toBeNull();
  });

  it('裁剪完成直接上传：刷新会话、通知调用方并收起面板', async () => {
    const onUpdated = vi.fn();
    mount();
    openAvatarCropper('data:image/jpeg;base64,BBBB', onUpdated);
    await nextTick();

    document.querySelector<HTMLButtonElement>('#crop-done')!.click();
    await vi.waitFor(() => expect(api.profile.uploadAvatar).toHaveBeenCalledTimes(1));
    const [bytes, contentType] = vi.mocked(api.profile.uploadAvatar).mock.calls[0]!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe('image/jpeg');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('头像已更新', 'success'));
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ avatar: '/new.jpg' }));
    expect(useSessionStore().user.avatar).toBe('/new.jpg');
    expect(document.querySelector('.crop-stub')).toBeNull();
  });

  it('裁剪结果认不出时不发请求，只提示并收起面板', async () => {
    mount();
    // 桩在 source 是 'bad-crop' 时返回一个认不出的结果。
    openAvatarCropper('bad-crop');
    await nextTick();
    document.querySelector<HTMLButtonElement>('#crop-done')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('未能读取所选图片', 'error'));
    expect(api.profile.uploadAvatar).not.toHaveBeenCalled();
    expect(document.querySelector('.crop-stub')).toBeNull();
  });

  it('上传失败时提示错误并收起面板，不污染会话', async () => {
    vi.mocked(api.profile.uploadAvatar).mockRejectedValue(new Error('服务器空间已满'));
    const onUpdated = vi.fn();
    mount();
    openAvatarCropper('data:image/jpeg;base64,BBBB', onUpdated);
    await nextTick();
    document.querySelector<HTMLButtonElement>('#crop-done')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('服务器空间已满', 'error'));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(useSessionStore().user.avatar).toBe('/avatar.jpg');
    expect(document.querySelector('.crop-stub')).toBeNull();
  });

  it('裁剪面板报错只做轻提示，面板留在原地让用户重试', async () => {
    mount();
    openAvatarCropper('data:image/jpeg;base64,BBBB');
    await nextTick();
    document.querySelector<HTMLButtonElement>('#crop-error')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('图片还没加载完', 'error'));
    expect(document.querySelector('.crop-stub')).not.toBeNull();
  });
});
