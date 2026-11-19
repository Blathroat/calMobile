/**
 * 编辑展会页：简介入口与未保存草稿。
 *
 * 新建与编辑都要先把当前表单存进 `exhibition-draft` 再进 Markdown 编辑器：
 * 新建带 `?draft=1`（二级页从草稿起稿，回来填回整张表单），
 * 编辑带 `?id=...&draft=1`（二级页用草稿正文起稿，纯文本框里刚写的内容不会丢）。
 * 离开表单页（去简介编辑器除外）时清掉草稿，避免陈旧稿串到下一次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { clearExhibitionDraft, readExhibitionDraft, stashExhibitionDraft } from '@/services/exhibition-draft';
import { useSessionStore } from '@/stores/session';
import { api } from '@/app/runtime';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { save: vi.fn(), remove: vi.fn(), get: vi.fn() },
    media: { upload: vi.fn() },
  },
}));
vi.mock('@/services/device-services', () => ({
  device: { importMedia: vi.fn(), discardMedia: vi.fn() },
}));

const blank = defineComponent({ render: () => h('div') });

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  clearExhibitionDraft();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="form-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

/** 挂载表单页；`prepare` 在 pinia 就绪后、路由进入前执行，用来摆会话与接口桩。 */
async function mountForm(path = '/exhibition-form', prepare?: () => void): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  prepare?.();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form', component: ExhibitionFormPage },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/rich-editor', component: blank },
      { path: '/exhibitor', component: blank },
    ],
  });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
  return router;
}

function editDescriptionButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#form-test button')].find(
    (item) => item.textContent?.trim() === '使用Markdown编辑简介',
  );
  if (!button) throw new Error('活动信息卡里缺少「使用Markdown编辑简介」入口');
  return button;
}

/** 往输入框（含 textarea）填值并触发 input 事件，模拟用户打字。 */
function fill(id: string, value: string): void {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!input) throw new Error(`缺少输入框 #${id}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 编辑已有展会：当前会话是展商本人，详情接口返回同一场展会。 */
function prepareEditExhibition(): void {
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
  vi.mocked(api.exhibitions.get).mockResolvedValue({
    found: true,
    exhibition: {
      id: 'exh-1',
      title: '秋季展会',
      exhibitorId: 'exhibitor-1',
      description: '服务端简介',
    },
  });
}

describe('编辑展会：简介入口与草稿', () => {
  it('新建时点「使用Markdown编辑简介」先把当前表单（含纯文本简介）存成草稿，再进简介编辑器', async () => {
    const router = await mountForm();
    fill('form-title', '草稿展会');
    fill('form-description', '简介先写在纯文本框里');
    await flush();

    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    expect(router.currentRoute.value.query.draft).toBe('1');
    expect(router.currentRoute.value.query.id).toBeUndefined();
    const draft = readExhibitionDraft();
    expect(draft?.title).toBe('草稿展会');
    expect(draft?.description).toBe('简介先写在纯文本框里');
    expect(draft?.endDate).toBe('');
    expect(draft?.id).toBe('');
  });

  it('编辑已有展会时也先存草稿：草稿带展会 id 与纯文本框里的当前正文', async () => {
    const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('#form-description')?.value).toBe('服务端简介'),
    );
    fill('form-description', '文本框里刚写、还没保存的简介');

    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    expect(router.currentRoute.value.query.id).toBe('exh-1');
    expect(router.currentRoute.value.query.draft).toBe('1');
    expect(readExhibitionDraft()?.id).toBe('exh-1');
    expect(readExhibitionDraft()?.description).toBe('文本框里刚写、还没保存的简介');
  });

  it('离开新建页会清掉草稿；从简介编辑器返回时保留', async () => {
    const router = await mountForm();
    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    expect(readExhibitionDraft()).not.toBeNull();

    // 回到表单（模拟从编辑器返回）不触发清理。
    await router.push('/exhibition-form');
    await flush();
    expect(readExhibitionDraft()).not.toBeNull();

    // 真正离开新建页才清掉。
    await router.push('/exhibitor');
    await flush();
    expect(readExhibitionDraft()).toBeNull();
  });

  it('编辑页离开表单（不是去简介编辑器）同样清掉草稿', async () => {
    const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition);
    stashExhibitionDraft({
      id: 'exh-1',
      title: '秋季展会',
      venue: '',
      date: '',
      time: '',
      status: 'review',
      category: '',
      description: '还没保存的简介',
      imageUri: '',
      registrationStart: '',
      registrationEnd: '',
      qrEnabled: false,
      allowCancel: true,
      fields: [],
    });

    await router.push('/exhibitor');
    await flush();
    expect(readExhibitionDraft()).toBeNull();
  });
});
