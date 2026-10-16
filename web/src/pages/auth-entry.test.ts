import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function loginScreen(options: { bootstrapFailures?: number; twoFactor?: boolean; register?: boolean } = {}) {
  vi.resetModules();
  let bootstrapFailures = options.bootstrapFailures ?? 0;
  let verified = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const loggedIn = (init?.headers as Record<string, string>)?.Authorization === 'Bearer b';
    if (url.endsWith('/auth/login'))
      return Response.json(
        options.twoFactor
          ? { ok: true, twoFactorRequired: true, ticket: 'one-use-ticket', methods: { email: true } }
          : { ok: true, token: 'b', user: { id: 'b', username: 'b' } },
      );
    if (url.endsWith('/auth/register')) return Response.json({ ok: true, email: 'b@example.com', resendAfterSec: 60 });
    if (url.endsWith('/auth/login/verify') || url.endsWith('/auth/register/verify')) {
      if (verified) return Response.json({ error: '验证码已使用' }, { status: 400 });
      verified = true;
      return Response.json({ ok: true, token: 'b', user: { id: 'b', username: 'b' } });
    }
    if (url.endsWith('/auth/guest')) return Response.json({ ok: true, user: { guest: true } });
    if (loggedIn && bootstrapFailures-- > 0) return Response.json({ error: '暂不可用' }, { status: 503 });
    return Response.json({
      user: loggedIn ? { id: 'b', username: 'b', role: 'user' } : { guest: true },
      ui: { mode: 'light' },
      theme: { colors: ['#112233', '#445566'], index: loggedIn ? 1 : 0 },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const pinia = createPinia();
  setActivePinia(pinia);
  const runtime = await import('@/app/runtime');
  await runtime.bootApp();
  runtime.applyRuntimeBootstrap({ user: { id: 'a' }, ui: { mode: 'dark' }, theme: { index: 0 } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: { template: '<div />' } },
      { path: '/home', component: { template: '<div />' } },
      { path: '/detail/one', component: { template: '<div />' } },
      { path: '/register', component: { template: '<div />' } },
      { path: '/forgot-password', component: { template: '<div />' } },
    ],
  });
  await router.push(options.register ? '/register' : '/login?redirect=/detail/one');
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(
    options.register ? (await import('./RegisterPage.vue')).default : (await import('./LoginPage.vue')).default,
  );
  app.use(pinia).use(router).mount(container);
  return { container, router, runtime, fetcher };
}

function fill(container: HTMLElement, selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitForm(container: HTMLElement) {
  await nextTick();
  container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function enterVerification(container: HTMLElement, register: boolean) {
  if (register) {
    fill(container, '#register-username', 'testuser');
    fill(container, '#register-email', 'b@example.com');
    fill(container, '#register-password', 'password');
    fill(container, '#register-confirm', 'password');
  } else {
    fill(container, '#login-account', 'b');
    fill(container, '#login-password', 'password');
  }
  await submitForm(container);
  await vi.waitFor(() => expect(container.querySelector(register ? '#register-code' : '#login-code')).not.toBeNull());
}

describe('入口身份初始化', () => {
  it('登录页不展示示例账号', async () => {
    const { container } = await loginScreen();
    await nextTick();
    expect(container.textContent).not.toContain('演示账号');
    expect(container.textContent).not.toMatch(/demo\s*\/\s*exhibitor/);
    expect(container.querySelector('#login-account')).not.toBeNull();
  });

  it('换号登录先落新账号偏好，再回到原地址', async () => {
    const { container, router } = await loginScreen();
    fill(container, '#login-account', 'b');
    fill(container, '#login-password', 'password');
    await nextTick();
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/detail/one'));
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('1');
  }, 20_000);

  it('访客从受保护地址进入时清旧会话并落到首页', async () => {
    const { container, router, runtime } = await loginScreen();
    runtime.api.session.setTokens({ token: 'a', refreshToken: 'refresh-a' });
    container.querySelector<HTMLButtonElement>('button.ghost')!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'));
    expect(runtime.api.session.token).toBeUndefined();
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('0');
  }, 20_000);

  it('新身份启动数据失败时留在入口显示错误', async () => {
    const { container, router } = await loginScreen({ bootstrapFailures: 1 });
    fill(container, '#login-account', 'b');
    fill(container, '#login-password', 'password');
    await nextTick();
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('503'));
    expect(router.currentRoute.value.path).toBe('/login');
  }, 20_000);

  describe.each([
    { name: '两步验证', register: false },
    { name: '注册验证', register: true },
  ])('$name', ({ register }) => {
    it('凭据验证后落新账号偏好，再进入目标页面', async () => {
      const { container, router, runtime } = await loginScreen({ register, twoFactor: !register });
      await enterVerification(container, register);
      expect(runtime.api.session.token).toBeUndefined();
      fill(container, register ? '#register-code' : '#login-code', '123456');
      await submitForm(container);
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(register ? '/home' : '/detail/one'));
      expect(runtime.api.session.token).toBe('b');
      expect(document.documentElement.dataset.mode).toBe('light');
      expect(document.documentElement.dataset.accent).toBe('1');
    }, 20_000);

    it('启动数据失败后可重试，不重复提交已消费的一次性凭据', async () => {
      const { container, router, runtime, fetcher } = await loginScreen({
        register,
        twoFactor: !register,
        bootstrapFailures: 1,
      });
      await enterVerification(container, register);
      fill(container, register ? '#register-code' : '#login-code', '123456');
      await submitForm(container);
      await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('503'));
      expect(runtime.api.session.token).toBe('b');
      fill(container, register ? '#register-code' : '#login-code', '');
      await submitForm(container);
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(register ? '/home' : '/detail/one'));
      const verificationPath = register ? '/auth/register/verify' : '/auth/login/verify';
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith(verificationPath))).toHaveLength(1);
      expect(document.documentElement.dataset.accent).toBe('1');
    }, 20_000);
  });

  it('注册页说明收集的资料，并只在 https 政策地址存在时给出链接', async () => {
    const { container, runtime } = await loginScreen({ register: true });
    expect(container.textContent).toContain('注册会收集用户名、邮箱和密码');
    expect(container.querySelector('a')).toBeNull();
    runtime.applyRuntimeBootstrap({ privacyPolicyUrl: 'https://app.example.com/privacy' });
    await nextTick();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://app.example.com/privacy');
    runtime.applyRuntimeBootstrap({ privacyPolicyUrl: 'javascript:alert(1)' });
    await nextTick();
    expect(container.querySelector('a')).toBeNull();
  });

  it('登录二步验证可选择记住当前设备', async () => {
    const { container, fetcher, router } = await loginScreen({ twoFactor: true });
    await enterVerification(container, false);
    const remember = container.querySelector<HTMLInputElement>('#login-trust-device');
    expect(remember).not.toBeNull();
    remember!.click();
    fill(container, '#login-code', '123456');
    await submitForm(container);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/detail/one'));
    const verification = fetcher.mock.calls.find(([url]) => url.endsWith('/auth/login/verify'));
    expect(JSON.parse(verification?.[1]?.body as string)).toMatchObject({ trustDevice: true });
  }, 20_000);
});
