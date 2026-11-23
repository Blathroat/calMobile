/**
 * 编辑展会页底部的「展会归属」卡（仅管理员）。
 *
 * 锁四件事：管理员看得到当前归属并改得动；提交前校验邮箱形状；提交成功后当前归属就地刷新
 * （不重载整张表单）；服务端的规则失败在原位显示、展商看不到这张卡。
 *
 * 面板与提示都 mock 掉，只锁页面逻辑；面板渲染由 components/app-sheet.test.ts 管。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import { api } from '@/app/runtime';
import { confirmSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
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
      id: 'exh-owner',
      title: '秋季展会',
      date: '2026-11-17',
      venue: '会展中心',
      category: '智能家居',
      exhibitorId: 'exhibitor-2',
      exhibitor: '老展商',
    },
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

/** 按角色挂载编辑页；返回路由，便于断言权限退回。 */
async function mountForm(can: Record<string, boolean>, role = 'admin', id = 'exhibitor-1'): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id, role, can });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/exhibitor', component: blank },
      { path: '/rich-editor', component: blank },
    ],
  });
  await router.push('/exhibition-form/exh-owner');
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
  return router;
}

/** 在归属卡的输入框里填邮箱并点「改为该用户」。 */
async function submitOwnerEmail(email: string): Promise<void> {
  const input = await vi.waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('#form-owner-email');
    expect(found).not.toBeNull();
    return found!;
  });
  input.value = email;
  input.dispatchEvent(new Event('input'));
  await nextTick();
  const button = [...document.querySelectorAll<HTMLButtonElement>('.owner-card button')].find((item) =>
    item.textContent?.includes('改为该用户'),
  );
  expect(button).toBeDefined();
  button!.click();
  await flush();
}

describe('编辑展会页的展会归属卡', () => {
  it('管理员能看到当前归属，并按邮箱把展会交给另一个账号', async () => {
    await mountForm({ admin: true, exhibitor: true });
    await vi.waitFor(() => expect(document.querySelector('#form-owner-email')).not.toBeNull());
    expect(document.querySelector('.owner-card')?.textContent).toContain('当前归属：老展商');

    vi.mocked(api.exhibitions.setOwner).mockResolvedValue({
      ok: true,
      exhibition: { exhibitor: '新展商' },
    });
    await submitOwnerEmail(' new@example.com ');

    await vi.waitFor(() => expect(confirmSheet).toHaveBeenCalledOnce());
    const options = vi.mocked(confirmSheet).mock.calls[0]![0];
    expect(options.message).toContain('new@example.com');
    await options.onConfirm?.();
    await flush();

    expect(api.exhibitions.setOwner).toHaveBeenCalledWith('exh-owner', 'new@example.com');
    expect(document.querySelector('.owner-card')?.textContent).toContain('当前归属：新展商');
    expect(toast).toHaveBeenCalledWith('展会归属已更改', 'success');
  });

  it('邮箱形状不对时只原位报错，不发请求也不弹确认', async () => {
    await mountForm({ admin: true, exhibitor: true });
    await submitOwnerEmail('not-an-email');

    expect(confirmSheet).not.toHaveBeenCalled();
    expect(api.exhibitions.setOwner).not.toHaveBeenCalled();
    expect(document.querySelector('.owner-card .field-error')?.textContent).toContain('邮箱格式不正确');
  });

  it('服务端的规则失败留在输入框下面', async () => {
    await mountForm({ admin: true, exhibitor: true });
    vi.mocked(api.exhibitions.setOwner).mockRejectedValue(new Error('没有找到该邮箱对应的账号'));
    await submitOwnerEmail('nobody@example.com');

    await vi.waitFor(() => expect(confirmSheet).toHaveBeenCalledOnce());
    await vi.mocked(confirmSheet).mock.calls[0]![0].onConfirm?.();
    await flush();

    expect(document.querySelector('.owner-card .field-error')?.textContent).toContain('没有找到该邮箱对应的账号');
    expect(toast).toHaveBeenCalledWith('没有找到该邮箱对应的账号', 'error');
  });

  it('展商自己编辑时看不到这张卡', async () => {
    await mountForm({ admin: false, exhibitor: true }, 'exhibitor', 'exhibitor-2');
    await vi.waitFor(() => expect(document.querySelector('#form-title')).not.toBeNull());
    expect(document.querySelector('.owner-card')).toBeNull();
  });
});
