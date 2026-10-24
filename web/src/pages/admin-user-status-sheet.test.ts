/**
 * 管理-用户：卡片上不再摆「关闭两步验证」；这颗兜底按钮收进「调整状态」抽屉，
 * 并且只在账号确实开着两步验证时出现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import AdminPage from './AdminPage.vue';
import { api } from '@/app/runtime';
import { closeSheet, sheet } from '@/services/sheet';
import type { User } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn(), setStatus: vi.fn(), disableTwoFactor: vi.fn() },
    exhibitions: { list: vi.fn() },
    settings: { get: vi.fn() },
  },
  applyRuntimeBootstrap: vi.fn(),
}));
vi.mock('@/services/device-services', () => ({ device: {} }));

const ENABLED: User = {
  id: 'u1',
  nickname: '开了两步验证',
  statusCode: 'active',
  roleCode: 'user',
  twoFactorEnabled: true,
};
const PLAIN: User = {
  id: 'u2',
  nickname: '没开两步验证',
  statusCode: 'active',
  roleCode: 'user',
  twoFactorEnabled: false,
};

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.users.list).mockResolvedValue([ENABLED, PLAIN]);
  vi.mocked(api.exhibitions.list).mockResolvedValue([]);
  vi.mocked(api.settings.get).mockResolvedValue({});
  document.body.innerHTML = '<div id="admin-test"></div>';
});

afterEach(async () => {
  app?.unmount();
  app = undefined;
  closeSheet();
  await new Promise((resolve) => setTimeout(resolve, 260));
  document.body.innerHTML = '';
});

function card(name: string): HTMLElement {
  const node = [...document.querySelectorAll<HTMLElement>('.card')].find((item) => item.textContent?.includes(name));
  expect(node).not.toBeUndefined();
  return node!;
}

function buttonLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button')].map((item) => item.textContent?.trim() ?? '');
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const node = [...root.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
  expect(node).not.toBeUndefined();
  return node!;
}

async function openStatusSheet(name: string): Promise<void> {
  button(card(name), '调整状态').click();
  await vi.waitFor(() => expect(sheet.current).not.toBeNull());
}

async function mountAdmin(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin', component: AdminPage }],
  });
  await router.push('/admin?tab=users');
  app = createApp(AdminPage).use(pinia).use(router);
  app.mount('#admin-test');
  await vi.waitFor(() => expect(document.body.textContent).toContain('开了两步验证'));
}

describe('管理-用户的状态抽屉', () => {
  it('卡片上没有「关闭两步验证」按钮', async () => {
    await mountAdmin();
    expect(buttonLabels(card('开了两步验证'))).not.toContain('关闭两步验证');
  });

  it('账号开着两步验证时，抽屉里有关闭按钮', async () => {
    await mountAdmin();
    await openStatusSheet('开了两步验证');
    expect(sheet.current!.actions.map((item) => item.label)).toContain('关闭两步验证');
  });

  it('账号没开两步验证时，抽屉里不出现关闭按钮', async () => {
    await mountAdmin();
    await openStatusSheet('没开两步验证');
    expect(sheet.current!.actions.map((item) => item.label)).not.toContain('关闭两步验证');
  });
});
