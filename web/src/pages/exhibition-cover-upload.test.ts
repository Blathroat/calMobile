/**
 * 展会封面上传时的进度遮罩。
 *
 * 遮罩是「由下至上变亮」：已经上传的那一段必须透出用户刚选的那张图（本机副本），
 * 不能是占位图或上一张封面；服务器返回地址后再换成服务器地址。
 *
 * 上传与面板都 mock 掉，只锁页面在遮罩下面的显示逻辑。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { api } from '@/app/runtime';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import { useSessionStore } from '@/stores/session';
import { clearExhibitionDraft } from '@/services/exhibition-draft';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { save: vi.fn(), remove: vi.fn(), get: vi.fn(), setOwner: vi.fn() },
    media: { upload: vi.fn() },
  },
}));
vi.mock('@/services/device-services', () => ({
  device: { importMedia: vi.fn(), discardMedia: vi.fn() },
}));
vi.mock('@/services/publish-media', () => ({ publishImportedMedia: vi.fn() }));
vi.mock('@/services/sheet', () => ({ confirmSheet: vi.fn(), openSheet: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const LOCAL_COVER = 'blob:cover-preview';
const SERVER_COVER = '/media/files/cover-new.png';
const blank = { render: () => null };
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  clearExhibitionDraft();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="form-test"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue({
    found: true,
    exhibition: {
      id: 'exh-cover',
      title: '秋季展会',
      date: '2026-11-17',
      venue: '会展中心',
      category: '智能家居',
      exhibitorId: 'exhibitor-1',
      exhibitor: 'example',
      imageUri: '',
    },
  });
  vi.mocked(device.importMedia).mockResolvedValue({
    url: LOCAL_COVER,
    kind: 'image',
    fileName: 'cover.jpg',
    compressed: true,
  });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountForm(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor', can: { exhibitor: true } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/exhibitor', component: blank },
      { path: '/rich-editor', component: blank },
    ],
  });
  await router.push('/exhibition-form/exh-cover');
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
}

function coverFrame(): HTMLElement {
  return document.querySelector<HTMLElement>('.cover-frame')!;
}

function coverImage(): HTMLImageElement | null {
  return coverFrame().querySelector('img');
}

function mask(): HTMLElement | null {
  return coverFrame().querySelector<HTMLElement>('.upload-progress-mask');
}

function clickUploadCover(): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.cover-side button')].find(
    (item) => item.textContent?.trim() === '上传封面',
  );
  expect(button).toBeDefined();
  button!.click();
}

describe('展会封面上传的进度遮罩', () => {
  it('上传期间遮罩下面透出的是刚选的本机图片，成功后换成服务器地址', async () => {
    let resolveUpload!: (url: string) => void;
    vi.mocked(publishImportedMedia).mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    await mountForm();
    expect(coverImage()).toBeNull();

    clickUploadCover();
    await flush();

    // 还没传完：槽位里是本机副本，遮罩按真实进度铺在上面。
    expect(coverImage()?.getAttribute('src')).toBe(LOCAL_COVER);
    expect(mask()?.getAttribute('aria-valuenow')).toBe('0');
    const onProgress = vi.mocked(publishImportedMedia).mock.calls[0]![2]!;
    onProgress(42);
    await flush();
    expect(mask()?.getAttribute('aria-valuenow')).toBe('42');
    expect(coverImage()?.getAttribute('src')).toBe(LOCAL_COVER);

    // 服务器返回地址后，槽位换成服务器地址，本机副本不再显示。
    resolveUpload(SERVER_COVER);
    await flush();
    expect(coverImage()?.getAttribute('src')).toBe(SERVER_COVER);
  });

  it('上传失败时撤掉本机副本，回到原来的占位状态', async () => {
    vi.mocked(publishImportedMedia).mockRejectedValue(new Error('后端响应超时（超过 120 秒）'));
    await mountForm();

    clickUploadCover();
    await flush();

    expect(coverImage()).toBeNull();
    expect(mask()).toBeNull();
  });
});
