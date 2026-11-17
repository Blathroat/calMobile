/**
 * 报名站分享链接的前端流程（需求 9）：
 *
 * - `RegistrationFormPage` 在「报名站 + 未登录」时是匿名报名：多一项必填姓名，
 *   提交成功后带查询凭据进状态页；已登录的报名站用户仍走原来的「我的活动」。
 * - `RegistrationDetailPage` 的查询链接模式：公开取数，未登录页脚是登录 / 注册，
 *   展示查询链接与「必须保存」的提示；已登录先认领，成功换到普通的详情页。
 * - `RegisterPage` 支持 `?redirect=`，注册成功后回跳查询链接（登录后自动认领）。
 *
 * 报名站是另一份构建（`isJoinSurface`），这里把 `@/app/surface` 换成报名站版本；
 * 挂载方式仿 detail-registration.test.ts / auth-entry.test.ts：mock `@/app/runtime`，
 * 用真实 pinia + 内存路由把页面挂进 jsdom。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { api, refreshRuntimeBootstrap } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/services/http-client';
import { copyText } from '@/services/clipboard';
import { toast } from '@/services/toast';
import RegistrationFormPage from './RegistrationFormPage.vue';
import RegistrationDetailPage from './RegistrationDetailPage.vue';
import RegisterPage from './RegisterPage.vue';

vi.mock('@/app/surface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/surface')>();
  return { ...actual, isJoinSurface: true, paths: actual.surfacePaths(true) };
});
vi.mock('@/app/runtime', () => ({
  api: {
    session: { signal: new AbortController().signal },
    auth: { register: vi.fn(), registerVerify: vi.fn() },
    exhibitions: { get: vi.fn() },
    registrations: {
      submit: vi.fn(),
      queryByToken: vi.fn(),
      claim: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    },
  },
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/services/clipboard', () => ({ copyText: vi.fn(async () => true) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const EXHIBITION = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    date: '2026-09-20',
    time: '09:00-17:00',
    venue: '会展中心',
    statusCode: 'review',
    openForRegistration: true,
  },
  fields: [],
};

const RECORD = {
  id: 'reg-1',
  exhibitionId: 'exh-1',
  exhibitionTitle: '秋季展会',
  exhibitionTime: '09:00-17:00',
  exhibitionVenue: '会展中心',
  exhibitionDate: '2026-09-20',
  visitorName: '张三',
  visitorType: 'guest',
  answers: '',
  statusCode: 'pending',
  allowCancel: true,
};

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="page"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue(EXHIBITION as never);
  vi.mocked(api.registrations.submit).mockResolvedValue({
    ok: true,
    autoApproved: false,
    statusLabel: '待审核',
    queryToken: 'tok-anon',
    registration: { id: 'reg-new' },
  } as never);
  vi.mocked(api.registrations.queryByToken).mockResolvedValue({ found: true, registration: RECORD } as never);
  vi.mocked(api.registrations.claim).mockResolvedValue({
    ok: true,
    claimed: true,
    registration: { id: 'reg-1' },
  } as never);
  vi.mocked(api.auth.register).mockResolvedValue({
    ok: true,
    email: 'new@example.com',
    resendAfterSec: 0,
  } as never);
  vi.mocked(api.auth.registerVerify).mockResolvedValue({ ok: true } as never);
  vi.mocked(copyText).mockResolvedValue(true);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  navigation.cancel();
  document.body.innerHTML = '';
});

/** 让已经 resolve 的 promise 链与重渲染跑完。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

/**
 * 内存路由 + 真实 pinia；`routes` 由每个用例给出。
 * `prepare` 在挂载前执行：登录态、启动数据这类「首帧就要正确」的状态必须在这时落好，
 * 否则页面的 onMounted 已经按未登录跑过一遍。
 */
async function mountAt(
  component: object,
  path: string,
  routes: Parameters<typeof createRouter>[0]['routes'],
  prepare?: () => void,
): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...routes],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push(path);
  prepare?.();
  app = createApp(component).use(pinia).use(router);
  app.mount('#page');
  await flush();
  return router;
}

function fill(selector: string, value: string): void {
  const field = document.querySelector<HTMLInputElement>(selector);
  expect(field, `找不到输入框 ${selector}`).not.toBeNull();
  field!.value = value;
  field!.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitForm(): void {
  const form = document.querySelector('form');
  expect(form).not.toBeNull();
  form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('匿名报名（报名站未登录）', () => {
  const ROUTES = [
    { path: '/e/:id/register', component: RegistrationFormPage },
    { path: '/e/:id/status', component: { template: '<div />' } },
    { path: '/mine', component: { template: '<div />' } },
  ];

  it('多一项必填姓名，没填不发请求', async () => {
    await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES);
    expect(document.querySelector('#registration-guest-name')).not.toBeNull();
    submitForm();
    await flush();
    expect(api.registrations.submit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请填写姓名');
  });

  it('提交不需要登录，成功后带查询凭据进状态页', async () => {
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES);
    fill('#registration-guest-name', '匿名访客');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });

    expect(api.registrations.submit).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.registrations.submit).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.visitorName).toBe('匿名访客');
    expect(payload.visitorType).toBeUndefined();
    expect(payload.answers).toBe('');
    expect(router.currentRoute.value.query.token).toBe('tok-anon');
    expect(toast).toHaveBeenCalled();
  });

  it('已登录的报名站用户不显示姓名，成功后回我的活动', async () => {
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, () => {
      useSessionStore().applyUser({
        id: 'u1',
        nickname: '张三',
        role: 'user',
        loggedIn: true,
        can: { register: true },
      });
    });
    expect(document.querySelector('#registration-guest-name')).toBeNull();
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/mine'), { timeout: 3000 });
    const payload = vi.mocked(api.registrations.submit).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.visitorName).toBe('张三');
    expect(payload.visitorType).toBe('user');
  });
});

describe('查询链接模式（报名站状态页）', () => {
  const ROUTES = [
    { path: '/e/:id/status', component: RegistrationDetailPage },
    { path: '/mine/:id', component: { template: '<div />' } },
    { path: '/login', component: { template: '<div />' } },
    { path: '/register', component: { template: '<div />' } },
  ];

  it('未登录：公开取数，页脚换成登录 / 注册，并提示保存链接', async () => {
    await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES, () => {
      useBootstrapStore().apply({ publicBaseUrl: 'https://app.example.com' });
    });

    expect(api.registrations.queryByToken).toHaveBeenCalledWith('tok-anon');
    expect(api.registrations.get).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('秋季展会');
    // 查询链接卡：带上对外域名与凭据 + 必须保存的提示
    const card = document.querySelector('[data-action="query-link-card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('https://app.example.com/e/exh-1/status?token=tok-anon');
    expect(card!.textContent).toContain('请保存好这条链接');
    // 页脚：登录 / 注册，不再有修改 / 撤销
    const foot = document.querySelector('#app-foot');
    expect(foot!.textContent).toContain('登录');
    expect(foot!.textContent).toContain('注册');
    expect(foot!.textContent).not.toContain('修改报名');
    expect(foot!.textContent).not.toContain('撤销报名');
  });

  it('复制按钮复制查询链接并提示', async () => {
    await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES, () => {
      useBootstrapStore().apply({ publicBaseUrl: 'https://app.example.com' });
    });
    document.querySelector<HTMLButtonElement>('[data-action="copy-query-link"]')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('查询链接已复制', 'success'));
    expect(copyText).toHaveBeenCalledWith('https://app.example.com/e/exh-1/status?token=tok-anon');
  });

  it('已登录：先认领再换成登录后的详情页', async () => {
    const router = await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES, () => {
      useSessionStore().applyUser({ id: 'u1', loggedIn: true, can: { register: true } });
    });
    await vi.waitFor(() => expect(api.registrations.claim).toHaveBeenCalledWith('tok-anon'));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/mine/reg-1'));
    expect(api.registrations.get).not.toHaveBeenCalled();
  });

  it('登录态晚到（冷启动恢复会话）时自动补一次认领', async () => {
    const router = await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES);
    expect(api.registrations.claim).not.toHaveBeenCalled();
    useSessionStore().applyUser({ id: 'u1', loggedIn: true, can: { register: true } });
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/mine/reg-1'));
    expect(api.registrations.claim).toHaveBeenCalledWith('tok-anon');
  });

  it('已登录但认领失败：留在本页看内容，并给出可见提示', async () => {
    vi.mocked(api.registrations.claim).mockRejectedValue(new ApiError('该报名已关联到其他账号', 200));
    const router = await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES, () => {
      useSessionStore().applyUser({ id: 'u1', loggedIn: true, can: { register: true } });
    });
    await vi.waitFor(() =>
      expect(document.querySelector('.reg-claim-error')?.textContent).toContain('已关联到其他账号'),
    );
    expect(router.currentRoute.value.path).toBe('/e/exh-1/status');
    expect(document.body.textContent).toContain('秋季展会');
  });

  it('不带 token 的详情页仍走登录后的接口，不显示查询链接卡', async () => {
    vi.mocked(api.registrations.get).mockResolvedValue({ found: true, registration: RECORD } as never);
    await mountAt(RegistrationDetailPage, '/mine/reg-1', ROUTES);
    expect(api.registrations.get).toHaveBeenCalledWith('reg-1');
    expect(api.registrations.queryByToken).not.toHaveBeenCalled();
    expect(document.querySelector('[data-action="query-link-card"]')).toBeNull();
  });
});

describe('注册页回跳', () => {
  const ROUTES = [
    { path: '/register', component: RegisterPage },
    { path: '/e/:id/status', component: { template: '<div />' } },
    { path: '/login', component: { template: '<div />' } },
    { path: '/mine', component: { template: '<div />' } },
  ];

  it('带 ?redirect= 时注册成功后回到查询链接', async () => {
    const target = '/e/exh-1/status?token=tok-anon';
    const router = await mountAt(RegisterPage, `/register?redirect=${encodeURIComponent(target)}`, ROUTES);
    fill('#register-username', 'newuser');
    fill('#register-email', 'new@example.com');
    fill('#register-password', 'password');
    fill('#register-confirm', 'password');
    submitForm();
    await vi.waitFor(() => expect(document.querySelector('#register-code')).not.toBeNull());
    fill('#register-code', '123456');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'));
    expect(router.currentRoute.value.query.token).toBe('tok-anon');
    expect(refreshRuntimeBootstrap).toHaveBeenCalled();
  });
});
