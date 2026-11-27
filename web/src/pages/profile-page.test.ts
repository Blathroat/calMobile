import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import ProfilePage from './ProfilePage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { openProfileEditor } from '@/services/profile-editor';
import { avatarCropper, closeAvatarCropper } from '@/services/profile-avatar';
import { device } from '@/services/device-services';
import { closeSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  bootApp: async () => undefined,
  api: {
    profile: { get: vi.fn(), save: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn() },
    users: { updateProfile: vi.fn(), uploadAvatar: vi.fn() },
    auth: { logout: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
vi.mock('@/services/device-services', () => ({ device: { pickImage: vi.fn() } }));

const PROFILE = {
  id: 'u1',
  username: 'user',
  nickname: '旧昵称',
  email: 'user@example.com',
  avatar: '/avatar.jpg',
  bio: '已有简介',
  region: '上海',
  socialMedia: '@user',
  role: 'user',
  roleLabel: '普通用户',
  statusCode: 'active',
  showRegistrations: true,
};
let app: App | undefined;

beforeEach(async () => {
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  vi.resetAllMocks();
  document.body.innerHTML = '<div id="profile-test"></div>';
  closeAvatarCropper();
  vi.mocked(api.profile.get).mockResolvedValue(PROFILE);
  vi.mocked(api.profile.save).mockResolvedValue({ ok: true, user: { ...PROFILE, region: '杭州' } });
  vi.mocked(api.users.updateProfile).mockResolvedValue({
    ok: true,
    profile: { id: 'u2', nickname: '别人', bio: '', region: '', socialMedia: '', avatar: '/someone.jpg' },
  });
  vi.mocked(api.users.uploadAvatar).mockResolvedValue({ ok: true, user: { id: 'u2', avatar: '/someone-new.jpg' } });
  vi.mocked(api.registrations.list).mockResolvedValue([]);
  vi.mocked(device.pickImage).mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,BBBB' });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountProfile(extra: Record<string, unknown> = {}): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({
    id: PROFILE.id,
    username: PROFILE.username,
    nickname: PROFILE.nickname,
    email: PROFILE.email,
    avatar: PROFILE.avatar,
    ...extra,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile', component: ProfilePage },
      { path: '/settings', component: { template: '<div />' } },
      { path: '/security', component: { template: '<div />' } },
      { path: '/my-registrations', component: { template: '<div />' } },
      { path: '/user-public/:nickname', component: { template: '<div />' } },
    ],
  });
  await router.push('/profile');
  app = createApp({ render: () => [h(ProfilePage), h(AppSheet)] })
    .use(pinia)
    .use(router);
  app.mount('#profile-test');
  await nextTick();
  return router;
}

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.card')];
}

/** 编辑入口在身份卡右侧，全页只有一个。 */
function editButton(): HTMLButtonElement | undefined {
  return document.querySelector<HTMLButtonElement>('button[aria-label="编辑资料"]') ?? undefined;
}

describe('个人页资料展示与编辑', () => {
  it('身份卡只留身份与活动，简介在简介卡，地区与社交账号在公开资料卡', async () => {
    await mountProfile();
    await vi.waitFor(() => expect(cards()[0]?.textContent).toContain('普通用户'));
    // 正常状态不展示
    expect(cards()[0]?.textContent).not.toContain('正常');
    expect(cards()[0]?.textContent).not.toContain('上海');
    expect(cards()[0]?.textContent).not.toContain('user@example.com');
    expect(cards()[0]?.querySelector('.identity-name')?.textContent).toBe('旧昵称');
    expect(cards()[1]?.textContent).toContain('已有简介');
    expect(cards()[1]?.textContent).not.toContain('社交账号');

    await vi.waitFor(() => expect(cards()[2]?.textContent).toContain('上海'));
    expect(cards()[2]?.textContent).toContain('地区');
    expect(cards()[2]?.textContent).toContain('社交账号');
    expect(cards()[2]?.textContent).toContain('@user');

    const edit = editButton();
    expect(edit?.querySelector('svg')).not.toBeNull();
    edit?.click();
    await nextTick();
    expect(document.querySelector<HTMLInputElement>('.sheet-panel #settings-nickname')?.value).toBe('旧昵称');
    expect(document.querySelector<HTMLTextAreaElement>('.sheet-panel #settings-bio')?.value).toBe('已有简介');
    expect(document.querySelector<HTMLInputElement>('.sheet-panel #settings-region')?.value).toBe('上海');
    expect(document.querySelector<HTMLInputElement>('.sheet-panel #settings-social')?.value).toBe('@user');

    const region = document.querySelector<HTMLInputElement>('.sheet-panel #settings-region')!;
    region.value = '杭州';
    region.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '保存')?.click();
    await vi.waitFor(() =>
      expect(api.profile.save).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: '旧昵称',
          bio: '已有简介',
          region: '杭州',
          socialMedia: '@user',
          showRegistrations: true,
        }),
      ),
    );
    expect(sheet.current?.closing).toBe(true);
    await vi.waitFor(() => expect(cards()[2]?.textContent).toContain('杭州'));
    expect(cards()[1]?.textContent).not.toContain('杭州');
    expect(cards()[0]?.textContent).not.toContain('杭州');
  });

  it('资料抽屉的头像块只剩居中的头像与铅笔，没有标题、大按钮和说明', async () => {
    await mountProfile();
    await vi.waitFor(() => expect(editButton()?.disabled).toBe(false));
    editButton()?.click();
    await nextTick();
    const avatarField = document.querySelector<HTMLElement>('.sheet-panel [data-avatar-field]');
    expect(avatarField).not.toBeNull();
    // 预览在块里、在昵称输入框之前。
    expect(avatarField?.querySelector('.avatar')).not.toBeNull();
    const nickname = document.querySelector('.sheet-panel #settings-nickname')!;
    expect(avatarField!.compareDocumentPosition(nickname) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 没有「头像」标题、说明与上传 / 更换 / 移除大按钮：只剩一颗铅笔。
    expect(avatarField?.querySelector('.field-label')).toBeNull();
    expect(avatarField?.textContent).not.toContain('更换头像');
    expect(avatarField?.textContent).not.toContain('移除头像');
    const buttons = [...(avatarField?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('编辑头像');
    // 铅笔小圆叠在头像右下角。
    expect(avatarField?.querySelector('[data-avatar-edit] .avatar-field-pencil')).not.toBeNull();
  });

  it('点头像铅笔先保存资料并退出抽屉，然后直接拉起系统选图、再弹出裁剪抽屉', async () => {
    await mountProfile();
    await vi.waitFor(() => expect(editButton()?.disabled).toBe(false));
    editButton()?.click();
    await nextTick();
    document.querySelector<HTMLButtonElement>('.sheet-panel [data-avatar-edit]')!.click();
    // 先走一遍 PUT /profile：保存成功才关资料抽屉。
    await vi.waitFor(() => expect(api.profile.save).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(api.profile.save).toHaveBeenCalledWith(expect.objectContaining({ avatar: '/avatar.jpg' }));
    // 保存成功后资料抽屉开始退场，退场动画结束直接拉起系统选图。
    await vi.waitFor(() => expect(sheet.current?.closing).toBe(true), { timeout: 1000 });
    await vi.waitFor(() => expect(device.pickImage).toHaveBeenCalledTimes(1), { timeout: 1000 });
    // 没有中转页：资料抽屉关掉后不会再冒出「编辑头像」面板，只有裁剪抽屉。
    expect(sheet.current).toBeNull();
    await vi.waitFor(() => expect(document.body.textContent).toContain('裁剪头像'), { timeout: 1000 });
  });

  it('资料校验失败时留在资料抽屉，不拉起系统选图也不出现裁剪抽屉', async () => {
    await mountProfile();
    await vi.waitFor(() => expect(editButton()?.disabled).toBe(false));
    editButton()?.click();
    await nextTick();
    const nickname = document.querySelector<HTMLInputElement>('.sheet-panel #settings-nickname')!;
    nickname.value = '';
    nickname.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.sheet-panel [data-avatar-edit]')!.click();
    // 校验失败：不发 PUT、不关抽屉，也不去选图，错误留在原位。
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(api.profile.save).not.toHaveBeenCalled();
    expect(device.pickImage).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('裁剪头像');
    expect(sheet.current?.title).toBe('编辑资料');
    expect(sheet.current?.closing).toBe(false);
    expect(document.querySelector('.sheet-panel #settings-nickname')).not.toBeNull();
    expect(document.querySelector('.sheet-panel .field-error')?.textContent).toContain('昵称');
  });

  it('受限账号即使打开资料抽屉，头像铅笔也不可用', async () => {
    await mountProfile({ can: { profile: false } });
    await vi.waitFor(() => expect(editButton()?.disabled).toBe(true));
    // 页面入口已经禁用；直接打开抽屉验证兜底规则本身（后端也会拒绝写入）。
    openProfileEditor({}, {});
    await nextTick();
    const avatarField = document.querySelector<HTMLElement>('.sheet-panel [data-avatar-field]');
    expect(avatarField).not.toBeNull();
    expect(avatarField?.textContent).toContain('账号已被限制，不能编辑个人信息');
    const pencil = avatarField?.querySelector<HTMLButtonElement>('[data-avatar-edit]');
    expect(pencil?.disabled).toBe(true);
    // 点了也不会离开资料抽屉去选图或弹裁剪抽屉。
    pencil?.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(sheet.current?.title).toBe('编辑资料');
    expect(device.pickImage).not.toHaveBeenCalled();
    expect(api.profile.uploadAvatar).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('裁剪头像');
  });

  it('管理员代改别人资料时头像块显示目标用户头像，不是管理员自己的', async () => {
    await mountProfile();
    openProfileEditor({ id: 'u2', nickname: '别人', avatar: '/someone.jpg' }, { targetUserId: 'u2' });
    await nextTick();
    const avatarField = document.querySelector<HTMLElement>('.sheet-panel [data-avatar-field]');
    expect(avatarField).not.toBeNull();
    // 预览用目标用户的头像；管理员会话里的 /avatar.jpg 不能出现在抽屉里。
    const image = avatarField?.querySelector<HTMLImageElement>('.avatar img');
    expect(image?.getAttribute('src')).toContain('/someone.jpg');
    expect(image?.getAttribute('src')).not.toContain('/avatar.jpg');
    expect(avatarField?.querySelector('[data-avatar-edit]')?.getAttribute('aria-label')).toBe('编辑头像');
    expect(document.querySelector<HTMLInputElement>('.sheet-panel #settings-nickname')?.value).toBe('别人');
  });

  it('管理员代改时点铅笔：先走管理员保存接口，成功后关抽屉并拉起选图与裁剪', async () => {
    const onSaved = vi.fn();
    await mountProfile();
    openProfileEditor({ id: 'u2', nickname: '别人', avatar: '/someone.jpg' }, { targetUserId: 'u2', onSaved });
    await nextTick();
    document.querySelector<HTMLButtonElement>('.sheet-panel [data-avatar-edit]')!.click();
    // 保存走 PUT /users/:id/profile，不能用本人接口，也不能用管理员自己的头像覆盖目标。
    await vi.waitFor(() => expect(api.users.updateProfile).toHaveBeenCalledTimes(1), { timeout: 1000 });
    const [targetId, payload] = vi.mocked(api.users.updateProfile).mock.calls[0]!;
    expect(targetId).toBe('u2');
    expect(payload).toEqual(expect.objectContaining({ nickname: '别人', avatar: '/someone.jpg' }));
    expect(api.profile.save).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    // 保存成功后资料抽屉退场，随后直接拉起系统选图、弹出裁剪抽屉（上传接口由裁剪层选择）。
    await vi.waitFor(() => expect(sheet.current?.closing).toBe(true), { timeout: 1000 });
    await vi.waitFor(() => expect(device.pickImage).toHaveBeenCalledTimes(1), { timeout: 1000 });
    await vi.waitFor(() => expect(document.body.textContent).toContain('裁剪头像'), { timeout: 1000 });
    // 裁剪抽屉带着目标账号打开：上传会走 POST /users/:id/avatar。
    expect(avatarCropper.targetUserId).toBe('u2');
    // 管理员自己的头像没有被改。
    expect(useSessionStore().user.avatar).toBe('/avatar.jpg');
  });

  it('地区为空时公开资料卡显示未填写', async () => {
    vi.mocked(api.profile.get).mockResolvedValue({ ...PROFILE, region: '' });
    await mountProfile();
    await vi.waitFor(() => expect(cards()[2]?.textContent).toContain('未填写'));
    expect(cards()[0]?.textContent).not.toContain('未填写');
  });

  it('没有简介时给出可点的缺省提示，不把提示画成正文', async () => {
    vi.mocked(api.profile.get).mockResolvedValue({ ...PROFILE, bio: '' });
    await mountProfile();
    await vi.waitFor(() => expect(document.body.textContent).toContain('还没有简介'));
    expect(document.querySelector('.bio-text')).toBeNull();
    const fill = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '填写简介',
    );
    expect(fill?.disabled).toBe(false);
    fill?.click();
    await nextTick();
    expect(document.querySelector('.sheet-panel #settings-bio')).not.toBeNull();
  });

  it('受限账号的铅笔与「填写简介」不可用，也不会打开抽屉', async () => {
    vi.mocked(api.profile.get).mockResolvedValue({ ...PROFILE, bio: '', can: { profile: false } });
    await mountProfile();
    const edit = editButton();
    const fill = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '填写简介',
    );
    await vi.waitFor(() => expect(edit?.disabled).toBe(true));
    expect(fill?.disabled).toBe(true);
    expect(document.body.textContent).toContain('账号已被限制，不能编辑个人信息');
    edit?.dispatchEvent(new Event('click'));
    await nextTick();
    expect(document.querySelector('.sheet-panel')).toBeNull();
    expect(toast).toHaveBeenCalledWith('账号已被限制，不能编辑个人信息', 'error');
  });

  it('活动概览显示已参加与报名记录数，点击进入我的活动', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'r1', statusCode: 'attended' },
      { id: 'r2', statusCode: 'approved' },
      { id: 'r3', statusCode: 'cancelled' },
    ]);
    const router = await mountProfile();
    await vi.waitFor(() => expect(document.querySelectorAll('.profile-stat strong')).toHaveLength(2));
    const numbers = [...document.querySelectorAll('.profile-stat strong')].map((item) => item.textContent?.trim());
    expect(numbers).toEqual(['1', '3']);
    const stats = document.querySelector<HTMLButtonElement>('.profile-stats');
    expect(stats?.textContent).toContain('已参加展会');
    expect(stats?.textContent).toContain('报名记录');
    stats?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/my-registrations'));
  });

  it('活动概览取不到时整块不显示，资料仍然正常', async () => {
    vi.mocked(api.registrations.list).mockRejectedValue(new Error('offline'));
    await mountProfile();
    await vi.waitFor(() => expect(cards()[0]?.textContent).toContain('普通用户'));
    expect(document.querySelector('.profile-stats')).toBeNull();
    expect(cards()[2]?.textContent).toContain('上海');
  });

  it('公开主页入口按展示策略给出说明，并进入自己的公开页', async () => {
    const router = await mountProfile();
    await vi.waitFor(() => expect(document.body.textContent).toContain('公开页展示报名记录'));
    const row = [...document.querySelectorAll<HTMLButtonElement>('button.row-card')].find((item) =>
      item.textContent?.includes('查看公开主页'),
    );
    expect(row).not.toBeUndefined();
    row?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.params.nickname).toBe('旧昵称'));
    expect(router.currentRoute.value.query.userId).toBe('u1');
  });

  it('关闭公开展示时公开主页入口改为仅展示资料', async () => {
    vi.mocked(api.profile.get).mockResolvedValue({ ...PROFILE, showRegistrations: false });
    await mountProfile();
    await vi.waitFor(() => expect(document.body.textContent).toContain('公开页仅展示资料'));
  });

  it('账号入口收在「账号与入口」组里：我的活动、公开主页、设置与安全设置各一行', async () => {
    const router = await mountProfile();
    await vi.waitFor(() => expect(document.querySelectorAll('button.row-card').length).toBe(4));
    // 组标题与设置页的「账号」组同名，入口不再零散地跟在资料后面。
    const entries = document.querySelector('.profile-entries');
    expect(entries?.querySelector('.section-label')?.textContent?.trim()).toBe('账号');
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.profile-entries button.row-card')];
    const labels = rows.map((item) => item.textContent ?? '');
    // 我的活动排第一：报名与私人会议总有入口，不依赖活动概览取数成功。
    expect(labels[0]).toContain('我的活动');
    expect(labels[0]).toContain('展会报名与私人会议');
    expect(labels[1]).toContain('查看公开主页');
    expect(labels[2]).toContain('设置');
    expect(labels[3]).toContain('安全设置');

    rows[0]?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/my-registrations'));
    await router.push('/profile');
    rows[2]?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings'));
    await router.push('/profile');
    rows[3]?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/security'));
  });

  it('限时展商显示有效期，快到期时提示可以续期', async () => {
    const expiresAt = new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString();
    await mountProfile({ role: 'exhibitor', roleLabel: '展商', exhibitorExpiresAt: expiresAt });
    await vi.waitFor(() => expect(cards()[0]?.textContent).toContain('展商有效期至'));
    expect(cards()[0]?.textContent).toContain('展商');
    expect(document.body.textContent).toContain('展商身份还有3天到期');
    expect(document.body.textContent).toContain('填写邀请码续期');
    expect(document.body.textContent).not.toContain('展商身份已于');
  });

  it('自动到期的展商显示到期说明和续期方式', async () => {
    const expiredAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await mountProfile({
      role: 'user',
      roleLabel: '普通用户',
      exhibitorExpired: true,
      exhibitorExpiresAt: expiredAt,
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain('展商身份已于'));
    expect(document.body.textContent).toContain('到期，可在设置里填写邀请码续期。');
    expect(cards()[0]?.textContent).not.toContain('展商有效期至');
    // 到期属于「要注意但没坏」的提醒，tone 是 warn。
    expect(document.querySelector('.notice[data-tone="warn"]')).not.toBeNull();
  });

  it('晚到的旧资料不会盖掉刚换上的头像', async () => {
    let release!: (value: typeof PROFILE) => void;
    vi.mocked(api.profile.get).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await mountProfile();
    const session = useSessionStore();
    session.bumpProfile();
    session.applyUser({ ...session.user, avatar: '/new.jpg' });
    release(PROFILE);
    await vi.waitFor(() => expect(session.user.avatar).toBe('/new.jpg'));
    await Promise.resolve();
    await nextTick();
    expect(session.user.avatar).toBe('/new.jpg');
    expect(document.querySelector('img')?.getAttribute('src')).toContain('/new.jpg');
  });
});
