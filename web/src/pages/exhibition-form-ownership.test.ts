/**
 * 编辑展会页：直接打开别人的展会地址时不能进入编辑表单。
 *
 * 展会详情是公开的，但编辑必须受归属限制；前端在加载到别人的展会时退回展商后台，
 * 服务端仍会在保存时再判一次（`permission.exhibitionNotYours`）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { clearExhibitionDraft } from '@/services/exhibition-draft';

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
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountOtherExhibition(): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
  vi.mocked(api.exhibitions.get).mockResolvedValue({
    found: true,
    exhibition: { id: 'exh-other', title: '别人的展会', exhibitorId: 'exhibitor-2' },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/exhibitor', component: blank },
    ],
  });
  await router.push('/exhibition-form/exh-other');
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
  return router;
}

describe('编辑展会归属', () => {
  it('直接打开别人的展会地址会退回展商后台', async () => {
    const router = await mountOtherExhibition();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
  });
});
