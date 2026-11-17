/**
 * 管理设置「展商相关」卡片：卡片标题改名、新增单个展会最大持续天数并随设置保存。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import AdminPage from './AdminPage.vue';

const MB = 1024 * 1024;

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSave: vi.fn(),
  applyBootstrap: vi.fn(),
}));

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn(async () => []) },
    exhibitions: { list: vi.fn(async () => []), month: vi.fn(), get: vi.fn(async () => ({})) },
    settings: { get: mocks.settingsGet, save: mocks.settingsSave },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: mocks.applyBootstrap,
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));

const SETTINGS = {
  brand: { zh: '应用', en: 'App' },
  theme: { accentColor: '#41707E', colors: ['#41707E'] },
  upload: {
    avatarFormats: ['jpg', 'jpeg', 'png', 'webp'],
    imageFormats: ['jpg', 'png'],
    videoFormats: ['mp4'],
    avatarSizeMb: 2,
    storageMb: 1024,
  },
  limits: {},
  categories: [],
  agreement: { enabled: false, version: 0, content: '', updatedAt: '' },
  invites: [],
  logs: { storageMb: 256, usedBytes: 128 * MB, entryCount: 42 },
  exhibitor: { maxFutureExhibitions: 2, maxFutureMeetings: 1, maxExhibitionDays: 7 },
  cover: { defaultCover: '' },
  invite: { uses: 1, validHours: 168, durationDays: 0 },
  download: { source: 'url', url: '', repo: '' },
};

let app: App | undefined;
let router: Router | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsGet.mockResolvedValue(SETTINGS);
  mocks.settingsSave.mockResolvedValue({ ok: true, settings: SETTINGS });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  router = undefined;
  document.body.replaceChildren();
  document.getElementById('app-foot')?.remove();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountAdmin(): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({
    id: 'u1',
    username: 'admin',
    nickname: '管理员',
    role: 'admin',
    loggedIn: true,
    guest: false,
    can: { admin: true },
  });
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin', component: AdminPage },
      { path: '/logs', component: { template: '<div />' } },
    ],
  });
  await router.push('/admin?tab=settings');
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp({ render: () => h(AdminPage) });
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await flush();
  return container;
}

function saveButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.settings-save-fab')!;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('管理设置 · 展商相关', () => {
  it('展商卡标题改为「展商相关」，并从设置回填单个展会最大持续天数', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-max-exhibition-days')).not.toBeNull());
    const card = container.querySelector<HTMLElement>('#settings-max-exhibition-days')!.closest('.card') as HTMLElement;
    expect(card.textContent).toContain('展商相关');
    expect(card.textContent).toContain('单个展会最大持续天数');
    expect(card.textContent).toContain('0 表示不限');
    const input = container.querySelector<HTMLInputElement>('#settings-max-exhibition-days')!;
    expect(input.value).toBe('7');
    // 同一张卡里同时筹备数 / 会议数还在
    expect(card.querySelector('#settings-max-future-exhibitions')).not.toBeNull();
    expect(card.querySelector('#settings-max-future-meetings')).not.toBeNull();
  });

  it('保存时把单个展会最大持续天数一起提交', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-max-exhibition-days')).not.toBeNull());
    setInput(container.querySelector<HTMLInputElement>('#settings-max-exhibition-days')!, '10');
    await nextTick();
    saveButton().click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(1));
    const payload = mocks.settingsSave.mock.calls[0]![0] as { maxExhibitionDays?: unknown };
    expect(payload.maxExhibitionDays).toBe(10);
  });
});
