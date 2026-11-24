/**
 * 编辑展会页「报名设置 - 报名方式」下面的说明。
 *
 * 只有选「需审核」时才提示要去展商后台对应展会的报名管理里手动审核；
 * 换成「无需审核」或「仅展示」这行不显示。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { api } from '@/app/runtime';
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
vi.mock('@/services/sheet', () => ({ confirmSheet: vi.fn(), openSheet: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const blank = { render: () => null };
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  clearExhibitionDraft();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="form-test"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue({
    found: true,
    exhibition: {
      id: 'exh-mode',
      title: '秋季展会',
      date: '2026-11-17',
      venue: '会展中心',
      category: '智能家居',
      exhibitorId: 'exhibitor-1',
      exhibitor: 'example',
      statusCode: 'review',
    },
  });
  vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true });
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

/** 展商编辑自己的展会（管理员之外的普通角色，说明与权限无关）。 */
async function mountForm(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor', can: { exhibitor: true } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/exhibitor', component: blank },
    ],
  });
  await router.push('/exhibition-form/exh-mode');
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
}

/** 点报名方式分段控件上的某一档。 */
async function pickMode(value: string): Promise<void> {
  const button = await vi.waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>(`.seg button[data-value="${value}"]`);
    expect(found).not.toBeNull();
    return found!;
  });
  button.click();
  await flush();
}

describe('编辑展会页的报名方式说明', () => {
  it('选「需审核」时提示要去报名管理手动审核', async () => {
    await mountForm();
    await pickMode('review');
    expect(document.querySelector('#form-review-mode-hint')?.textContent).toContain('手动审核');
  });

  it('换成「无需审核」与「仅展示」时说明消失', async () => {
    await mountForm();
    await pickMode('optional');
    expect(document.querySelector('#form-review-mode-hint')).toBeNull();

    await pickMode('display');
    expect(document.querySelector('#form-review-mode-hint')).toBeNull();
  });
});
