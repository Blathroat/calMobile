/**
 * 编辑展会页：简介入口与未保存草稿（需求 6「编辑简介移进展会封面卡」不能破坏草稿逻辑）。
 *
 * 新建展会还没有 id 时点「编辑简介」要把当前表单存进 `exhibition-draft` 再去简介编辑器；
 * 离开新建页（去简介编辑器除外）时清掉草稿。这里把页面挂到内存路由上验证这两条。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { clearExhibitionDraft, readExhibitionDraft } from '@/services/exhibition-draft';

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

async function mountForm(): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
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
  return router;
}

function editDescriptionButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#form-test button')].find(
    (item) => item.textContent?.trim() === '编辑简介',
  );
  if (!button) throw new Error('封面卡里缺少「编辑简介」入口');
  return button;
}

describe('编辑展会：简介入口与草稿', () => {
  it('新建时点「编辑简介」先把当前表单存成草稿，再进简介编辑器', async () => {
    const router = await mountForm();
    const input = document.querySelector<HTMLInputElement>('#form-title');
    if (!input) throw new Error('缺少展会名称输入框');
    input.value = '草稿展会';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    expect(router.currentRoute.value.query.draft).toBe('1');
    expect(readExhibitionDraft()?.title).toBe('草稿展会');
    expect(readExhibitionDraft()?.endDate).toBe('');
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
});
