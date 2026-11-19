/**
 * 管理设置「报名相关」卡片：匿名报名姓名同义词列表。
 *
 * 服务端下发数组、页面上按「一行一个标题」编辑，保存时再拆成数组提交（空行忽略）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import AdminPage from './AdminPage.vue';

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
  exhibitor: { maxFutureExhibitions: 0, maxFutureMeetings: 0, maxExhibitionDays: 0 },
  cover: { defaultCover: '' },
  invite: { uses: 1, validHours: 168, durationDays: 0 },
  download: { source: 'url', url: '', repo: '' },
  registration: { nameFieldTitles: ['姓名', '昵称'] },
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
    routes: [{ path: '/admin', component: AdminPage }],
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

describe('管理设置 · 报名相关', () => {
  it('按一行一个标题回填姓名同义词，并说明用途', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-registration-name-titles')).not.toBeNull());
    const textarea = container.querySelector<HTMLTextAreaElement>('#settings-registration-name-titles')!;
    expect(textarea.value).toBe('姓名\n昵称');
    const card = textarea.closest('.card') as HTMLElement;
    expect(card.textContent).toContain('报名相关');
    expect(card.textContent).toContain('匿名报名姓名同类标题');
    expect(card.textContent).toContain('每行一个');
  });

  it('保存时把多行标题拆成数组提交，空行忽略', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-registration-name-titles')).not.toBeNull());
    const textarea = container.querySelector<HTMLTextAreaElement>('#settings-registration-name-titles')!;
    textarea.value = '  称呼  \n\n圈名\n';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    saveButton().click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(1));
    const payload = mocks.settingsSave.mock.calls[0]![0] as { registrationNameFieldTitles?: unknown };
    expect(payload.registrationNameFieldTitles).toEqual(['称呼', '圈名']);
  });
});
