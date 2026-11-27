import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import UserSettingsPage from './UserSettingsPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { api } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { nativeBridge } from '@/services/native-bridge';
import { shouldOfferPwaInstall } from '@/services/pwa';
import { closeAvatarCropper } from '@/services/profile-avatar';
import { device } from '@/services/device-services';
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
vi.mock('@/services/device-services', () => ({ device: { pickImage: vi.fn() } }));
// 安装入口是否出现由平台与原生桥判断；这里只控制「浏览器里还没安装」这一种状态。
vi.mock('@/services/pwa', () => ({
  shouldOfferPwaInstall: vi.fn(),
}));

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

beforeEach(() => {
  // 减少动效时抽屉退场动画是 0ms，用例不必真等 220ms（与其它页面测试同一套桩）。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  if (sheet.current) closeSheet();
  vi.resetAllMocks();
  document.body.innerHTML = '<div id="app-foot"></div><div id="settings-test"></div>';
  vi.mocked(api.profile.get).mockResolvedValue(PROFILE);
  vi.mocked(api.profile.notifications).mockResolvedValue({ exhibitionReminder: true, registrationUpdates: true });
  vi.mocked(api.profile.save).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '' } });
  vi.mocked(api.profile.removeAvatar).mockResolvedValue({ ok: true, user: { ...PROFILE, avatar: '' } });
  vi.mocked(api.profile.saveNotifications).mockResolvedValue({ ok: true, notify: { exhibitionReminder: false } });
  closeAvatarCropper();
  vi.mocked(device.pickImage).mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,BBBB' });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  // hasNative 是真实单例上的 spy，测试之间必须还原，避免后面的用例误进原生模式。
  vi.restoreAllMocks();
});

async function mountSettings(
  options: { theme?: { colors: string[]; index: number }; native?: boolean } = {},
): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 启动身份摘要中有头像，但完整资料必须成功加载后才可覆盖写入。
  useSessionStore().applyUser({ id: PROFILE.id, username: PROFILE.username, avatar: PROFILE.avatar });
  if (options.theme) useBootstrapStore().apply({ theme: options.theme });
  if (options.native) vi.spyOn(nativeBridge, 'hasNative').mockReturnValue(true);
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
  it('资料失败时不能覆盖写入：身份卡仍在、编辑入口不可用，通知可保存，重试后恢复', async () => {
    vi.mocked(api.profile.get).mockRejectedValueOnce(new Error('资料请求暂时失败'));
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    // 身份卡仍在（头像、昵称、角色、邮箱）——资料失败时也不清空。
    expect(document.querySelector('.card .identity-name')).not.toBeNull();
    expect(document.querySelector('.card .avatar')).not.toBeNull();
    // 设置页只剩身份展示：头像编辑入口在资料抽屉里，这里一个按钮都不该有。
    expect(button('上传头像')).toBeUndefined();
    expect(button('更换头像')).toBeUndefined();
    expect(button('移除头像')).toBeUndefined();
    // 资料没加载成功时抽屉不许打开，头像与文字资料都不会被覆盖写入。
    expect(button('编辑资料')!.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#settings-privacy-registrations')!.disabled).toBe(true);
    button('编辑资料')!.dispatchEvent(new Event('click'));
    await nextTick();
    expect(document.querySelector('.sheet-panel')).toBeNull();
    expect(api.profile.removeAvatar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('资料请求暂时失败');

    const reminder = document.querySelector<HTMLInputElement>('#notify-reminder')!;
    expect(reminder.disabled).toBe(false);
    reminder.click();
    await vi.waitFor(() => expect(api.profile.saveNotifications).toHaveBeenCalledWith({ exhibitionReminder: false }));

    button('重试')!.click();
    await vi.waitFor(() => expect(button('编辑资料')!.disabled).toBe(false));
    expect(api.profile.notifications).toHaveBeenCalledTimes(1);
    // 资料到齐后抽屉可以打开，头像块在抽屉里而不是设置页的卡片上。
    button('编辑资料')!.click();
    await nextTick();
    expect(document.querySelector('.sheet-panel [data-avatar-field]')).not.toBeNull();
    expect(document.querySelector('.card [data-avatar-field]')).toBeNull();
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
    // 身份卡上是唯一的编辑入口；头像的预览、上传、更换与移除都不在设置页。
    const actions = document.querySelector('.card .action-row');
    expect([...(actions?.querySelectorAll('button') ?? [])].map((item) => item.textContent?.trim())).toEqual([
      '编辑资料',
    ]);
    button('编辑资料')!.click();
    await nextTick();
    const avatarField = document.querySelector<HTMLElement>('.sheet-panel [data-avatar-field]');
    expect(avatarField).not.toBeNull();
    // 头像块只剩一颗铅笔：点它先保存资料，再直接拉起系统选图。
    expect([...(avatarField?.querySelectorAll('button') ?? [])].map((item) => item.getAttribute('aria-label'))).toEqual(
      ['编辑头像'],
    );
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

  it('按账号、通知与隐私、外观、语言、邀请码、应用更新分组', async () => {
    // 应用更新只属于 Android 原生壳：这里 mock 成有原生桥。
    await mountSettings({ native: true });
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    const labels = [...document.querySelectorAll('.settings-section .section-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual(['账号', '通知与隐私', '外观', '语言', '邀请码', '应用更新']);
  });

  it('浏览器模式下不出现应用更新分组', async () => {
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    const labels = [...document.querySelectorAll('.settings-section .section-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).not.toContain('应用更新');
  });

  it('浏览器里没装到主屏幕时提供安装入口，点击打开按平台给的安装说明', async () => {
    vi.mocked(shouldOfferPwaInstall).mockReturnValue(true);
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    // 独立分组：既不在协议卡片里，也不跟应用更新（浏览器模式下本来就不出现）混在一起。
    const labels = [...document.querySelectorAll('.settings-section .section-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual(['账号', '通知与隐私', '外观', '语言', '邀请码', '安装到主屏幕']);
    // 卡片里的说明按平台换：jsdom 是桌面浏览器，不会出现 iOS 的 Safari 文案。
    expect(document.body.textContent).toContain('在浏览器菜单里安装或添加到主屏幕');

    button('安装到主屏幕')!.click();
    await nextTick();
    expect(sheet.current?.title).toBe('安装到主屏幕');
    const panel = document.querySelector('.sheet-panel');
    expect(panel?.textContent).toContain('在浏览器菜单中选择「安装」或「添加到主屏幕」');
    expect(panel?.textContent).not.toContain('用 Safari 打开这个地址');
    // app 模式不出现「打开完整应用」，那是报名站才有的入口。
    expect(button('打开完整应用')).toBeUndefined();
    button('关闭')!.click();
    await nextTick();
    expect(sheet.current?.closing).toBe(true);
  });

  it('原生 App（有桥）或已装到主屏幕时不出现安装入口', async () => {
    vi.mocked(shouldOfferPwaInstall).mockReturnValue(false);
    await mountSettings({ native: true });
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    const labels = [...document.querySelectorAll('.settings-section .section-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).not.toContain('安装到主屏幕');
  });

  it('配色色板按服务端色板渲染，选中项用对勾标出', async () => {
    const colors = Array.from(
      { length: 12 },
      (_, index) =>
        '#' +
        String(index + 1)
          .padStart(2, '0')
          .repeat(3),
    );
    await mountSettings({ theme: { colors, index: 3 } });
    await vi.waitFor(() => expect(document.querySelectorAll('.swatch')).toHaveLength(12));
    // 选中只画一个对勾，其余色块保持干净
    expect(document.querySelectorAll('.swatch svg')).toHaveLength(1);
    const pressed = [...document.querySelectorAll<HTMLButtonElement>('.swatch')].filter(
      (item) => item.getAttribute('aria-pressed') === 'true',
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.querySelector('svg')).not.toBeNull();
  });

  it('不再提供安全设置入口', async () => {
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    expect(document.querySelectorAll('button.row-card')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('安全设置');
  });

  it('邀请码卡片在应用更新之前：普通用户与限时展商可兑换，永久展商和管理员只看说明', async () => {
    // 原生壳里才有「应用更新」组；这里保留原断言，同时让分组顺序可比较。
    await mountSettings({ native: true });
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    // 「应用更新」组排在最后，邀请码卡片是它前面的一组。
    const sections = [...document.querySelectorAll<HTMLElement>('.settings-groups > *')];
    const inviteSection = sections.find(
      (node) => node.querySelector('.section-label')?.textContent?.trim() === '邀请码',
    );
    expect(inviteSection).toBeDefined();
    expect(sections.at(-1)?.querySelector('.section-label')?.textContent?.trim()).toBe('应用更新');
    const lastSection = (): HTMLElement | null => inviteSection ?? null;
    expect(lastSection()?.querySelector('#settings-invite')).not.toBeNull();

    // 限时展商可以续期：输入框还在，并写明当前到期日与顺延规则
    const expiresAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    useSessionStore().applyUser({ ...useSessionStore().user, role: 'exhibitor', exhibitorExpiresAt: expiresAt });
    await nextTick();
    expect(lastSection()?.querySelector('#settings-invite')).not.toBeNull();
    expect(lastSection()?.textContent).toContain('当前展商有效期至');
    expect(lastSection()?.textContent).toContain('填写邀请码可顺延续期');

    // 永久展商与管理员没有可兑换的东西，卡片保留在最底部，只换一句身份说明
    const permanent = [
      [{ role: 'exhibitor', exhibitorExpiresAt: '' }, '当前是永久展商，不需要邀请码'],
      [{ role: 'admin', exhibitorExpiresAt: '' }, '当前是管理员，不需要邀请码'],
    ] as const;
    for (const [patch, hint] of permanent) {
      useSessionStore().applyUser({ ...useSessionStore().user, ...patch });
      await nextTick();
      expect(lastSection()?.querySelector('#settings-invite')).toBeNull();
      expect(lastSection()?.textContent).toContain(hint);
    }
  });

  it('点头像铅笔先保存资料并关掉抽屉，再直接拉起系统选图并弹出裁剪抽屉', async () => {
    vi.mocked(api.profile.save).mockResolvedValue({ ok: true, user: { ...PROFILE } });
    await mountSettings();
    await vi.waitFor(() => expect(button('编辑资料')).toBeDefined());
    button('编辑资料')!.click();
    await nextTick();
    // 资料抽屉里没有上传 / 更换 / 移除按钮，只有铅笔。
    expect(button('上传头像')).toBeUndefined();
    expect(button('更换头像')).toBeUndefined();
    expect(button('移除头像')).toBeUndefined();
    document.querySelector<HTMLButtonElement>('.sheet-panel [data-avatar-edit]')!.click();
    // 先 PUT /profile：保存成功才关资料抽屉，然后直接拉起系统选图。
    // 这条链路要经过保存、关抽屉与裁剪抽屉几段动画，全量并行时 1s 预算太紧，给到 3s。
    await vi.waitFor(() => expect(api.profile.save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await vi.waitFor(() => expect(device.pickImage).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // 没有中转页：不会再冒出「编辑头像」面板，选到图后出现裁剪抽屉。
    await vi.waitFor(() => expect(document.body.textContent).toContain('裁剪头像'), { timeout: 3000 });
    expect(sheet.current).toBeNull();
    expect(button('移除头像')).toBeUndefined();
  });
});
