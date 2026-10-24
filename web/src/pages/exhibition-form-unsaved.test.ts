/**
 * 展会编辑页：
 * 1. 「编辑简介」按钮下面不再重复显示简介正文；
 * 2. 有未保存改动时离开先确认，继续编辑 / 放弃更改都要走得通；
 * 3. 去简介编辑器与保存成功后的跳转不算「退出」，不弹确认。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { api } from '@/app/runtime';
import { closeSheet, sheet } from '@/services/sheet';
import { clearExhibitionDraft } from '@/services/exhibition-draft';
import { useBootstrapStore } from '@/stores/bootstrap';

vi.mock('@/app/runtime', () => ({
  api: { exhibitions: { get: vi.fn(), save: vi.fn(), remove: vi.fn() } },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const DETAIL = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    venue: '会展中心',
    date: '2026-09-20',
    time: '09:00-17:00',
    statusCode: 'review',
    category: '智能家居',
    description: '按钮下面不应显示的简介正文',
    imageUri: '',
    registrationStart: '2026-08-01',
    registrationEnd: '2026-09-10',
    qrEnabled: false,
    allowCancel: true,
  },
  fields: [],
};

let app: App | undefined;

beforeEach(async () => {
  closeSheet();
  await new Promise((resolve) => setTimeout(resolve, 260));
  document.body.innerHTML = '<div id="app-foot"></div><div id="form-test"></div>';
  clearExhibitionDraft();
  vi.clearAllMocks();
  vi.mocked(api.exhibitions.get).mockResolvedValue(DETAIL);
  vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true, exhibition: DETAIL.exhibition });
  vi.mocked(api.exhibitions.remove).mockResolvedValue({ ok: true });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  clearExhibitionDraft();
});

async function mountForm() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().apply({ categories: ['智能家居'] });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibitor', component: { template: '<div>展商后台</div>' } },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/rich-editor', component: { template: '<div />' } },
    ],
  });
  await router.push('/exhibitor');
  await router.push('/exhibition-form/exh-1');
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#form-title')?.value).toBe('秋季展会'));
  return router;
}

function setValue(selector: string, value: string): void {
  const node = document.querySelector<HTMLInputElement>(selector);
  if (!node) throw new Error(`缺少 ${selector}`);
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('展会编辑页', () => {
  it('简介正文只留在简介编辑器，不再显示在按钮下面', async () => {
    await mountForm();
    expect(document.body.textContent).not.toContain('按钮下面不应显示的简介正文');
  });

  it('没有改动时返回不弹确认', async () => {
    const router = await mountForm();
    router.back();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
    expect(sheet.current).toBeNull();
  });

  it('有未保存改动时返回先确认：继续编辑留在表单，放弃才离开', async () => {
    const router = await mountForm();
    setValue('#form-title', '改过的展会');
    await nextTick();

    router.back();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('有未保存的更改'));
    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    sheet.current!.actions[0]!.onClick!(closeSheet);
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    expect(document.querySelector<HTMLInputElement>('#form-title')?.value).toBe('改过的展会');

    router.back();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('有未保存的更改'));
    sheet.current!.actions[1]!.onClick!(closeSheet);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
  });

  it('从编辑展会进简介编辑器不弹确认，返回后未保存改动仍在', async () => {
    const router = await mountForm();
    setValue('#form-title', '改过的展会');
    await nextTick();
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '编辑简介',
    );
    if (!button) throw new Error('缺少编辑简介按钮');
    button.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    expect(sheet.current).toBeNull();

    router.back();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1'));
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#form-title')?.value).toBe('改过的展会'));

    // 回到表单后仍未保存：真正退出这一页时才提示。
    router.back();
    await vi.waitFor(() => expect(sheet.current?.title).toBe('有未保存的更改'));
  });

  it('保存成功后的跳转不弹确认', async () => {
    const router = await mountForm();
    setValue('#form-title', '改过的展会');
    await nextTick();
    const save = document.querySelector<HTMLButtonElement>('#app-foot button');
    if (!save) throw new Error('缺少保存按钮');
    save.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
    expect(sheet.current).toBeNull();
  });
});
