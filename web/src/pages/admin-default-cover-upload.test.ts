/**
 * 管理-设置里的「缺省封面」上传：进度遮罩下面透出的必须是刚选的图。
 *
 * 比编辑展会页的封面多一层：这里图片地址在子组件 `AdminSettingsSection` 里渲染，
 * 上传中的本机副本由 `AdminPage` 通过 `coverPreview` 传进去。
 * 上传本身 mock 掉，只锁页面与子组件之间的显示逻辑。
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
  importMedia: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn(async () => []) },
    exhibitions: { list: vi.fn(async () => []), month: vi.fn(), get: vi.fn(async () => ({})) },
    settings: { get: mocks.settingsGet, save: mocks.settingsSave },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: vi.fn(),
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/services/device-services', () => ({
  device: { importMedia: mocks.importMedia, discardMedia: vi.fn() },
}));
vi.mock('@/services/publish-media', () => ({ publishImportedMedia: mocks.publish }));

const LOCAL_COVER = 'blob:default-cover';
const SERVER_COVER = '/media/files/default-cover.png';
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
  logs: { storageMb: 256, usedBytes: 0, entryCount: 0 },
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
  mocks.importMedia.mockResolvedValue({ url: LOCAL_COVER, kind: 'image', fileName: 'cover.jpg', compressed: true });
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

function coverImage(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>('.cover-frame img');
}

function mask(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cover-frame .upload-progress-mask');
}

function clickUploadCover(): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.cover-side button')].find(
    (item) => item.textContent?.trim() === '上传封面',
  );
  expect(button).toBeDefined();
  button!.click();
}

describe('管理-设置的缺省封面上传', () => {
  it('上传期间槽位显示刚选的本机图，服务器返回后换成服务器地址', async () => {
    let resolveUpload!: (url: string) => void;
    mocks.publish.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    await mountAdmin();
    await vi.waitFor(() => expect(document.querySelector('.cover-frame')).not.toBeNull());
    expect(coverImage()).toBeNull();

    clickUploadCover();
    await flush();

    expect(coverImage()?.getAttribute('src')).toBe(LOCAL_COVER);
    expect(mask()?.getAttribute('aria-valuenow')).toBe('0');
    const onProgress = mocks.publish.mock.calls[0]![2] as (percent: number) => void;
    onProgress(30);
    await flush();
    expect(mask()?.getAttribute('aria-valuenow')).toBe('30');
    expect(coverImage()?.getAttribute('src')).toBe(LOCAL_COVER);

    resolveUpload(SERVER_COVER);
    await flush();
    expect(coverImage()?.getAttribute('src')).toBe(SERVER_COVER);
  });

  it('上传失败时撤掉本机副本，槽位回到没有封面的状态', async () => {
    mocks.publish.mockRejectedValue(new Error('后端响应超时（超过 120 秒）'));
    await mountAdmin();
    await vi.waitFor(() => expect(document.querySelector('.cover-frame')).not.toBeNull());

    clickUploadCover();
    await flush();

    expect(coverImage()).toBeNull();
    expect(mask()).toBeNull();
  });
});
