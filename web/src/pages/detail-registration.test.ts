/**
 * 展会详情的报名入口：已报名本场时底部主按钮变「查看我的报名」，点击进报名详情页；
 * 未报名 / 已撤销 / 列表失败 / 访客都保持原来的「立即报名」，且访客不发 registrations 请求。
 *
 * 挂载方式仿 page-loading.test.ts / rich-editor.test.ts：mock `@/app/runtime`，
 * 用真实 pinia + 内存路由把页面挂到 jsdom 里。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import DetailPage from './DetailPage.vue';
import { api } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useSessionStore } from '@/stores/session';
import { useBootstrapStore } from '@/stores/bootstrap';
import type { ExhibitionDetail } from '@/api/types';
import type { CachedRead } from '@/services/query-cache';

const markdownHarness = vi.hoisted(() => ({
  parserReady: false,
  parserGate: null as Promise<void> | null,
  parserFails: false,
}));

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { get: vi.fn() },
    registrations: { list: vi.fn() },
  },
}));
// 日历状态走原生桥；这里只关心报名按钮，给出一个稳定的「未加入」结果。
vi.mock('@/services/device-services', () => ({
  device: { calendarStatus: vi.fn(async () => ({ inCalendar: false, granted: false })) },
}));
vi.mock('@/services/markdown', () => ({
  loadMarkdownParser: vi.fn(async () => {
    if (markdownHarness.parserGate) await markdownHarness.parserGate;
    if (markdownHarness.parserFails) throw new Error('Markdown parser failed to load');
    markdownHarness.parserReady = true;
  }),
  markdownToHtml: vi.fn((source: string) => {
    if (!markdownHarness.parserReady) throw new Error('Markdown parser is not ready');
    return `<p>${source}</p>`;
  }),
  sanitizeHtml: vi.fn((source: unknown) => {
    if (!markdownHarness.parserReady) throw new Error('HTML purifier is not ready');
    return String(source ?? '');
  }),
  plainText: vi.fn((source: unknown, max = 120) => {
    const template = document.createElement('template');
    template.innerHTML = String(source ?? '');
    const text = (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }),
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
    openForRegistration: true,
  },
};

/** 已关闭报名、且账号被限制的展会：用来验证「已报名」不受这两条限制。 */
const CLOSED_DETAIL: ExhibitionDetail = {
  found: true,
  exhibition: { id: 'exh-1', title: '秋季展会', date: '2026-09-20', openForRegistration: false },
};

/** 报名方式仍是需审核，但报名截止日已过：服务端把 openForRegistration 也置为 false。 */
const ENDED_DETAIL: ExhibitionDetail = {
  found: true,
  exhibition: {
    id: 'exh-1',
    title: '秋季展会',
    date: '2026-09-20',
    statusCode: 'review',
    openForRegistration: false,
    registrationEnded: true,
  },
};

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  markdownHarness.parserReady = false;
  markdownHarness.parserGate = null;
  markdownHarness.parserFails = false;
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="detail-test"></div>';
  vi.mocked(api.exhibitions.get).mockResolvedValue(DETAIL);
  vi.mocked(api.registrations.list).mockResolvedValue([]);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  navigation.cancel();
  document.body.innerHTML = '';
});

/** 让已经 resolve 的 promise 链与重渲染跑完。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

/** 底部主按钮：日历 / 报名两颗里不带 ghost 的那颗。 */
function registerButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].find(
    (button) => button.classList.contains('cta') && !button.classList.contains('ghost'),
  );
}

function footerHint(): string {
  return document.querySelector('#app-foot .field-hint')?.textContent ?? '';
}

async function mountDetail(
  options: {
    loggedIn?: boolean;
    canRegister?: boolean;
    detail?: ExhibitionDetail;
    cached?: boolean;
    defaultCover?: string;
  } = {},
): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  if (options.defaultCover !== undefined) {
    useBootstrapStore().apply({ cover: { defaultCover: options.defaultCover } });
  }
  // 不调用 applyUser 就是访客态（初始 session）。
  if (options.loggedIn) {
    useSessionStore().applyUser({
      id: 'u1',
      username: 'user',
      loggedIn: true,
      can: { register: options.canRegister !== false },
    });
  }
  if (options.detail && options.cached) {
    const response = Promise.resolve(options.detail) as CachedRead<ExhibitionDetail>;
    response.cached = options.detail;
    response.revalidating = true;
    vi.mocked(api.exhibitions.get).mockImplementation(() => response as never);
  } else if (options.detail) {
    vi.mocked(api.exhibitions.get).mockResolvedValue(options.detail);
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/detail/:id', component: DetailPage },
      { path: '/registration-form/:id', component: { template: '<div />' } },
      { path: '/registration-detail/:id', component: { template: '<div />' } },
    ],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/detail/exh-1');
  app = createApp(DetailPage).use(pinia).use(router);
  app.mount('#detail-test');
  await vi.waitFor(() => expect(registerButton()).not.toBeUndefined());
  return router;
}

describe('展会详情冷启动', () => {
  it('缓存详情先显示，富文本解析器就绪后再渲染简介', async () => {
    let releaseParser!: () => void;
    markdownHarness.parserGate = new Promise<void>((resolve) => {
      releaseParser = resolve;
    });
    const detail: ExhibitionDetail = {
      ...DETAIL,
      exhibition: { ...DETAIL.exhibition!, description: '# 展会亮点' },
    };

    await mountDetail({ detail, cached: true });

    expect(document.querySelector('#detail-test h2')?.textContent).toBe('秋季展会');
    expect(document.querySelector('#detail-test .detail-facts')).not.toBeNull();
    expect(document.querySelector('#detail-test .detail-date')).not.toBeNull();
    expect(document.querySelector('#detail-test .rich-content')).toBeNull();
    expect(document.querySelector('#detail-test .detail-introduction-pending')).not.toBeNull();
    expect(document.querySelector('#detail-test .muted')?.textContent).not.toContain('还没有补充展会介绍');

    releaseParser();
    await vi.waitFor(() =>
      expect(document.querySelector('#detail-test .rich-content')?.textContent).toBe('# 展会亮点'),
    );
  });
  it('媒体型 HTML 简介等待解析器时不显示空简介', async () => {
    let releaseParser!: () => void;
    markdownHarness.parserGate = new Promise<void>((resolve) => {
      releaseParser = resolve;
    });
    const detail: ExhibitionDetail = {
      ...DETAIL,
      exhibition: {
        ...DETAIL.exhibition!,
        descriptionFormat: 'html',
        description: '<p><img src="/media/poster.jpg"></p>',
      },
    };

    await mountDetail({ detail, cached: true });

    expect(document.querySelector('#detail-test .detail-introduction-pending')).not.toBeNull();
    expect(document.querySelector('#detail-test .detail-introduction-pending')?.textContent).toBe('展会介绍加载中…');
    expect(document.querySelector('#detail-test .muted')?.textContent).not.toContain('还没有补充展会介绍');

    releaseParser();
    await vi.waitFor(() => expect(document.querySelector('#detail-test .rich-content')).not.toBeNull());
  });
  it('解析器加载失败时继续显示详情并说明简介暂不可用', async () => {
    markdownHarness.parserFails = true;
    const detail: ExhibitionDetail = {
      ...DETAIL,
      exhibition: { ...DETAIL.exhibition!, description: '# 展会亮点' },
    };

    await mountDetail({ detail });

    await vi.waitFor(() => expect(document.querySelector('#detail-test .detail-introduction-fallback')).not.toBeNull());
    expect(document.querySelector('#detail-test h2')?.textContent).toBe('秋季展会');
    expect(document.querySelector('#detail-test .detail-introduction-fallback')?.textContent).toContain('暂时无法加载');
  });
  it('跨年展期在闭展日期中显示年份', async () => {
    const detail: ExhibitionDetail = {
      ...DETAIL,
      exhibition: { ...DETAIL.exhibition!, date: '2026-12-30', endDate: '2027-01-02' },
    };

    await mountDetail({ detail });

    expect(document.querySelector('#detail-test .detail-date-context')?.textContent).toBe('2026年 · 周三');
    expect(document.querySelector('#detail-test .detail-date-period > strong')?.textContent).toBe(
      '2027年1月2日（周六）',
    );
  });
});

describe('展会详情海报', () => {
  it('有自己上传的海报时显示海报与灯箱入口', async () => {
    await mountDetail({
      detail: {
        found: true,
        exhibition: {
          id: 'exh-1',
          title: '秋季展会',
          date: '2026-09-20',
          time: '09:00-17:00',
          venue: '会展中心',
          exhibitor: '示例展商',
          openForRegistration: true,
          imageUri: '/media/poster.jpg',
        },
      },
    });
    const hero = document.querySelector<HTMLButtonElement>('#detail-test .hero-button');
    expect(hero).not.toBeNull();
    expect(hero?.querySelector('img')?.getAttribute('src')).toBe('/media/poster.jpg');
    hero?.click();
    await flush();
    expect(document.querySelector('.viewer')).not.toBeNull();
  });

  it('没有海报时不显示海报、占位图与灯箱入口', async () => {
    await mountDetail();
    expect(document.querySelector('#detail-test .hero')).toBeNull();
    expect(document.querySelector('#detail-test .hero-button')).toBeNull();
    expect(document.querySelector('#detail-test .hero-placeholder')).toBeNull();
    expect(document.querySelector('.viewer')).toBeNull();
  });

  it('只有管理员缺省海报时详情页也不显示', async () => {
    await mountDetail({ defaultCover: '/media/default.jpg' });
    expect(document.querySelector('#detail-test .hero')).toBeNull();
    expect(document.querySelector('#detail-test img[src="/media/default.jpg"]')).toBeNull();
    expect(document.querySelector('#detail-test .hero-button')).toBeNull();
  });
});

describe('展会详情底部报名按钮', () => {
  it('未报名时是「立即报名」，点击进入报名表单', async () => {
    const router = await mountDetail({ loggedIn: true });
    await flush();
    expect(registerButton()?.textContent?.trim()).toBe('立即报名');
    expect(registerButton()?.disabled).toBe(false);
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-form/exh-1'));
  });

  it('已报名本场时变「查看我的报名」，点击进入报名详情', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'approved' },
    ]);
    const router = await mountDetail({ loggedIn: true });
    await vi.waitFor(() => expect(registerButton()?.textContent?.trim()).toBe('查看我的报名'));
    expect(footerHint()).toContain('已报名这场展会');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-detail/reg-9'));
  });

  it('已撤销的报名不算已报名', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'cancelled' },
    ]);
    const router = await mountDetail({ loggedIn: true });
    await flush();
    expect(api.registrations.list).toHaveBeenCalledTimes(1);
    expect(registerButton()?.textContent?.trim()).toBe('立即报名');
    expect(footerHint()).not.toContain('已报名这场展会');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-form/exh-1'));
  });

  it('已报名时按钮不被报名关闭 / 受限账号禁用', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'pending' },
    ]);
    const router = await mountDetail({ loggedIn: true, canRegister: false, detail: CLOSED_DETAIL });
    await vi.waitFor(() => expect(registerButton()?.textContent?.trim()).toBe('查看我的报名'));
    expect(registerButton()?.disabled).toBe(false);
    expect(footerHint()).toContain('已报名这场展会');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-detail/reg-9'));
  });

  it('报名列表失败时仍显示「立即报名」，不把整页变成失败态', async () => {
    vi.mocked(api.registrations.list).mockRejectedValue(new Error('网络错误'));
    const router = await mountDetail({ loggedIn: true });
    await flush();
    expect(document.querySelector('#detail-test h2')?.textContent).toContain('秋季展会');
    expect(registerButton()?.textContent?.trim()).toBe('立即报名');
    registerButton()?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/registration-form/exh-1'));
  });

  it('访客不发 registrations 请求', async () => {
    await mountDetail({});
    await flush();
    expect(api.registrations.list).not.toHaveBeenCalled();
    expect(registerButton()?.textContent?.trim()).toBe('登录后报名');
  });

  it('事实区显示我的报名状态与报名截止日，第一枚状态灯仍是报名方式', async () => {
    vi.mocked(api.registrations.list).mockResolvedValue([
      { id: 'reg-9', exhibitionId: 'exh-1', statusCode: 'approved' },
    ]);
    const detail: ExhibitionDetail = {
      found: true,
      exhibition: { ...DETAIL.exhibition!, statusCode: 'review', registrationEnd: '2026-09-19' },
    };
    await mountDetail({ loggedIn: true, detail });
    await vi.waitFor(() => expect(registerButton()?.textContent?.trim()).toBe('查看我的报名'));

    const tags = [...document.querySelectorAll<HTMLElement>('#detail-test .status-tag')];
    // 第一枚仍是报名方式（已报名的状态不抢它的位置），第二枚是本场报名状态。
    expect(tags[0]?.textContent?.trim()).toBe('报名中 · 需审核');
    expect(tags[1]?.textContent?.trim()).toBe('已通过');
    const facts = document.querySelector<HTMLElement>('#detail-test .detail-facts');
    expect(facts?.textContent).toContain('报名截止 2026年9月19日');
    expect(
      facts
        ?.querySelector('.detail-fact-deadline')
        ?.previousElementSibling?.classList.contains('detail-registration-state'),
    ).toBe(true);
    expect(facts?.querySelector('.detail-mode-hint')).toBeNull();
    expect(document.querySelector('#detail-test .hint-note')).toBeNull();
  });

  it('报名截止日已过：主按钮置灰并显示「报名已截止」，状态灯显示「截止报名」', async () => {
    await mountDetail({ loggedIn: true, detail: ENDED_DETAIL });
    await flush();
    expect(registerButton()?.textContent?.trim()).toBe('报名已截止');
    expect(registerButton()?.disabled).toBe(true);
    expect(footerHint()).toContain('报名截止日期已过');
    // 状态灯按服务端下发的 registrationEnded 换成「截止报名」，不是「报名中 · 需审核」。
    expect(document.querySelector('#detail-test .status-tag')?.textContent?.trim()).toBe('截止报名');
  });

  it('展商手动关闭报名时仍显示「报名已关闭」', async () => {
    await mountDetail({ loggedIn: true, detail: CLOSED_DETAIL });
    await flush();
    expect(registerButton()?.textContent?.trim()).toBe('报名已关闭');
    expect(registerButton()?.disabled).toBe(true);
    expect(footerHint()).toContain('该展会当前不接受报名');
  });
});
