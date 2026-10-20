import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import ProfilePage from './ProfilePage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { closeSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  bootApp: async () => undefined,
  api: {
    profile: { get: vi.fn(), save: vi.fn() },
    auth: { logout: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

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
  vi.mocked(api.profile.get).mockResolvedValue(PROFILE);
  vi.mocked(api.profile.save).mockResolvedValue({ ok: true, user: { ...PROFILE, region: '杭州' } });
  vi.mocked(api.registrations.list).mockResolvedValue([]);
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

  it('设置卡片分别进入设置与安全设置', async () => {
    const router = await mountProfile();
    await vi.waitFor(() => expect(document.querySelectorAll('button.row-card').length).toBe(3));
    const rows = [...document.querySelectorAll<HTMLButtonElement>('button.row-card')];
    const labels = rows.map((item) => item.textContent ?? '');
    expect(labels[0]).toContain('查看公开主页');
    expect(labels[1]).toContain('设置');
    expect(labels[2]).toContain('安全设置');

    rows[1]?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings'));
    await router.push('/profile');
    rows[2]?.click();
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
