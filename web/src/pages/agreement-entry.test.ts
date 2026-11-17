/**
 * 用户设置页底部的「查看用户协议」入口：只在管理员开启协议时出现在页面最底部，
 * 点击进 `/agreement`；关闭时整组不渲染。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import UserSettingsPage from './UserSettingsPage.vue';

vi.mock('@/app/runtime', () => ({
  api: {
    profile: {
      get: vi.fn(async () => ({ id: 'u1', username: 'user' })),
      notifications: vi.fn(async () => ({ granted: false })),
    },
  },
  bootApp: vi.fn(async () => undefined),
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

async function mountSettings(agreementEnabled: boolean): Promise<{ container: HTMLElement; router: Router }> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'u1', username: 'user', loggedIn: true, guest: false });
  useBootstrapStore().apply({
    agreement: { enabled: agreementEnabled, version: 2, updatedAt: '2026-11-17T08:00:00.000Z' },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings', component: UserSettingsPage },
      { path: '/agreement', component: { template: '<div />' } },
    ],
  });
  await router.push('/settings');
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(UserSettingsPage);
  app.use(pinia);
  app.use(router);
  app.mount(container);
  await vi.waitFor(() => expect(container.textContent).toContain('账号'));
  return { container, router };
}

describe('用户设置 · 用户协议入口', () => {
  it('开启时在最底部给出入口并进入协议页', async () => {
    const { container, router } = await mountSettings(true);
    const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '查看用户协议',
    );
    expect(entry).not.toBeUndefined();
    expect(entry?.textContent?.trim()).toBe('查看用户协议');
    entry!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/agreement'));
  });

  it('关闭时不渲染入口', async () => {
    const { container } = await mountSettings(false);
    expect(container.textContent).not.toContain('查看用户协议');
  });
});
