/**
 * 用户协议浏览页：关闭 / 未设置的空态、开启后渲染 Markdown、加载失败原位重试。
 *
 * 页面只依赖公开接口 `api.agreement.get()`，这里把它换成可控的 mock；
 * 渲染链路（marked + DOMPurify）用真实实现，验证 `.rich-content` 真的画出来了。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/app/runtime', () => ({
  api: { agreement: { get: mocks.get } },
  bootApp: vi.fn(async () => undefined),
  refreshRuntimeBootstrap: vi.fn(async () => undefined),
}));

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountPage(): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const page = (await import('./AgreementPage.vue')).default;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/agreement', component: page },
      { path: '/home', component: { template: '<div />' } },
    ],
  });
  await router.push('/agreement');
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(page).use(pinia).use(router);
  app.mount(container);
  await flush();
  return container;
}

const AGREEMENT = {
  enabled: true,
  version: 2,
  content: '# 使用条款\n\n请遵守社区规范。',
  updatedAt: '2026-11-17T08:00:00.000Z',
};

describe('用户协议浏览页', () => {
  it('协议关闭时显示未开启空态', async () => {
    mocks.get.mockResolvedValue({ enabled: false, version: 0, content: '', updatedAt: '' });
    const container = await mountPage();
    await vi.waitFor(() => expect(container.textContent).toContain('用户协议暂未开启'));
    expect(container.querySelector('.rich-content')).toBeNull();
  });

  it('开启但正文为空时显示未设置空态', async () => {
    mocks.get.mockResolvedValue({ enabled: true, version: 1, content: '   ', updatedAt: '' });
    const container = await mountPage();
    await vi.waitFor(() => expect(container.textContent).toContain('用户协议暂未设置'));
    expect(container.querySelector('.rich-content')).toBeNull();
  });

  it('开启后渲染 Markdown 正文，并在顶部显示版本与更新时间', async () => {
    mocks.get.mockResolvedValue(AGREEMENT);
    const container = await mountPage();
    await vi.waitFor(() => expect(container.querySelector('.rich-content h1')?.textContent).toBe('使用条款'));
    expect(container.querySelector('.rich-content')?.textContent).toContain('请遵守社区规范。');
    expect(container.querySelector('.agreement-meta')?.textContent).toContain('第 2 版');
    expect(container.querySelector('.agreement-meta')?.textContent).toContain('2026年11月17日');
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('加载失败显示错误，重试后渲染正文', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(AGREEMENT);
    const container = await mountPage();
    await vi.waitFor(() => expect(container.textContent).toContain('用户协议加载失败'));
    expect(container.querySelector('.rich-content')).toBeNull();
    const retry = [...container.querySelectorAll<HTMLButtonElement>('.state button')].find(
      (button) => button.textContent?.trim() === '重试',
    );
    expect(retry).not.toBeUndefined();
    retry!.click();
    await vi.waitFor(() => expect(container.querySelector('.rich-content h1')?.textContent).toBe('使用条款'));
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
