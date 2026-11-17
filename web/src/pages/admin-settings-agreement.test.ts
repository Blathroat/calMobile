/**
 * 管理-设置里的「用户协议」：上传 Markdown 后随其它设置一起保存，
 * 保存前校验「开启时正文不能为空」，保存成功后用返回的 settings 回填版本与更新时间。
 *
 * 上传有两条路：应用里走原生 `media.importText`，浏览器里用隐藏的 file input + `File.text()`；
 * 两条路都要能写进待保存表单，所以分别覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
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
vi.mock('@/app/preload', () => ({ preloadAdjacentMonths: vi.fn() }));

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
  agreement: {
    enabled: false,
    version: 2,
    content: '# 旧用户协议\n\n旧内容。',
    updatedAt: '2026-11-17T08:00:00.000Z',
  },
  invites: [],
};

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsGet.mockResolvedValue(SETTINGS);
  mocks.settingsSave.mockResolvedValue({ ok: true, settings: SETTINGS });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  document.getElementById('app-foot')?.remove();
  delete window.CalMobileNative;
});

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountSettings(): Promise<HTMLElement> {
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
  app = createApp({ render: () => h(AdminPage) });
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await flush();
  await vi.waitFor(() => expect(container.querySelector('#settings-agreement-enabled')).not.toBeNull());
  return container;
}

function buttonByText(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );
}

function saveButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.settings-save-fab')!;
}

describe('管理设置 · 用户协议', () => {
  it('显示当前版本，并在开启但没有正文时拒绝保存', async () => {
    const container = await mountSettings();
    expect(container.textContent).toContain('第 2 版');
    // 清掉已有正文，模拟「只打开开关、还没上传」。
    buttonByText(container, '清除内容')!.click();
    await nextTick();
    container.querySelector<HTMLInputElement>('#settings-agreement-enabled')!.click();
    await nextTick();
    saveButton().click();
    await flush();
    expect(mocks.settingsSave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('开启用户协议时，正文不能为空');
  });

  it('应用内上传走原生读文件，保存 payload 带上 agreement 并回填新版本', async () => {
    window.CalMobileNative = {
      invoke(action, _payloadJson, callbackId) {
        expect(action).toBe('media.importText');
        window.CalMobileBridge?.onResult(
          callbackId,
          true,
          { text: '# 新用户协议\n\n请遵守新规范。', fileName: 'terms.md', bytes: 30 },
          null,
          null,
        );
      },
    };
    const container = await mountSettings();
    const upload = buttonByText(container, '重新上传')!;
    expect(upload).not.toBeUndefined();
    upload.click();
    await vi.waitFor(() => expect(container.textContent).toContain('terms.md'));
    expect(container.textContent).toContain('内容预览');

    const savedSettings = {
      ...SETTINGS,
      agreement: {
        enabled: true,
        version: 3,
        content: '# 新用户协议\n\n请遵守新规范。',
        updatedAt: '2026-12-01T08:00:00.000Z',
      },
    };
    mocks.settingsSave.mockResolvedValue({ ok: true, settings: savedSettings });
    container.querySelector<HTMLInputElement>('#settings-agreement-enabled')!.click();
    await nextTick();
    saveButton().click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(1));
    const payload = mocks.settingsSave.mock.calls[0]![0] as { agreement?: unknown };
    expect(payload.agreement).toEqual({ enabled: true, content: '# 新用户协议\n\n请遵守新规范。' });
    await vi.waitFor(() => expect(container.textContent).toContain('第 3 版'));
    expect(container.textContent).toContain('2026年12月1日');
  });

  it('浏览器里用隐藏 file input 读正文', async () => {
    const container = await mountSettings();
    const input = container.querySelector<HTMLInputElement>('#settings-agreement-file')!;
    const file = { name: 'browser-terms.md', size: 32, text: async () => '# 浏览器协议\n\n正文内容。' };
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(container.textContent).toContain('browser-terms.md'));
    expect(container.querySelector('.agreement-preview-text')?.textContent).toContain('# 浏览器协议');
  });
});
