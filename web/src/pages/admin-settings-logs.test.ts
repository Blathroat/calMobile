/**
 * 管理后台的日志入口与管理-设置里的日志上限卡片。
 *
 * 表单状态、保存与回填都在 AdminPage，卡片只负责展示，所以这里挂真实的 AdminPage：
 * - 入口按钮点击后跳到 /logs；
 * - 设置接口的 `logs` 段回填上限与用量；
 * - 保存 payload 带 `logs: { storageMb }`，非数字/越界值在本地先收敛；
 * - 保存成功后按服务端返回的设置回填上限与新用量；没有用量时卡片显示「—」。
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

async function mountAdmin(path: string): Promise<HTMLElement> {
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
  await router.push(path);
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp({ render: () => h(AdminPage) });
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await flush();
  return container;
}

/** 卡片里的次操作常用 `.cta ghost` + `data-size="small"`；日志入口要的是默认大按钮。 */
function miniGhost(button: HTMLButtonElement | undefined): boolean {
  return button?.classList.contains('ghost') === true || button?.hasAttribute('data-size') === true;
}

function buttonByText(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );
}

function saveButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.settings-save-fab')!;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('管理后台 · 最近日志入口', () => {
  it('日志卡片里的整行主按钮跳到日志页', async () => {
    const container = await mountAdmin('/admin?tab=settings');
    await vi.waitFor(() => expect(container.querySelector('#settings-logs-mb')).not.toBeNull());
    const entry = buttonByText(container, '查看最近日志');
    expect(entry).not.toBeUndefined();
    // 入口在日志卡片内部：和其它卡片里的整行主操作一样，不是贴在卡片外面的小按钮。
    const logsCard = container.querySelector<HTMLElement>('#settings-logs-mb')!.closest('.card');
    expect(logsCard?.contains(entry!)).toBe(true);
    // 版式与其它卡片里的主操作一致：整行大按钮（默认 .cta），不是小的 ghost 按钮。
    expect(entry?.classList.contains('cta')).toBe(true);
    expect(entry?.classList.contains('ghost')).toBe(false);
    expect(entry?.hasAttribute('data-size')).toBe(false);
    expect(miniGhost(entry)).toBe(false);
    entry?.click();
    await vi.waitFor(() => expect(router?.currentRoute.value.path).toBe('/logs'));
  });
});

describe('管理设置 · 日志上限', () => {
  it('回填上限与当前用量，保存 payload 带上 logs', async () => {
    const container = await mountAdmin('/admin?tab=settings');
    await vi.waitFor(() => expect(container.querySelector('#settings-logs-mb')).not.toBeNull());

    const input = container.querySelector<HTMLInputElement>('#settings-logs-mb')!;
    expect(input.value).toBe('256');
    const card = input.closest('.card') as HTMLElement;
    expect(card.textContent).toContain('已存 42 条');
    expect(card.textContent).toContain('已用 128.0 MB / 上限 256.0 MB');
    expect(card.querySelector('.storage-meter')).not.toBeNull();
    expect(card.textContent).toContain('超过上限会自动清理最早的日志');

    mocks.settingsSave.mockResolvedValue({
      ok: true,
      settings: { ...SETTINGS, logs: { storageMb: 512, usedBytes: 8 * MB, entryCount: 30 } },
    });
    saveButton().click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(1));
    expect((mocks.settingsSave.mock.calls[0]![0] as { logs?: unknown }).logs).toEqual({ storageMb: 256 });
    await vi.waitFor(() => expect(input.value).toBe('512'));
    expect(card.textContent).toContain('已存 30 条');
    expect(card.textContent).toContain('已用 8.0 MB / 上限 512.0 MB');
  });

  it('越界输入按 1～10240 收敛后再提交', async () => {
    const container = await mountAdmin('/admin?tab=settings');
    await vi.waitFor(() => expect(container.querySelector('#settings-logs-mb')).not.toBeNull());
    const input = container.querySelector<HTMLInputElement>('#settings-logs-mb')!;

    setInput(input, '-5');
    await nextTick();
    saveButton().click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(1));
    expect((mocks.settingsSave.mock.calls[0]![0] as { logs?: unknown }).logs).toEqual({ storageMb: 1 });

    setInput(input, '99999');
    await nextTick();
    saveButton().click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(2));
    expect((mocks.settingsSave.mock.calls[1]![0] as { logs?: unknown }).logs).toEqual({ storageMb: 10240 });
  });

  it('没有用量数据时只显示「—」，不画进度条', async () => {
    mocks.settingsGet.mockResolvedValue({ ...SETTINGS, logs: { storageMb: 64 } });
    const container = await mountAdmin('/admin?tab=settings');
    await vi.waitFor(() => expect(container.querySelector('#settings-logs-mb')).not.toBeNull());

    const card = container.querySelector<HTMLElement>('#settings-logs-mb')!.closest('.card') as HTMLElement;
    expect(card.textContent).toContain('—');
    expect(card.querySelector('.storage-meter')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('#settings-logs-mb')!.value).toBe('64');
  });
});
