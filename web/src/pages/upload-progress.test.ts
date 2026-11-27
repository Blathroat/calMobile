/**
 * 上传进度：编辑展会封面、管理-缺省封面、富文本插图三处共用同一层遮罩。
 *
 * 钉住这几件事：进度由 `publishImportedMedia` 的 `onProgress` 回传（0 → 中间 → 服务器确认后 100，
 * 字节发完只算 99）、100% 至少停留约 150ms 才卸载、成功后换上新图 / 服务器地址、
 * 失败与取消立即撤掉遮罩和占位（失败要提示，取消静默）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import AdminPage from './AdminPage.vue';
import RichEditorPage from './RichEditorPage.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { publishImportedMedia } from '@/services/publish-media';
import { device } from '@/services/device-services';
import { toast } from '@/services/toast';
import { loadHtmlConverter, loadMarkdownParser } from '@/services/markdown';

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn(async () => []) },
    exhibitions: { list: vi.fn(async () => []), month: vi.fn(), get: vi.fn(), save: vi.fn(), remove: vi.fn() },
    settings: { get: vi.fn(), save: vi.fn() },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: vi.fn(),
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/app/preload', () => ({ preloadAdjacentMonths: vi.fn() }));
vi.mock('@/services/publish-media', () => ({ publishImportedMedia: vi.fn() }));
vi.mock('@/services/device-services', () => ({ device: { importMedia: vi.fn(), discardMedia: vi.fn() } }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const blank = defineComponent({ render: () => h('div') });

/** 管理端设置接口的回包：字段与真实接口同形（沿用管理设置其它用例的夹具）。 */
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
  agreement: { enabled: false, version: 2, content: '', updatedAt: '' },
  invites: [],
};

/** 可控的上传 Promise：测试自己决定什么时候回包 / 失败，好在中间断言进度。 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 当前这次上传：进度回调 + 受控回包。 */
let upload: { onProgress?: (percent: number) => void; result: Deferred<string> } | undefined;

function stubUpload(): void {
  vi.mocked(publishImportedMedia).mockImplementation((_kind, _imported, onProgress) => {
    const result = deferred<string>();
    upload = { onProgress, result };
    return result.promise;
  });
}

let app: App | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  upload = undefined;
  document.body.innerHTML = '';
  await loadMarkdownParser();
  await loadHtmlConverter();
  vi.mocked(api.exhibitions.get).mockResolvedValue({ found: false });
  vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true });
  vi.mocked(api.settings.get).mockResolvedValue(SETTINGS);
  stubUpload();
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

function buttonByText(scope: ParentNode, label: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`找不到按钮：${label}`);
  return button;
}

function mask(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.upload-progress-mask');
}

function percentText(): string | undefined {
  return document.querySelector('.upload-progress-value')?.textContent?.trim();
}

function scrimHeight(): string {
  return document.querySelector<HTMLElement>('.upload-progress-scrim')?.style.height ?? '';
}

/** 100% 停留（150ms）走完后遮罩应当消失。 */
async function waitForMaskGone(): Promise<void> {
  await vi.waitFor(() => expect(mask()).toBeNull(), { timeout: 1500 });
}

// ── 编辑展会页封面 ───────────────────────────────────────────────

async function mountExhibitionForm(): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="form-test"></div>';
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form', component: ExhibitionFormPage },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/rich-editor', component: blank },
      { path: '/exhibitor', component: blank },
    ],
  });
  await router.push('/exhibition-form');
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
  return document.querySelector<HTMLElement>('#form-test')!;
}

describe('编辑展会封面：上传进度', () => {
  it('进度 0 → 中间 → 服务器确认后 100，遮罩停留后撤掉并换上新图', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:cover-local',
      kind: 'image',
      fileName: 'cover.jpg',
      bytes: 2048,
    });
    const container = await mountExhibitionForm();
    const uploadButton = buttonByText(container, '上传封面');
    uploadButton.click();
    await vi.waitFor(() => expect(mask()).not.toBeNull());
    expect(percentText()).toBe('0%');
    expect(scrimHeight()).toBe('100%');
    // 上传期间按钮禁用并带 loading，不能同时开第二份上传。
    expect(uploadButton.disabled).toBe(true);
    expect(uploadButton.getAttribute('data-loading')).toBe('true');

    upload!.onProgress!(0);
    await nextTick();
    expect(percentText()).toBe('0%');
    upload!.onProgress!(45);
    await nextTick();
    expect(percentText()).toBe('45%');
    // 遮罩从顶部退到 55%，底部 45% 透出图片（由下至上变亮）。
    expect(scrimHeight()).toBe('55%');
    // 字节发完只到 99：服务器还没确认，不能提前显示 100% 或把遮罩收掉。
    upload!.onProgress!(100);
    await nextTick();
    expect(percentText()).toBe('99%');
    expect(mask()).not.toBeNull();

    upload!.result.resolve('https://media.test/cover.jpg');
    await vi.waitFor(() => expect(percentText()).toBe('100%'));
    await waitForMaskGone();
    expect(container.querySelector<HTMLImageElement>('.cover-frame img')?.getAttribute('src')).toBe(
      'https://media.test/cover.jpg',
    );
    expect(uploadButton.disabled).toBe(false);
    expect(vi.mocked(toast)).toHaveBeenCalled();
  });

  it('上传失败立即撤掉遮罩与进度，图片不变并提示错误', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:cover-local',
      kind: 'image',
      fileName: 'cover.jpg',
      bytes: 2048,
    });
    const container = await mountExhibitionForm();
    buttonByText(container, '上传封面').click();
    await vi.waitFor(() => expect(mask()).not.toBeNull());
    upload!.onProgress!(60);
    await nextTick();

    upload!.result.reject(new Error('网络不太好'));
    await vi.waitFor(() => expect(mask()).toBeNull());
    expect(container.querySelector('.cover-frame img')).toBeNull();
    expect(vi.mocked(toast)).toHaveBeenCalledWith('网络不太好', 'error');
  });

  it('选择器里取消时静默复位：没有遮罩，也不提示错误', async () => {
    vi.mocked(device.importMedia).mockRejectedValue({ code: 'cancelled' });
    const container = await mountExhibitionForm();
    buttonByText(container, '上传封面').click();
    await flush();
    expect(mask()).toBeNull();
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });
});

// ── 管理-设置缺省封面 ─────────────────────────────────────────────

async function mountAdminSettings(): Promise<HTMLElement> {
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
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin', component: AdminPage }],
  });
  await router.push('/admin?tab=settings');
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp({ render: () => h(AdminPage) })
    .use(pinia)
    .use(router);
  app.mount(container);
  await flush();
  await vi.waitFor(() => expect(buttonByText(container, '上传封面')).toBeDefined());
  return container;
}

describe('管理-设置缺省封面：上传进度', () => {
  it('coverBusy 与进度联动：上传期间禁用按钮，成功后换图并撤掉遮罩', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:cover-local',
      kind: 'image',
      fileName: 'cover.jpg',
      bytes: 2048,
    });
    const container = await mountAdminSettings();
    const uploadButton = buttonByText(container, '上传封面');
    uploadButton.click();
    await vi.waitFor(() => expect(mask()).not.toBeNull());
    expect(percentText()).toBe('0%');
    expect(uploadButton.disabled).toBe(true);
    expect(uploadButton.getAttribute('data-loading')).toBe('true');

    upload!.onProgress!(30);
    await nextTick();
    expect(percentText()).toBe('30%');

    upload!.result.resolve('https://media.test/default-cover.jpg');
    await vi.waitFor(() => expect(percentText()).toBe('100%'));
    await waitForMaskGone();
    expect(container.querySelector<HTMLImageElement>('.cover-frame img')?.getAttribute('src')).toBe(
      'https://media.test/default-cover.jpg',
    );
    expect(uploadButton.disabled).toBe(false);
  });

  it('失败撤掉遮罩，缺省封面保持为空', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:cover-local',
      kind: 'image',
      fileName: 'cover.jpg',
      bytes: 2048,
    });
    const container = await mountAdminSettings();
    buttonByText(container, '上传封面').click();
    await vi.waitFor(() => expect(mask()).not.toBeNull());
    upload!.onProgress!(20);
    await nextTick();

    upload!.result.reject(new Error('上传失败'));
    await vi.waitFor(() => expect(mask()).toBeNull());
    expect(container.querySelector('.cover-frame img')).toBeNull();
    expect(vi.mocked(toast)).toHaveBeenCalledWith('上传失败', 'error');
  });

  it('取消选择时静默复位', async () => {
    vi.mocked(device.importMedia).mockRejectedValue({ code: 'cancelled' });
    const container = await mountAdminSettings();
    buttonByText(container, '上传封面').click();
    await flush();
    expect(mask()).toBeNull();
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });
});

// ── 富文本编辑页插图 ─────────────────────────────────────────────

async function mountRichEditor(): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app-foot"></div><div id="editor-test"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue({
    found: true,
    exhibition: { id: 'exh-1', title: '秋季展会', description: '', descriptionFormat: 'md' },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/rich-editor', component: RichEditorPage },
      { path: '/exhibition-form', component: blank },
      { path: '/exhibition-form/:id', component: blank },
    ],
  });
  await router.push('/exhibition-form');
  await router.push('/rich-editor?id=exh-1');
  app = createApp(RichEditorPage).use(pinia).use(router);
  app.mount('#editor-test');
  await flush();
  await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
  return document.querySelector<HTMLElement>('#editor-test')!;
}

describe('富文本插图：上传进度', () => {
  it('图片：插入位置先显示本地预览与进度，成功后换成服务器地址', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:image-local',
      kind: 'image',
      fileName: 'photo.jpg',
      bytes: 4096,
    });
    const container = await mountRichEditor();
    const insertButton = container.querySelector<HTMLButtonElement>('button[title="插入图片"]')!;
    insertButton.click();
    await vi.waitFor(() => expect(document.querySelector('.media-tile-pending')).not.toBeNull());
    const pendingTile = document.querySelector<HTMLElement>('.media-tile-pending')!;
    expect(pendingTile.querySelector('img')?.getAttribute('src')).toBe('blob:image-local');
    expect(percentText()).toBe('0%');
    expect(scrimHeight()).toBe('100%');
    // 同一时间只跑一份上传：工具条按钮都禁用。
    expect(insertButton.disabled).toBe(true);

    upload!.onProgress!(35);
    await nextTick();
    expect(percentText()).toBe('35%');
    expect(pendingTile.querySelector<HTMLElement>('.upload-progress-scrim')?.style.height).toBe('65%');

    upload!.result.resolve('https://media.test/photo.jpg');
    await vi.waitFor(() => expect(percentText()).toBe('100%'));
    // 正文已经写入服务器地址，占位先把预览换成服务器地址（本地 object URL 已收回）。
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('(https://media.test/photo.jpg)');
    await vi.waitFor(() => expect(document.querySelector('.media-tile-pending')).toBeNull());
    const tile = document.querySelector<HTMLImageElement>('.media-grid .media-tile img');
    expect(tile?.getAttribute('src')).toBe('https://media.test/photo.jpg');
    expect(insertButton.disabled).toBe(false);
  });

  it('视频：占位只显示文件名与进度，成功后写入 video 标签', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:video-local',
      kind: 'video',
      fileName: 'demo.mp4',
      bytes: 1024,
    });
    const container = await mountRichEditor();
    const insertButton = container.querySelector<HTMLButtonElement>('button[title="插入视频"]')!;
    insertButton.click();
    await vi.waitFor(() => expect(document.querySelector('.media-tile-pending')).not.toBeNull());
    expect(document.querySelector('.media-tile-pending .media-file-name')?.textContent?.trim()).toBe('demo.mp4');
    expect(percentText()).toBe('0%');

    upload!.onProgress!(70);
    await nextTick();
    expect(percentText()).toBe('70%');

    upload!.result.resolve('https://media.test/demo.mp4');
    await vi.waitFor(() => expect(percentText()).toBe('100%'));
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain(
      '<video controls src="https://media.test/demo.mp4">',
    );
    await vi.waitFor(() => expect(document.querySelector('.media-tile-pending')).toBeNull());
    expect(document.querySelector('.media-grid video')?.getAttribute('src')).toBe('https://media.test/demo.mp4');
  });

  it('失败时移除占位、不写正文并提示错误', async () => {
    vi.mocked(device.importMedia).mockResolvedValue({
      url: 'blob:image-local',
      kind: 'image',
      fileName: 'photo.jpg',
      bytes: 4096,
    });
    const container = await mountRichEditor();
    container.querySelector<HTMLButtonElement>('button[title="插入图片"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.media-tile-pending')).not.toBeNull());
    upload!.onProgress!(40);
    await nextTick();

    upload!.result.reject(new Error('上传失败'));
    await vi.waitFor(() => expect(document.querySelector('.media-tile-pending')).toBeNull());
    expect(mask()).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '').toBe('');
    expect(vi.mocked(toast)).toHaveBeenCalledWith('上传失败', 'error');
  });

  it('取消选择时不留下占位或遮罩，也不提示错误', async () => {
    vi.mocked(device.importMedia).mockRejectedValue({ code: 'cancelled' });
    const container = await mountRichEditor();
    container.querySelector<HTMLButtonElement>('button[title="插入图片"]')!.click();
    await flush();
    expect(document.querySelector('.media-tile-pending')).toBeNull();
    expect(mask()).toBeNull();
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });
});
