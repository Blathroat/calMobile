import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import UserSettingsPage from './UserSettingsPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { closeSheet, sheet } from '@/services/sheet';

vi.mock('@/app/runtime', () => ({
  bootApp: async () => undefined,
  api: {
    profile: {
      get: vi.fn(),
      notifications: vi.fn(),
      save: vi.fn(),
      removeAvatar: vi.fn(),
      saveNotifications: vi.fn(),
    },
  },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const PROFILE = {
  id: 'u1',
  username: 'user',
  nickname: '旧昵称',
  avatar: '/avatar.jpg',
  bio: '已有简介',
  region: '上海',
  socialMedia: '@user',
  showRegistrations: true,
};
let app: App | undefined;

beforeEach(async () => {
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  vi.resetAllMocks();
  document.body.innerHTML = '<div id="app-foot"></div><div id="settings-test"></div>';
  vi.mocked(api.profile.get).mockResolvedValue(PROFILE);
  vi.mocked(api.profile.notifications).mockResolvedValue({ exhibitionReminder: true, registrationUpdates: true });
  vi.mocked(api.profile.save).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '' } });
  vi.mocked(api.profile.removeAvatar).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '' } });
  vi.mocked(api.profile.saveNotifications).mockResolvedValue({ ok: true, notify: { exhibitionReminder: false } });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountSettings(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 启动身份摘要中有头像，但完整资料必须成功加载后才可覆盖写入。
  useSessionStore().applyUser({ id: PROFILE.id, username: PROFILE.username, avatar: PROFILE.avatar });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings', component: UserSettingsPage }],
  });
  await router.push('/settings');
  app = createApp({ render: () => [h(UserSettingsPage), h(AppSheet)] })
    .use(pinia)
    .use(router);
  app.mount('#settings-test');
  await nextTick();
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
}

describe('设置页独立取数状态', () => {
  it('资料失败时阻止头像覆盖写入，通知可保存，重试成功后保留完整资料', async () => {
    vi.mocked(api.profile.get).mockRejectedValueOnce(new Error('资料请求暂时失败'));
    await mountSettings();
    await vi.waitFor(() => expect(button('移除头像')).toBeDefined());
    button('移除头像')!.click();
    await nextTick();
    expect(api.profile.removeAvatar).not.toHaveBeenCalled();
    expect(button('移除头像')!.disabled).toBe(true);
    expect(button('编辑资料')!.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#settings-privacy-registrations')!.disabled).toBe(true);
    button('移除头像')!.dispatchEvent(new Event('click'));
    await nextTick();
    expect(api.profile.removeAvatar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('资料请求暂时失败');

    const reminder = document.querySelector<HTMLInputElement>('#notify-reminder')!;
    expect(reminder.disabled).toBe(false);
    reminder.click();
    await vi.waitFor(() => expect(api.profile.saveNotifications).toHaveBeenCalledWith({ exhibitionReminder: false }));

    button('重试')!.click();
    await vi.waitFor(() => expect(button('移除头像')!.disabled).toBe(false));
    expect(api.profile.notifications).toHaveBeenCalledTimes(1);
    button('移除头像')!.click();
    await vi.waitFor(() => expect(api.profile.removeAvatar).toHaveBeenCalled());
  });

  it('通知偏好失败时禁用其开关并可独立重试，资料仍然可以编辑', async () => {
    vi.mocked(api.profile.notifications).mockRejectedValueOnce(new Error('通知请求暂时失败'));
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    expect(button('编辑资料')!.disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#notify-reminder')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('通知请求暂时失败');
    button('重试')!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#notify-reminder')!.disabled).toBe(false));
    expect(api.profile.get).toHaveBeenCalledTimes(1);
  });

  it('资料编辑在抽屉里完成并在保存成功后关闭', async () => {
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    const actions = document.querySelector('.card .action-row');
    expect([...(actions?.querySelectorAll('button') ?? [])].map((item) => item.textContent?.trim())).toEqual([
      '编辑资料',
      '更换头像',
      '移除头像',
    ]);
    button('编辑资料')!.click();
    await nextTick();
    expect(document.querySelector('.sheet-panel #settings-nickname')).not.toBeNull();
    expect(document.querySelector('.sheet-panel #settings-bio')).not.toBeNull();
    expect(document.querySelector('.sheet-panel #settings-region')).not.toBeNull();
    expect(document.querySelector('.sheet-panel #settings-social')).not.toBeNull();

    const nickname = document.querySelector<HTMLInputElement>('.sheet-panel #settings-nickname')!;
    nickname.value = '新昵称';
    nickname.dispatchEvent(new Event('input', { bubbles: true }));
    button('保存')!.click();
    await vi.waitFor(() =>
      expect(api.profile.save).toHaveBeenCalledWith(expect.objectContaining({ nickname: '新昵称' })),
    );
    expect(sheet.current?.closing).toBe(true);
  });

  it('按账号、通知与隐私、外观、语言分组', async () => {
    await mountSettings();
    await vi.waitFor(() => expect(button('移除头像')).toBeDefined());
    const labels = [...document.querySelectorAll('.settings-section .section-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual(['账号', '通知与隐私', '外观', '语言']);
  });

  it('不再提供安全设置入口', async () => {
    await mountSettings();
    await vi.waitFor(() => expect(button('移除头像')).toBeDefined());
    expect(document.querySelectorAll('button.row-card')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('安全设置');
  });

  it('邀请码只对普通用户显示，并放在页面最底部', async () => {
    await mountSettings();
    await vi.waitFor(() => expect(button('移除头像')).toBeDefined());
    const groups = document.querySelector('.settings-groups');
    expect(groups?.lastElementChild?.querySelector('#settings-invite')).not.toBeNull();

    useSessionStore().applyUser({ ...useSessionStore().user, role: 'exhibitor' });
    await nextTick();
    expect(document.querySelector('#settings-invite')).toBeNull();
  });
});
