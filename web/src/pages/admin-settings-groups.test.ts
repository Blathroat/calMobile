/**
 * 管理设置的分组导航与首次配置路线。
 *
 * 设置页卡片按任务收成六组：换组只切换显示，已填但还没保存的内容、
 * 以及右下角同一颗保存按钮都保持不变（分组用 v-show，不重建 DOM）。
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
  markHint: vi.fn(async () => ({ ok: true })),
  applyBootstrap: vi.fn(),
}));

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn(async () => []) },
    exhibitions: { list: vi.fn(async () => []), month: vi.fn(), get: vi.fn(async () => ({})) },
    settings: { get: mocks.settingsGet, save: mocks.settingsSave },
    profile: { markHint: mocks.markHint },
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
  registration: { nameFieldTitles: ['姓名'] },
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
    seenHints: [],
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

/** 按组标题找卡片：卡片都在 DOM 里，不在当前组的由 v-show 置为 display:none。 */
function cardByLabel(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.card')].find(
    (card) => card.querySelector('.section-label')?.textContent?.trim() === label,
  );
}

function groupTab(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.settings-group-nav button')].find(
    (item) => item.textContent?.trim().replace(/^\d+/, '') === label,
  );
  if (!button) throw new Error('缺少分组按钮：' + label);
  return button;
}

/** 组间「返回 / 继续」两颗按钮的文案。 */
function switchLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.settings-group-switch button')].map(
    (item) => item.textContent?.trim() ?? '',
  );
}

function visibleCardLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.card')]
    .filter((card) => card.style.display !== 'none')
    .map((card) => card.querySelector('.section-label')?.textContent?.trim() ?? '')
    .filter(Boolean);
}

describe('管理设置 · 分组导航', () => {
  it('按任务分成六组，默认先显示服务器与日志', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-title-zh')).not.toBeNull());
    const labels = [...document.querySelectorAll('.settings-group-nav .settings-group-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual([
      '服务器与日志',
      '品牌与外观',
      '展会与报名规则',
      '账号与邀请码',
      '媒体与字段限制',
      '应用下载',
    ]);
    expect(groupTab('服务器与日志').getAttribute('aria-pressed')).toBe('true');
    // 每组前面有配置顺序号，换组时 aria-pressed 跟着走。
    expect([...document.querySelectorAll('.settings-group-index')].map((node) => node.textContent?.trim())).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(visibleCardLabels()).toEqual(expect.arrayContaining(['后端存储', '日志']));
    expect(cardByLabel('软件标题')?.style.display).toBe('none');
    expect(cardByLabel('报名相关')?.style.display).toBe('none');
    expect(cardByLabel('邀请码')?.style.display).toBe('none');

    // 每一组包含哪些卡固定下来：加卡时忘了指组会被这条测试挡住。
    const expected: Record<string, string[]> = {
      服务器与日志: ['后端存储', '日志'],
      品牌与外观: ['软件标题', '应用外观', '缺省展会封面', '进入应用时的公告'],
      展会与报名规则: ['展商相关', '展会分类管理', '审核策略', '报名相关'],
      账号与邀请码: ['用户协议', '邀请码'],
      媒体与字段限制: ['富文本媒体限制', '上传格式限制', '头像', '表单字符数上限'],
      应用下载: ['软件包下载'],
    };
    for (const [label, cards] of Object.entries(expected)) {
      groupTab(label).click();
      await nextTick();
      expect({ group: label, cards: visibleCardLabels().sort() }).toEqual({ group: label, cards: [...cards].sort() });
    }
  });

  it('切换分组只换显示，已填但未保存的内容留在原处', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-title-zh')).not.toBeNull());
    // 先在「品牌与外观」改标题，不保存。
    groupTab('品牌与外观').click();
    await nextTick();
    expect(visibleCardLabels()).toContain('软件标题');
    expect(cardByLabel('后端存储')?.style.display).toBe('none');
    const title = container.querySelector<HTMLInputElement>('#settings-title-zh')!;
    title.value = '新展会标题';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    groupTab('媒体与字段限制').click();
    await nextTick();
    expect(visibleCardLabels()).toContain('富文本媒体限制');
    expect(cardByLabel('软件标题')?.style.display).toBe('none');
    // 已填的值还在：换组不清表单。
    expect(container.querySelector<HTMLInputElement>('#settings-title-zh')!.value).toBe('新展会标题');

    groupTab('品牌与外观').click();
    await nextTick();
    expect(container.querySelector<HTMLInputElement>('#settings-title-zh')!.value).toBe('新展会标题');
  });

  it('组底部的「继续 / 返回」按配置路线走，保存仍用同一颗悬浮按钮', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('#settings-title-zh')).not.toBeNull());
    const next = [...document.querySelectorAll<HTMLButtonElement>('.settings-group-switch button')].find((item) =>
      item.textContent?.includes('继续'),
    )!;
    expect(next.textContent).toContain('品牌与外观');
    next.click();
    await nextTick();
    expect(groupTab('品牌与外观').getAttribute('aria-pressed')).toBe('true');

    // 跳到最后两组，改一项后直接用右下角保存：分组不影响提交的字段。
    groupTab('账号与邀请码').click();
    await nextTick();
    const uses = container.querySelector<HTMLInputElement>('#settings-invite-uses')!;
    expect(uses).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.settings-save-fab')!.click();
    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(1));

    const previous = [...document.querySelectorAll<HTMLButtonElement>('.settings-group-switch button')].find((item) =>
      item.textContent?.includes('返回'),
    )!;
    expect(previous.textContent).toContain('展会与报名规则');
    previous.click();
    await nextTick();
    expect(groupTab('展会与报名规则').getAttribute('aria-pressed')).toBe('true');
    // 组间按钮的边界：第一组没有「返回」，最后一组没有「继续」。
    groupTab('服务器与日志').click();
    await nextTick();
    expect(switchLabels()).toEqual(['继续 · 品牌与外观']);
    groupTab('应用下载').click();
    await nextTick();
    expect(switchLabels()).toEqual(['返回 · 媒体与字段限制']);
  });

  it('首次进入显示配置路线提示，关掉后记到账号上', async () => {
    const container = await mountAdmin();
    await vi.waitFor(() => expect(container.querySelector('.hint-note')).not.toBeNull());
    expect(container.querySelector('.hint-note')?.textContent).toContain('配置路线');
    const dismiss = [...document.querySelectorAll<HTMLButtonElement>('.hint-note button')].find(
      (item) => item.textContent?.trim() === '知道了',
    )!;
    dismiss.click();
    await vi.waitFor(() => expect(mocks.markHint).toHaveBeenCalledWith('admin-settings-route'));
    await vi.waitFor(() => expect(container.querySelector('.hint-note')).toBeNull());
    expect(useSessionStore().user.seenHints).toContain('admin-settings-route');
  });
});
