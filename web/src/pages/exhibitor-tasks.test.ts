/**
 * 展商后台：首屏的三件事。
 *
 * 覆盖的规则：
 * - 首屏先摆「发布展会 / 报名管理 / 核销报名码」，展会列表排在它们后面；
 * - 发布进新建展会页；只有一个展会时报名管理直达这场展会，多个时先进选择页；
 * - 核销进核销页，并把与账号绑定的一次性提示记为已读；
 * - 受限账号不能发布与核销（入口置灰并说明原因），审核已有报名仍可用；
 * - 提示只在账号没看过时出现，点「知道了」后收起并写回账号。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import ExhibitorPage from './ExhibitorPage.vue';
import { api } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import type { Exhibition, User } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { list: vi.fn(async () => []), get: vi.fn() },
    profile: { markHint: vi.fn(async () => ({ ok: true })) },
  },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
vi.mock('@/services/device-services', () => ({ device: { saveImage: vi.fn() } }));
vi.mock('@/services/native-bridge', () => ({ nativeBridge: { hasNative: vi.fn(() => false) } }));
vi.mock('@/services/clipboard', () => ({ copyText: vi.fn(async () => true) }));

const EXHIBITION: Exhibition = {
  id: 'exh-1',
  title: '秋季设计展',
  dateLabel: '2026年11月20日',
  time: '09:00-17:00',
  venue: '国际会展中心',
  statusCode: 'open',
  registrationCount: 12,
  qrEnabled: true,
};

const SECOND: Exhibition = { ...EXHIBITION, id: 'exh-2', title: '春季家居展' };

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="exhibitor-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  await nextTick();
}

interface MountOptions {
  user?: Partial<User>;
  exhibitions?: Exhibition[];
}

async function mountPage(options: MountOptions = {}): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({
    id: 'exhibitor-1',
    role: 'exhibitor',
    can: { limited: false },
    ...options.user,
  });
  useBootstrapStore().publicBaseUrl = 'https://expo.example.com';
  vi.mocked(api.exhibitions.list).mockResolvedValue(options.exhibitions ?? [EXHIBITION]);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibitor', component: ExhibitorPage },
      { path: '/detail/:id', component: { template: '<div />' } },
      { path: '/exhibition-form', component: { template: '<div />' } },
      { path: '/exhibition-form/:id', component: { template: '<div />' } },
      { path: '/review', component: { template: '<div />' } },
      { path: '/checkin', component: { template: '<div />' } },
    ],
  });
  await router.push('/exhibitor');
  app = createApp({ render: () => h(ExhibitorPage) })
    .use(pinia)
    .use(router);
  app.mount('#exhibitor-test');
  await vi.waitFor(() => expect(api.exhibitions.list).toHaveBeenCalled());
  await flush();
  return router;
}

function task(name: 'create' | 'review' | 'checkin'): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-task="${name}"]`);
  if (!button) throw new Error(`缺少任务入口：${name}`);
  return button;
}

describe('展商后台：首屏任务入口', () => {
  it('三件事按发布、审核、核销排在展会列表之前', async () => {
    await mountPage();

    expect(task('create').textContent?.trim()).toBe('发布展会');
    expect(task('review').textContent?.trim()).toBe('报名管理');
    expect(task('checkin').textContent?.trim()).toBe('核销报名码');

    const list = document.querySelector('#exhibitor-test .card .exh-main');
    expect(list).not.toBeNull();
    // 任务入口在上，展会卡在下。
    expect(task('create').compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(task('review').compareDocumentPosition(task('checkin')) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('点「发布展会」进入新建展会页', async () => {
    const router = await mountPage();

    task('create').click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibition-form'));
  });

  it('只有一个展会时「报名管理」直达这场展会的报名管理', async () => {
    const router = await mountPage();

    task('review').click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review'));
    expect(router.currentRoute.value.query.exhibitionId).toBe('exh-1');
  });

  it('有多个展会时「报名管理」先进选择页', async () => {
    const router = await mountPage({ exhibitions: [EXHIBITION, SECOND] });

    task('review').click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review'));
    expect(router.currentRoute.value.query.exhibitionId).toBeUndefined();
  });

  it('点「核销报名码」进入核销页，并把这条一次性提示记为已读', async () => {
    const router = await mountPage();

    task('checkin').click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/checkin'));
    await vi.waitFor(() => expect(api.profile.markHint).toHaveBeenCalledWith('exhibitor-checkin'));
    await flush();
    expect(document.querySelector('.hint-note')).toBeNull();
  });

  it('受限账号：发布与核销置灰并说明原因，报名管理仍可用', async () => {
    await mountPage({ user: { can: { limited: true } } });

    expect(task('create').disabled).toBe(true);
    expect(task('checkin').disabled).toBe(true);
    expect(task('review').disabled).toBe(false);
    expect(task('create').getAttribute('title')).toBe('账号已被限制，不能发布展会');
    expect(task('checkin').getAttribute('title')).toBe('账号已被限制，不能核销');
    // 提示条也带 .notice：这里要看的是受限说明那条。
    expect(document.querySelector('#exhibitor-test .notice:not(.hint-note)')?.textContent).toContain('账号已被限制');
  });

  it('没看过提示时显示，点「知道了」收起并写回账号', async () => {
    await mountPage();
    const note = document.querySelector<HTMLElement>('.hint-note');
    expect(note?.textContent).toContain('展商后台可发布展会、审核报名和核销报名码');

    const dismiss = [...note!.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '知道了',
    );
    if (!dismiss) throw new Error('提示里缺少「知道了」');
    dismiss.click();

    await vi.waitFor(() => expect(api.profile.markHint).toHaveBeenCalledWith('exhibitor-checkin'));
    await flush();
    expect(document.querySelector('.hint-note')).toBeNull();
    expect(useSessionStore().user.seenHints).toContain('exhibitor-checkin');
  });

  it('账号已经看过提示时不再显示', async () => {
    await mountPage({ user: { seenHints: ['exhibitor-checkin'] } });
    expect(document.querySelector('.hint-note')).toBeNull();
  });
});
