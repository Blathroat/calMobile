/**
 * 从首页进入展会详情：首页的 pointerdown / 首屏会预热详情，命中缓存时页面会先画旧值。
 * 简介依赖按需加载的 markdown 解析器与清洗器，缓存先画时它们可能还没就绪 ——
 * 首屏因此必须在解析器备好之后再渲染简介，否则第一次进入会整页白屏、重进才好。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import DetailPage from './DetailPage.vue';
import { api } from '@/app/runtime';
import type { CachedRead } from '@/services/query-cache';
import type { ExhibitionDetail } from '@/api/types';

const markdown = vi.hoisted(() => ({
  ready: false,
  wait: null as null | (() => Promise<void>),
  rendered: 0,
}));

vi.mock('@/services/markdown', () => ({
  loadMarkdownParser: vi.fn(async () => {
    if (markdown.wait) await markdown.wait();
    markdown.ready = true;
  }),
  markdownReady: vi.fn(() => markdown.ready),
  markdownToHtml: vi.fn((source: string) => {
    markdown.rendered += 1;
    if (!markdown.ready) throw new Error('markdown parser not ready');
    return `<p>${source}</p>`;
  }),
  sanitizeHtml: vi.fn((html: unknown) => String(html ?? '')),
  plainText: vi.fn((value: unknown) => String(value ?? '')),
}));

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { get: vi.fn() },
    registrations: { list: vi.fn(async () => []) },
  },
}));
vi.mock('@/services/device-services', () => ({
  device: {
    calendarStatus: vi.fn(async () => ({ inCalendar: false, granted: false })),
    toggleCalendar: vi.fn(),
    shareText: vi.fn(),
  },
}));

const DETAIL: ExhibitionDetail = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    date: '2026-09-20',
    time: '09:00-17:00',
    venue: '会展中心',
    exhibitor: '示例展商',
    description: '简介正文',
    descriptionFormat: 'md',
    openForRegistration: true,
  },
};

let app: App | undefined;

beforeEach(() => {
  markdown.ready = false;
  markdown.wait = null;
  markdown.rendered = 0;
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="detail-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

function cachedDetail(): CachedRead<ExhibitionDetail> {
  const promise = Promise.resolve(DETAIL) as CachedRead<ExhibitionDetail>;
  promise.cached = DETAIL;
  promise.revalidating = false;
  return promise;
}

async function mountPage(): Promise<HTMLElement> {
  vi.mocked(api.exhibitions.get).mockReturnValue(cachedDetail());
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/detail/:id', component: DetailPage }],
  });
  await router.push('/detail/exh-1');
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(DetailPage).use(pinia).use(router);
  app.mount(container);
  return container;
}

describe('展会详情命中缓存时的简介', () => {
  it('解析器未就绪前先画骨架，不调用 markdown 渲染，也不白屏', async () => {
    let release!: () => void;
    markdown.wait = () => new Promise<void>((resolve) => (release = resolve));
    const container = await mountPage();
    await vi.waitFor(() => expect(container.querySelector('.skeleton')).not.toBeNull());
    expect(markdown.rendered).toBe(0);

    markdown.ready = true;
    release();
    await vi.waitFor(() => expect(container.textContent).toContain('简介正文'));
  });
});
