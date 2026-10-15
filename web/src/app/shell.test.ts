/**
 * 外壳渲染门禁。
 *
 * 重构时页面曾各自拼 `.page` / `.topbar` / `.app-body` 这类旧容器，外壳（顶栏、滚动内容区、
 * 底部导航、页脚槽）整体丢失，界面散架而单测与类型检查都发现不了。这里逐条路由真实挂载
 * `App.vue`，锁住外壳结构：每个页面都必须落在外壳给出的内容区里，标签页必须有底部导航。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, type Router } from 'vue-router';
import App from './App.vue';
import { createAppRouter } from './router';
import { bodyAttrs, tabItems } from './shell';
import { api } from '@/app/runtime';
import { openSheet } from '@/services/sheet';
import { useSessionStore } from '@/stores/session';
import { navigation } from './navigation';

// 外壳结构使用下面的固定身份；启动数据与认证流程由 runtime 测试覆盖。
vi.mock('@/app/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/runtime')>()),
  bootApp: async () => undefined,
}));

const ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/home',
  '/search',
  '/user-public/exhibitor',
  '/detail/exh-1',
  '/registration-form/exh-1',
  '/my-registrations',
  '/registration-detail/reg-1',
  '/meeting-detail/meet-1',
  '/profile',
  '/settings',
  '/security',
  '/security/devices',
  '/exhibitor',
  '/meeting-settings',
  '/meeting-apply/exhibitor-1',
  '/admin/meetings/exhibitor-1',
  '/admin/exhibitions/exhibitor-1',
  '/exhibition-form',
  '/exhibition-form/exh-1',
  '/review',
  '/checkin',
  '/rich-editor',
  '/admin',
];

const TAB_ROUTES = new Set(['/home', '/my-registrations', '/profile', '/exhibitor', '/admin']);

/** 管理员身份：让所有按角色 / 能力限制的路由都能渲染。 */
const ADMIN = {
  id: 'u1',
  loggedIn: true,
  guest: false,
  role: 'admin',
  roleLabel: '管理员',
  username: 'admin',
  nickname: '管理员',
  can: { register: true, profile: true, exhibitor: true, admin: true, limited: false },
};

async function mountRoute(path: string): Promise<{ container: HTMLElement; app: VueApp; router: Router }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // 路由守卫与页面都要读会话，因此先建 pinia 并置为当前实例，再挂载应用。
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createAppRouter(createMemoryHistory());
  useSessionStore().applyUser(ADMIN);
  await router.push(path);
  await router.isReady();
  const app = createApp(App);
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await nextTick();
  return { container, app, router };
}

function unmount(container: HTMLElement, app: VueApp): void {
  app.unmount();
  container.remove();
}

describe('app shell', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    navigation.direction.value = 'none';
    // 门禁只看结构，不连后端：让所有请求立刻失败，页面走各自的错误态。
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
  });

  it.each(ROUTES)('%s 渲染在外壳的内容区里', async (path) => {
    const { container, app } = await mountRoute(path);
    try {
      const shell = container.querySelector('.app');
      expect(shell, `${path} 缺少 .app 外壳`).not.toBeNull();
      // 顶栏与内容区必须是外壳的直接子元素：页面自己拼容器就会多出第二份。
      expect(shell?.querySelector(':scope > .topbar')).not.toBeNull();
      expect(shell?.querySelector(':scope > .app-body')).not.toBeNull();
      expect(container.querySelectorAll('.topbar')).toHaveLength(1);
      expect(container.querySelectorAll('.app-body')).toHaveLength(1);
      // 内容区的直接子元素是路由容器：它承载页面切换动画与纵向排布。
      const surface = container.querySelector('.app-body > .page-surface');
      expect(surface, `${path} 的内容没有落进 .page-surface`).not.toBeNull();
      // 页脚槽必须由外壳提供：页面用 `<Teleport defer to="#app-foot">` 投递固定操作区，
      // 槽位缺失时 Vue 会直接抛「Failed to locate Teleport target」。
      expect(shell?.querySelector(':scope > #app-foot'), `${path} 缺少页脚槽`).not.toBeNull();
      // 旧容器的类名不得再出现（`migration.css` 那套兼容层已删除）。
      expect(container.querySelector('.page')).toBeNull();
      // 底部导航只长在标签页上，条目数跟着能力走（能力变化时条目要跟着变）。
      const tabbar = container.querySelector('.tabbar');
      if (TAB_ROUTES.has(path)) {
        expect(tabbar, `${path} 缺少底部导航`).not.toBeNull();
        expect(tabbar?.querySelectorAll('.tab').length).toBe(tabItems(ADMIN.can).length);
        expect(tabbar?.querySelector('.tab[aria-current="page"]'), `${path} 没有选中任何标签`).not.toBeNull();
      } else {
        expect(tabbar, `${path} 不该有底部导航`).toBeNull();
      }
      if (path !== '/login' && !TAB_ROUTES.has(path)) {
        const back = container.querySelector<HTMLButtonElement>('.topbar > .icon-button');
        expect(back, `${path} 缺少左上角返回按钮`).not.toBeNull();
        expect(back?.querySelector('svg path')?.getAttribute('d'), `${path} 返回按钮不是左尖括号`).toBe(
          'm14 5-7 7 7 7',
        );
      }
    } finally {
      unmount(container, app);
    }
  });

  it('顶栏与内容区由路由 meta 决定', async () => {
    // 标题 / 返回键走 meta.title 与 meta.back：二级页必须有返回键，否则只能靠系统手势。
    const detail = await mountRoute('/detail/exh-1');
    try {
      expect(detail.container.querySelector('.topbar-title')?.textContent?.trim()).toBe('展会详情');
      expect(detail.container.querySelector('.topbar .icon-button')).not.toBeNull();
    } finally {
      unmount(detail.container, detail.app);
    }

    // 密度映射本身是纯函数：逐个分支断言，不必为每种 meta 各挂一次应用。
    expect(bodyAttrs({})).toEqual({});
    expect(bodyAttrs({ bodyGap: 'tight' })).toEqual({ 'data-gap': 'tight' });
    expect(bodyAttrs({ bodyPad: 'none', bodyAlign: 'center', bodyGap: 'tight' })).toEqual({
      'data-pad': 'none',
      'data-align': 'center',
      'data-gap': 'tight',
    });

    // 外壳确实把映射写到了 `.app-body` 上（首页是信息密集页，用 tight）。
    const home = await mountRoute('/home');
    try {
      expect(home.container.querySelector('.app-body')?.getAttribute('data-gap')).toBe('tight');
    } finally {
      unmount(home.container, home.app);
    }
  });

  it('固定操作区投递到页脚槽，入口页的文字入口随内容滚动', async () => {
    // 入口页按旧版版式：注册 / 忘记密码跟在表单后面，不占页脚槽。
    const login = await mountRoute('/login');
    try {
      const foot = login.container.querySelector('#app-foot');
      expect(foot).not.toBeNull();
      expect(foot?.childElementCount).toBe(0);
      expect(login.container.querySelector('.app-body .page-foot')).toBeNull();
      expect(login.container.querySelectorAll('.page-surface .auth-entry')).toHaveLength(2);
    } finally {
      unmount(login.container, login.app);
    }

    // 设置页的资料表单走全局抽屉，不占页面滚动区或固定页脚。
    const profileSpy = vi.spyOn(api.profile, 'get').mockResolvedValue({});
    const notificationsSpy = vi.spyOn(api.profile, 'notifications').mockResolvedValue({});
    const settings = await mountRoute('/settings');
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
      const foot = settings.container.querySelector('#app-foot');
      expect(foot?.childElementCount).toBe(0);
      const entry = [...settings.container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === '编辑资料',
      );
      expect(entry, '/settings 没有资料编辑入口').not.toBeUndefined();
      entry?.click();
      await nextTick();
      await nextTick();
      expect(settings.container.querySelector('#app-foot')?.childElementCount).toBe(0);
      expect(settings.container.querySelector('.sheet-panel #settings-nickname')).not.toBeNull();
      expect(settings.container.querySelector('.app-body #settings-nickname')).toBeNull();

      const cancel = [...settings.container.querySelectorAll<HTMLButtonElement>('.sheet-panel button')].find(
        (button) => button.textContent?.trim() === '取消',
      );
      cancel?.click();
      await new Promise((resolve) => setTimeout(resolve, 260));
      await nextTick();
    } finally {
      unmount(settings.container, settings.app);
      profileSpy.mockRestore();
      notificationsSpy.mockRestore();
    }

    // 修改密码归入安全设置，打开后先通过身份复核。
    const securitySpy = vi.spyOn(api.security, 'get').mockResolvedValue({
      email: 'user@example.com',
      emailVerified: true,
      canEnable: true,
      twoFactorEnabled: false,
      twoFactorMethod: 'off',
      totpEnabled: false,
    });
    const passwordCodeSpy = vi
      .spyOn(api.security, 'identityEmailCode')
      .mockResolvedValue({ ok: true, maskedEmail: 'u***@example.com' });
    const security = await mountRoute('/security');
    try {
      const passwordEntry = [...security.container.querySelectorAll<HTMLButtonElement>('.page-surface button')].find(
        (button) => button.textContent?.includes('修改密码'),
      );
      expect(passwordEntry, '/security 没有修改密码入口').not.toBeUndefined();
      passwordEntry?.click();
      await nextTick();
      security.container.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
      await vi.waitFor(() =>
        expect(security.container.querySelector('.sheet-panel #security-identity-code')).not.toBeNull(),
      );
      expect(security.container.querySelector('.sheet-panel #security-identity-code')).not.toBeNull();
      expect(security.container.querySelector('.app-body #security-sheet-new-password')).toBeNull();
    } finally {
      unmount(security.container, security.app);
      passwordCodeSpy.mockRestore();
      securitySpy.mockRestore();
    }

    // 详情页在没有数据时不投递页脚，槽位保持空（CSS 用 :empty 收起整行）。
    const detail = await mountRoute('/detail/exh-1');
    try {
      const foot = detail.container.querySelector('#app-foot');
      expect(foot).not.toBeNull();
      expect(foot?.childElementCount).toBe(0);
    } finally {
      unmount(detail.container, detail.app);
    }
  });

  it('安全方式在抽屉关闭或验证失败时回到服务器确认的选项', async () => {
    const securitySpy = vi.spyOn(api.security, 'get').mockResolvedValue({
      email: 'user@example.com',
      emailVerified: true,
      canEnable: true,
      twoFactorEnabled: false,
      twoFactorMethod: 'off',
      backupCodesLeft: 0,
    });
    const emailCodeSpy = vi
      .spyOn(api.security, 'identityEmailCode')
      .mockResolvedValue({ ok: true, maskedEmail: 'u***@example.com' });
    const identitySpy = vi
      .spyOn(api.security, 'verifyIdentity')
      .mockResolvedValue({ ok: true, stepUpToken: 'step-up' });
    const setupSpy = vi.spyOn(api.security, 'totpSetup').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/test',
      stepUpToken: 'confirm-step',
    });
    const enableSpy = vi.spyOn(api.security, 'totpEnable').mockResolvedValue({ ok: false, error: '验证码不正确' });
    const { container, app } = await mountRoute('/security');
    try {
      const selected = (mode: string) =>
        container.querySelector<HTMLButtonElement>(`.seg button[data-value="${mode}"]`)?.getAttribute('aria-pressed');
      await vi.waitFor(() => expect(selected('off')).toBe('true'));
      container.querySelector<HTMLButtonElement>('.seg button[data-value="totp"]')?.click();
      await vi.waitFor(() => expect(container.querySelector('.sheet-panel')).not.toBeNull());
      container.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
      await vi.waitFor(() => expect(emailCodeSpy).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(container.querySelector('.sheet-panel #security-identity-code')).not.toBeNull());

      const identityCode = container.querySelector<HTMLInputElement>('#security-identity-code')!;
      identityCode.value = '123456';
      identityCode.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('.sheet-panel .cta:not(.ghost)')?.click();
      await vi.waitFor(() => expect(container.querySelector('.sheet-panel #security-sheet-totp-code')).not.toBeNull());

      [...container.querySelectorAll<HTMLButtonElement>('.sheet-panel button')]
        .find((button) => button.classList.contains('ghost'))
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 260));
      await nextTick();
      expect(selected('off')).toBe('true');

      container.querySelector<HTMLButtonElement>('.seg button[data-value="totp"]')?.click();
      await vi.waitFor(() => expect(container.querySelector('.sheet-panel')).not.toBeNull());
      container.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
      await vi.waitFor(() => expect(emailCodeSpy).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(container.querySelector('.sheet-panel #security-identity-code')).not.toBeNull());
      const secondIdentityCode = container.querySelector<HTMLInputElement>('#security-identity-code')!;
      secondIdentityCode.value = '123456';
      secondIdentityCode.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('.sheet-panel .cta:not(.ghost)')?.click();
      await vi.waitFor(() => expect(container.querySelector('.sheet-panel #security-sheet-totp-code')).not.toBeNull());
      const code = container.querySelector<HTMLInputElement>('#security-sheet-totp-code')!;
      code.value = '123456';
      code.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('.sheet-panel .cta:not(.ghost)')?.click();
      await vi.waitFor(() =>
        expect(container.querySelector('.sheet-panel [role="alert"]')?.textContent).toContain('验证码不正确'),
      );
      expect(selected('off')).toBe('true');
      expect(identitySpy).toHaveBeenCalledWith('email', '123456', 'totp');
      expect(enableSpy).toHaveBeenCalledTimes(1);
    } finally {
      unmount(container, app);
      securitySpy.mockRestore();
      emailCodeSpy.mockRestore();
      identitySpy.mockRestore();
      setupSpy.mockRestore();
      enableSpy.mockRestore();
    }
  });

  it('换页时收起底部面板', async () => {
    // 底部面板是全局挂载的：报名详情、状态选择这类面板属于上一屏，
    // 跟着路由留在新页面上会盖住正文。
    const { container, app, router } = await mountRoute('/home');
    try {
      openSheet({ title: '测试面板' });
      await nextTick();
      expect(container.querySelector('.sheet-panel')).not.toBeNull();
      await router.push('/profile');
      await nextTick();
      // 收起会播退场动画，等它结束再断言。
      await new Promise((resolve) => setTimeout(resolve, 400));
      await nextTick();
      expect(container.querySelector('.sheet-panel')).toBeNull();
    } finally {
      unmount(container, app);
    }
  });

  it('切换方向写进外壳，供过渡动画使用', async () => {
    const { container, app, router } = await mountRoute('/home');
    try {
      await router.push('/detail/exh-1');
      await nextTick();
      expect(navigation.direction.value).toBe('forward');
      expect(container.querySelector('.app')?.getAttribute('data-direction')).toBe('forward');
      await router.push('/my-registrations');
      await nextTick();
      // 标签页之间是平级切换，不做左右滑动的观感。
      await router.push('/home');
      await nextTick();
      expect(navigation.direction.value).toBe('none');
    } finally {
      unmount(container, app);
    }
  });

  it('认证端拒绝续期后回登录页并保留当前地址', async () => {
    const { container, app, router } = await mountRoute('/registration-form/exh-1');
    try {
      useSessionStore().expire();
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'));
      expect(router.currentRoute.value.query).toMatchObject({ redirect: '/registration-form/exh-1', expired: '1' });
      expect(container.querySelector('.topbar-title')?.textContent?.trim()).toBe('登录');
    } finally {
      unmount(container, app);
    }
  });
});
