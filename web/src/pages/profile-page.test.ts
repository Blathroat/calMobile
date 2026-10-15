import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ProfilePage from './ProfilePage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { closeSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  bootApp: async () => undefined,
  api: { profile: { get: vi.fn(), save: vi.fn() }, auth: { logout: vi.fn() } },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const PROFILE = {
  id: 'u1', username: 'user', nickname: '旧昵称', email: 'user@example.com',
  avatar: '/avatar.jpg', bio: '已有简介', region: '上海', socialMedia: '@user',
  roleLabel: '普通用户', status: '正常', showRegistrations: true,
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
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountProfile(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({
    id: PROFILE.id, username: PROFILE.username, nickname: PROFILE.nickname,
    email: PROFILE.email, avatar: PROFILE.avatar,
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/profile', component: ProfilePage }] });
  await router.push('/profile');
  app = createApp({ render: () => [h(ProfilePage), h(AppSheet)] }).use(pinia).use(router);
  app.mount('#profile-test');
  await nextTick();
}

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.card')];
}

describe('个人页资料展示与编辑', () => {
  it('身份卡显示地区，简介区不再列出地区，铅笔打开与设置页相同的编辑抽屉', async () => {
    await mountProfile();
    await vi.waitFor(() => expect(cards()[0]?.textContent).toContain('上海'));
    expect(cards()[0]?.textContent).not.toContain('user@example.com');
    expect(cards()[0]?.textContent).not.toContain('未填写邮箱');
    expect(cards()[1]?.textContent).toContain('已有简介');
    expect(cards()[1]?.textContent).toContain('社交账号：@user');
    expect(cards()[1]?.textContent).not.toContain('社交账号@');
    expect(cards()[1]?.textContent).not.toContain('地区');
    expect(cards()[1]?.textContent).not.toContain('上海');
    const bioCopy = cards()[1]?.querySelector('p.row-meta');
    expect(bioCopy?.innerHTML).toContain('<br><br>');
    expect(bioCopy?.querySelector('.strong')).toBeNull();

    const edit = cards()[1]?.querySelector<HTMLButtonElement>('button[aria-label="编辑资料"]');
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
    await vi.waitFor(() => expect(api.profile.save).toHaveBeenCalledWith(expect.objectContaining({
      nickname: '旧昵称', bio: '已有简介', region: '杭州', socialMedia: '@user', showRegistrations: true,
    })));
    expect(sheet.current?.closing).toBe(true);
    await vi.waitFor(() => expect(cards()[0]?.textContent).toContain('杭州'));
    expect(cards()[1]?.textContent).not.toContain('杭州');
  });

  it('地区为空时身份卡显示未填写', async () => {
    vi.mocked(api.profile.get).mockResolvedValue({ ...PROFILE, region: '' });
    await mountProfile();
    await vi.waitFor(() => expect(cards()[0]?.textContent).toContain('未填写'));
    expect(cards()[1]?.textContent).not.toContain('地区');
  });

  it('受限账号的铅笔不可用，也不会打开抽屉', async () => {
    vi.mocked(api.profile.get).mockResolvedValue({ ...PROFILE, can: { profile: false } });
    await mountProfile();
    await vi.waitFor(() => expect(document.querySelector('button[aria-label="编辑资料"]')).not.toBeNull());
    const bio = cards().find((card) => card.textContent?.includes('个人简介'));
    const edit = bio?.querySelector<HTMLButtonElement>('button[aria-label="编辑资料"]');
    expect(edit?.disabled).toBe(true);
    edit?.dispatchEvent(new Event('click'));
    await nextTick();
    expect(document.querySelector('.sheet-panel')).toBeNull();
    expect(toast).toHaveBeenCalledWith('账号已被限制，不能编辑个人信息', 'error');
  });
});
