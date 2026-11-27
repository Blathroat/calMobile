/**
 * 报名站分享链接的前端流程（需求 9）：
 *
 * - `RegistrationFormPage` 在「报名站 + 未登录」时是匿名报名：多一项必填姓名，
 *   提交成功后带查询凭据进状态页；已登录的报名站用户仍走原来的「我的活动」。
 * - `RegistrationDetailPage` 的查询链接模式：公开取数，未登录页脚是登录 / 注册，
 *   展示查询链接与「必须保存」的提示；已登录先认领，成功换到普通的详情页。
 * - `RegisterPage` 支持 `?redirect=`，注册成功后回跳查询链接（登录后自动认领）。
 *
 * 需求 6、7 的页面行为也在这里钉住：
 * - 匿名报名的姓名优先取标题命中同义词表的文本收集项；没有命中时才补一项「昵称」；
 * - 多天展会显示参加时间（日期范围抽屉，范围限制在展会期间），提交随报名带上起止；
 *   单日展会不显示也不提交。
 *
 * 报名站是另一份构建（`isJoinSurface`），这里把 `@/app/surface` 换成报名站版本；
 * 挂载方式仿 detail-registration.test.ts / auth-entry.test.ts：mock `@/app/runtime`，
 * 用真实 pinia + 内存路由把页面挂进 jsdom。需要点开日期抽屉的用例多挂一个真实的
 * `AppSheet`（与 exhibition-form-schedule.test.ts 同一套做法）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { api, refreshRuntimeBootstrap } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { ApiError } from '@/services/http-client';
import { copyText } from '@/services/clipboard';
import { closeSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import AppSheet from '@/components/AppSheet.vue';
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

/** 多天展会：闭展日期晚于开展，报名表单里会多一行「参加时间」。 */
const MULTI_DAY_EXHIBITION = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    date: '2026-09-20',
    endDate: '2026-09-22',
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

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  // 上一个用例打开的抽屉不影响本次断言；退场动画按「减少动效」立即结束。
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
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

afterEach(async () => {
  app?.unmount();
  app = undefined;
  navigation.cancel();
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
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
 * `withSheet` 多挂一个真实的 `AppSheet`，用来点开日期抽屉。
 */
async function mountAt(
  component: object,
  path: string,
  routes: Parameters<typeof createRouter>[0]['routes'],
  prepare?: () => void,
  options: { withSheet?: boolean } = {},
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
  app = options.withSheet
    ? createApp({ render: () => [h(component), h(AppSheet)] })
        .use(pinia)
        .use(router)
    : createApp(component).use(pinia).use(router);
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

function submitPayload(): Record<string, unknown> {
  const call = vi.mocked(api.registrations.submit).mock.calls[0];
  expect(call, '还没有提交报名').toBeDefined();
  return call![0] as Record<string, unknown>;
}

/** 点开参加时间的日期抽屉后，点某一天（抽屉里每格都是带 data-date 的按钮）。 */
function pickDay(isoDate: string): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-date="${isoDate}"]`);
  expect(button, `抽屉里没有 ${isoDate} 这一天`).not.toBeNull();
  button!.click();
}

function attendanceText(part: 'start' | 'end'): string {
  return document.querySelector(`#registration-attendance-${part}`)?.textContent ?? '';
}

describe('匿名报名（报名站未登录）', () => {
  const ROUTES = [
    { path: '/e/:id/register', component: RegistrationFormPage },
    { path: '/e/:id/status', component: { template: '<div />' } },
    { path: '/mine', component: { template: '<div />' } },
  ];

  it('没有姓名同义词收集项时补一项必填「昵称」，没填不发请求', async () => {
    await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES);
    expect(document.querySelector('#registration-guest-name')).not.toBeNull();
    const label = document.querySelector('label[for="registration-guest-name"]');
    expect(label?.textContent).toContain('昵称');
    submitForm();
    await flush();
    expect(api.registrations.submit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请填写昵称');
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
    expect(JSON.parse(localStorage.getItem('calmobile.seen-hints') || '[]')).toContain('registration-form');
  });

  it('报名已关闭时提交按钮置灰，并在按钮下方说明原因', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      ...EXHIBITION,
      exhibition: { ...EXHIBITION.exhibition, openForRegistration: false },
    } as never);
    await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES);

    const submit = [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].find((button) =>
      button.classList.contains('cta'),
    );
    expect(submit?.disabled).toBe(true);
    expect(document.querySelector('#app-foot .field-hint')?.textContent).toContain('该展会当前不接受报名');
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

describe('匿名报名的姓名合并（需求 6）', () => {
  const ROUTES = [
    { path: '/e/:id/register', component: RegistrationFormPage },
    { path: '/e/:id/status', component: { template: '<div />' } },
    { path: '/mine', component: { template: '<div />' } },
  ];

  it('标题命中缺省同义词的文本收集项直接当姓名，不再渲染额外姓名表单', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      ...EXHIBITION,
      fields: [{ title: '称呼', type: 'text' }],
    } as never);
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, () => {
      // 老服务端没有 registration 段：启动数据到了但缺这一段，同样按缺省四词匹配。
      useBootstrapStore().apply({});
    });
    expect(document.querySelector('#registration-guest-name')).toBeNull();
    const label = document.querySelector('label[for="field-称呼"]');
    expect(label?.textContent).toContain('称呼');
    // 匿名模式下这个收集项由报名页兜底成必填，展商没勾必填也要显示星号。
    expect(label?.textContent).toContain('*');
    fill('[id="field-称呼"]', '匿名访客');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });
    const payload = submitPayload();
    expect(payload.visitorName).toBe('匿名访客');
    // 收集项照旧随 answers 一起提交，没有被从收集项列表里删掉。
    expect(String(payload.answers)).toContain('称呼：匿名访客');
  });

  it('命中的收集项为空时拦在提交前，错误落在该收集项并聚焦', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      ...EXHIBITION,
      fields: [{ title: '昵称', type: 'text' }],
    } as never);
    await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, () => {
      useBootstrapStore().apply({ registration: { nameFieldTitles: ['姓名', '昵称', '称呼', '圈名'] } });
    });
    submitForm();
    await flush();
    expect(api.registrations.submit).not.toHaveBeenCalled();
    expect(document.querySelector('.field-error')?.textContent).toContain('请填写姓名');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('field-昵称'));
  });

  it('同义词表以服务端下发为准，只有列表里的标题才当姓名', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      ...EXHIBITION,
      fields: [
        { title: '姓名', type: 'text' },
        { title: '昵称', type: 'text' },
      ],
    } as never);
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, () => {
      // 只配「昵称」：排在前面的「姓名」收集项不再当姓名来源。
      useBootstrapStore().apply({ registration: { nameFieldTitles: ['昵称'] } });
    });
    expect(document.querySelector('#registration-guest-name')).toBeNull();
    fill('[id="field-姓名"]', '王五');
    fill('[id="field-昵称"]', '赵六');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });
    expect(submitPayload().visitorName).toBe('赵六');
  });

  it('服务端下发空数组表示管理员关掉合并，仍显示「昵称」输入框', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      ...EXHIBITION,
      fields: [{ title: '姓名', type: 'text' }],
    } as never);
    await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, () => {
      useBootstrapStore().apply({ registration: { nameFieldTitles: [] } });
    });
    // 空数组是显式配置：不以缺省四词盖掉它，额外的姓名输入照旧出现。
    expect(document.querySelector('label[for="registration-guest-name"]')?.textContent).toContain('昵称');
    // 「姓名」收集项照常渲染，只是不再充当姓名来源（没有必填星号）。
    const fieldLabel = document.querySelector('label[for="field-姓名"]');
    expect(fieldLabel).not.toBeNull();
    expect(fieldLabel?.textContent).not.toContain('*');
  });
});

describe('多天展会的参加时间（需求 7）', () => {
  const ROUTES = [
    { path: '/e/:id/register', component: RegistrationFormPage },
    { path: '/e/:id/status', component: { template: '<div />' } },
    { path: '/mine', component: { template: '<div />' } },
  ];

  it('显示两个日期按钮，默认整段展会区间并随提交带上', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue(MULTI_DAY_EXHIBITION as never);
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES);
    expect(document.querySelector('#registration-attendance-start')).not.toBeNull();
    expect(document.querySelector('#registration-attendance-end')).not.toBeNull();
    expect(attendanceText('start')).toContain('9月20日');
    expect(attendanceText('end')).toContain('9月22日');

    fill('#registration-guest-name', '匿名访客');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });
    const payload = submitPayload();
    expect(payload.attendanceStart).toBe('2026-09-20');
    expect(payload.attendanceEnd).toBe('2026-09-22');
  });

  it('在日期抽屉里改窄后，提交的起止就是新选的区间', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue(MULTI_DAY_EXHIBITION as never);
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, undefined, { withSheet: true });
    fill('#registration-guest-name', '匿名访客');

    document.querySelector<HTMLButtonElement>('#registration-attendance-start')!.click();
    await flush();
    // 抽屉的范围限制在展会期间：开展日之前与闭展日之后的日期都不可选。
    expect(document.querySelector<HTMLButtonElement>('[data-date="2026-09-19"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-date="2026-09-23"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-date="2026-09-21"]')?.disabled).toBe(false);
    pickDay('2026-09-21');
    await flush();
    pickDay('2026-09-22');
    await flush();
    expect(attendanceText('start')).toContain('9月21日');
    expect(attendanceText('end')).toContain('9月22日');

    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });
    const payload = submitPayload();
    expect(payload.attendanceStart).toBe('2026-09-21');
    expect(payload.attendanceEnd).toBe('2026-09-22');
  });

  it('两次点同一天时，参加开始与参加结束都显示这一天', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue(MULTI_DAY_EXHIBITION as never);
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES, undefined, { withSheet: true });
    fill('#registration-guest-name', '匿名访客');

    document.querySelector<HTMLButtonElement>('#registration-attendance-end')!.click();
    await flush();
    pickDay('2026-09-21');
    await flush();
    pickDay('2026-09-21');
    await flush();
    expect(attendanceText('start')).toContain('9月21日');
    expect(attendanceText('end')).toContain('9月21日');

    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });
    const payload = submitPayload();
    expect(payload.attendanceStart).toBe('2026-09-21');
    expect(payload.attendanceEnd).toBe('2026-09-21');
  });

  it('单日展会不显示参加时间，也不提交这两个字段', async () => {
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register', ROUTES);
    expect(document.querySelector('#registration-attendance-start')).toBeNull();
    fill('#registration-guest-name', '匿名访客');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/e/exh-1/status'), { timeout: 3000 });
    const payload = submitPayload();
    expect(payload).not.toHaveProperty('attendanceStart');
    expect(payload).not.toHaveProperty('attendanceEnd');
  });

  it('修改报名时已有参加时间优先于默认整段区间', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue(MULTI_DAY_EXHIBITION as never);
    vi.mocked(api.registrations.get).mockResolvedValue({
      found: true,
      registration: { ...RECORD, attendanceStart: '2026-09-21', attendanceEnd: '2026-09-22' },
    } as never);
    const router = await mountAt(RegistrationFormPage, '/e/exh-1/register?registrationId=reg-1', ROUTES, () => {
      useSessionStore().applyUser({
        id: 'u1',
        nickname: '张三',
        role: 'user',
        loggedIn: true,
        can: { register: true },
      });
    });
    expect(attendanceText('start')).toContain('9月21日');
    expect(attendanceText('end')).toContain('9月22日');
    submitForm();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/mine'), { timeout: 3000 });
    const payload = submitPayload();
    expect(payload.attendanceStart).toBe('2026-09-21');
    expect(payload.attendanceEnd).toBe('2026-09-22');
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

  it('报名信息区展示参加时间（两端都有才显示）', async () => {
    vi.mocked(api.registrations.queryByToken).mockResolvedValue({
      found: true,
      registration: { ...RECORD, attendanceStart: '2026-09-21', attendanceEnd: '2026-09-22' },
    } as never);
    await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES);
    expect(document.body.textContent).toContain('参加时间');
    expect(document.body.textContent).toContain('9月21日（周一） - 9月22日（周二）');
  });

  it('没有参加时间时不显示这一行', async () => {
    await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES);
    expect(document.body.textContent).not.toContain('参加时间');
  });

  it('复制按钮复制查询链接并提示', async () => {
    await mountAt(RegistrationDetailPage, '/e/exh-1/status?token=tok-anon', ROUTES, () => {
      useBootstrapStore().apply({ publicBaseUrl: 'https://app.example.com' });
    });
    document.querySelector<HTMLButtonElement>('[data-action="copy-query-link"]')!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('查询链接已复制', 'success'));
    expect(copyText).toHaveBeenCalledWith('https://app.example.com/e/exh-1/status?token=tok-anon');
    expect(JSON.parse(localStorage.getItem('calmobile.seen-hints') || '[]')).toContain('registration-status');
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
