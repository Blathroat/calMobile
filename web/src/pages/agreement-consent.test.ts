/**
 * 登录 / 注册页的用户协议勾选：开启时未勾选要拦在发请求之前，勾选后才登录 / 注册，
 * 并在建立会话后把同意的版本写回账号；协议关闭时整块不渲染、也不调用同意接口。
 *
 * 用真实 runtime + fetch stub 走完整链路（与 auth-entry.test.ts 同一种挂载方式）：
 * `bootstrap.agreement` 由启动数据下发，所以未登录的入口页也能判断要不要显示勾选。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

interface HarnessOptions {
  register?: boolean;
  twoFactor?: boolean;
  agreementEnabled?: boolean;
}

async function entryScreen(options: HarnessOptions = {}) {
  vi.resetModules();
  const agreementEnabled = options.agreementEnabled !== false;
  let verified = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.endsWith('/auth/login')) {
      return Response.json(
        options.twoFactor
          ? { ok: true, twoFactorRequired: true, ticket: 'one-use-ticket', methods: { email: true } }
          : { ok: true, token: 'b', user: { id: 'b', username: 'b' } },
      );
    }
    if (url.endsWith('/auth/login/verify')) {
      if (verified) return Response.json({ error: '验证码已使用' }, { status: 400 });
      verified = true;
      return Response.json({ ok: true, token: 'b', user: { id: 'b', username: 'b' } });
    }
    if (url.endsWith('/auth/register')) return Response.json({ ok: true, email: 'b@example.com', resendAfterSec: 60 });
    if (url.endsWith('/auth/register/verify')) {
      return Response.json({ ok: true, token: 'b', user: { id: 'b', username: 'b' } });
    }
    if (url.endsWith('/profile/agreement')) {
      return Response.json({ ok: true, agreedTermsVersion: body.version, agreedTermsAt: '2026-11-17T00:00:00.000Z' });
    }
    if (url.endsWith('/bootstrap')) {
      return Response.json({
        user: authorization ? { id: 'b', username: 'b', role: 'user', loggedIn: true } : { guest: true },
        agreement: {
          enabled: agreementEnabled,
          version: agreementEnabled ? 4 : 0,
          updatedAt: agreementEnabled ? '2026-11-17T08:00:00.000Z' : '',
        },
        ui: { mode: 'light' },
        theme: { colors: ['#112233'], index: 0 },
      });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetcher);
  const pinia = createPinia();
  setActivePinia(pinia);
  const runtime = await import('@/app/runtime');
  await runtime.bootApp();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: { template: '<div />' } },
      { path: '/register', component: { template: '<div />' } },
      { path: '/home', component: { template: '<div />' } },
      { path: '/agreement', component: { template: '<div />' } },
    ],
  });
  await router.push(options.register ? '/register' : '/login?redirect=/home');
  const container = document.createElement('div');
  document.body.append(container);
  const page = options.register
    ? (await import('./RegisterPage.vue')).default
    : (await import('./LoginPage.vue')).default;
  app = createApp(page);
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await nextTick();
  return { container, router, fetcher };
}

function fill(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitForm(container: HTMLElement): Promise<void> {
  await nextTick();
  container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function fillLogin(container: HTMLElement): Promise<void> {
  fill(container, '#login-account', 'b');
  fill(container, '#login-password', 'password');
}

async function fillRegister(container: HTMLElement): Promise<void> {
  fill(container, '#register-username', 'testuser');
  fill(container, '#register-email', 'b@example.com');
  fill(container, '#register-password', 'password');
  fill(container, '#register-confirm', 'password');
}

function agreeCalls(fetcher: ReturnType<typeof vi.fn>): unknown[] {
  return fetcher.mock.calls
    .filter(([url]) => String(url).endsWith('/profile/agreement'))
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')));
}

describe('登录页的用户协议勾选', () => {
  it('未勾选时拦下密码登录，不发起请求并在原位提示', async () => {
    const { container, fetcher } = await entryScreen();
    expect(container.querySelector('#login-agreement')).not.toBeNull();
    await fillLogin(container);
    await submitForm(container);
    await vi.waitFor(() => expect(container.textContent).toContain('请先阅读并同意《用户协议》'));
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/auth/login'))).toBe(false);
  }, 20_000);

  it('勾选后登录成功并记录当前协议版本', async () => {
    const { container, router, fetcher } = await entryScreen();
    await fillLogin(container);
    container.querySelector<HTMLInputElement>('#login-agreement')!.click();
    await submitForm(container);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'));
    expect(agreeCalls(fetcher)).toEqual([{ version: 4 }]);
  }, 20_000);

  it('两步验证的最终提交同样要勾选', async () => {
    const { container, router, fetcher } = await entryScreen({ twoFactor: true });
    await fillLogin(container);
    // 第一步就要勾选才发得出密码登录请求。
    container.querySelector<HTMLInputElement>('#login-agreement')!.click();
    await submitForm(container);
    await vi.waitFor(() => expect(container.querySelector('#login-code')).not.toBeNull());
    // 第二步取消勾选后不能完成登录。
    container.querySelector<HTMLInputElement>('#login-agreement')!.click();
    fill(container, '#login-code', '123456');
    await submitForm(container);
    await vi.waitFor(() => expect(container.textContent).toContain('请先阅读并同意《用户协议》'));
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/auth/login/verify'))).toBe(false);
    container.querySelector<HTMLInputElement>('#login-agreement')!.click();
    await submitForm(container);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'));
    expect(agreeCalls(fetcher)).toEqual([{ version: 4 }]);
  }, 20_000);

  it('协议关闭时不渲染勾选、登录也不写同意记录', async () => {
    const { container, router, fetcher } = await entryScreen({ agreementEnabled: false });
    expect(container.querySelector('#login-agreement')).toBeNull();
    expect(container.textContent).not.toContain('用户协议');
    await fillLogin(container);
    await submitForm(container);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'));
    expect(agreeCalls(fetcher)).toEqual([]);
  }, 20_000);

  it('《用户协议》蓝链跳到协议页', async () => {
    const { container, router } = await entryScreen();
    const link = container.querySelector<HTMLAnchorElement>('.agreement-link')!;
    expect(link.textContent).toContain('用户协议');
    link.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/agreement'));
  }, 20_000);
});

describe('注册页的用户协议勾选', () => {
  it('未勾选时不发送注册验证码，勾选后才能进入验证码步骤', async () => {
    const { container, fetcher } = await entryScreen({ register: true });
    expect(container.querySelector('#register-agreement')).not.toBeNull();
    await fillRegister(container);
    await submitForm(container);
    await vi.waitFor(() => expect(container.textContent).toContain('请先阅读并同意《用户协议》'));
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/auth/register'))).toBe(false);
    container.querySelector<HTMLInputElement>('#register-agreement')!.click();
    await submitForm(container);
    await vi.waitFor(() => expect(container.querySelector('#register-code')).not.toBeNull());
  }, 20_000);

  it('注册成功建立会话后记录同意版本', async () => {
    const { container, router, fetcher } = await entryScreen({ register: true });
    await fillRegister(container);
    container.querySelector<HTMLInputElement>('#register-agreement')!.click();
    await submitForm(container);
    await vi.waitFor(() => expect(container.querySelector('#register-code')).not.toBeNull());
    fill(container, '#register-code', '123456');
    await submitForm(container);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'));
    expect(agreeCalls(fetcher)).toEqual([{ version: 4 }]);
  }, 20_000);
});
