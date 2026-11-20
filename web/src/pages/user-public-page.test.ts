/**
 * 用户公开页的身份卡：已参加展会数始终展示，不受「展示我的报名」开关影响；
 * 开关只决定下方报名记录列表是否可见。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import UserPublicPage from './UserPublicPage.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { sheet, closeSheet } from '@/services/sheet';

vi.mock('@/app/runtime', () => ({
  api: { users: { publicProfile: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn() } },
}));

const PROFILE = {
  found: true,
  id: 'u1',
  nickname: 'user',
  role: '普通用户',
  roleCode: 'user',
  bio: '简介',
  region: '上海',
  socialMedia: '@user',
  avatar: '/public.jpg',
  showRegistrations: false,
  attendedCount: 3,
  registrations: [],
  exhibitions: [],
  viewedAsAdmin: false,
};
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="public-test"></div>';
  vi.mocked(api.users.publicProfile).mockResolvedValue(PROFILE);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  closeSheet();
  document.body.innerHTML = '';
});

async function mountPublic(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 公开页允许本人查看：这里用另一个账号访问，走普通访客视角。
  useSessionStore().applyUser({ id: 'viewer', username: 'viewer', loggedIn: true });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/user-public/:nickname', component: UserPublicPage }],
  });
  await router.push('/user-public/user');
  app = createApp(UserPublicPage).use(pinia).use(router);
  app.mount('#public-test');
}

describe('用户公开页身份卡', () => {
  it('关闭展示报名时仍显示已参加数，报名列表只给隐藏说明', async () => {
    await mountPublic();
    await vi.waitFor(() => expect(document.querySelector('.profile-stats')).not.toBeNull());
    expect(document.querySelector('.profile-stats')?.textContent).toContain('3');
    expect(document.body.textContent).toContain('已参加展会');
    expect(document.body.textContent).toContain('该用户选择不展示报名记录。');
    // 普通视角没有管理员铅笔。
    expect(document.querySelector('.public-edit')).toBeNull();
  });

  it('管理员视角昵称右侧出现铅笔，点击打开资料抽屉并预填目标用户', async () => {
    vi.mocked(api.users.publicProfile).mockResolvedValue({ ...PROFILE, viewedAsAdmin: true });
    await mountPublic();
    await vi.waitFor(() => expect(document.querySelector('.public-edit')).not.toBeNull());

    const pencil = document.querySelector<HTMLButtonElement>('.public-edit')!;
    expect(pencil.getAttribute('aria-label')).toBe('编辑资料');
    pencil.click();
    expect(sheet.current?.title).toBe('编辑资料');
    const form = sheet.current?.props.form as { nickname: string; bio: string } | undefined;
    expect(form?.nickname).toBe('user');
    expect(form?.bio).toBe('简介');
    // 头像块也渲染，并且预览的是目标用户的公开头像；目标是否受限不影响管理员操作。
    expect(sheet.current?.props.showAvatar).toBe(true);
    expect(sheet.current?.props.avatar).toBe('/public.jpg');
    expect(sheet.current?.props.nickname).toBe('user');
    expect(sheet.current?.props.limited).toBe(false);
  });

  it('管理员保存资料走用户管理接口，不使用当前管理员会话', async () => {
    vi.mocked(api.users.publicProfile).mockResolvedValue({ ...PROFILE, viewedAsAdmin: true });
    vi.mocked(api.users.updateProfile).mockResolvedValue({
      ok: true,
      profile: { nickname: '新昵称', bio: '新简介', region: '上海', socialMedia: '@user', showRegistrations: false },
    } as never);
    await mountPublic();
    await vi.waitFor(() => expect(document.querySelector('.public-edit')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.public-edit')?.click();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    const form = sheet.current?.props.form as { nickname: string };
    form.nickname = '新昵称';
    const save = sheet.current?.actions.find((action) => action.label === '保存');
    expect(save).not.toBeUndefined();
    await save!.onClick?.(() => undefined);
    await vi.waitFor(() => expect(api.users.updateProfile).toHaveBeenCalledTimes(1));
    const [targetId, payload] = vi.mocked(api.users.updateProfile).mock.calls[0]!;
    expect(targetId).toBe('u1');
    expect((payload as { nickname?: string }).nickname).toBe('新昵称');
  });

  it('打开展示报名后计数照常显示，列表出现记录', async () => {
    vi.mocked(api.users.publicProfile).mockResolvedValue({
      ...PROFILE,
      showRegistrations: true,
      attendedCount: 4,
      registrations: [{ id: 'r1', exhibitionTitle: '展会甲', statusCode: 'attended' }],
    });
    await mountPublic();
    await vi.waitFor(() => expect(document.body.textContent).toContain('展会甲'));
    expect(document.querySelector('.profile-stats')?.textContent).toContain('4');
  });
});
