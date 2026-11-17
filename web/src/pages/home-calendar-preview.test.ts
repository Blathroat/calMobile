/**
 * 首页日历的相邻月预览：拖动时露出来的必须是上/下个月的日历，而不是空白。
 *
 * 只验证结构与手势位移：真实布局在 jsdom 里没有宽度，`cardWidth()` 会回退到 320，
 * 因此位移量按 320 计算。落月动画依赖 transitionend，不在 jsdom 里模拟。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import HomePage from './HomePage.vue';

vi.mock('@/app/runtime', () => ({
  api: {
    users: { list: vi.fn() },
    exhibitions: { list: vi.fn(), month: vi.fn(), get: vi.fn(async () => ({})) },
    settings: { get: vi.fn(async () => ({})) },
  },
  bootApp: vi.fn(async () => undefined),
  applyRuntimeBootstrap: vi.fn(),
}));
vi.mock('@/app/preload', () => ({ preloadAdjacentMonths: vi.fn() }));

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  vi.mocked(api.users.list).mockResolvedValue([]);
  vi.mocked(api.exhibitions.list).mockResolvedValue([]);
  vi.mocked(api.settings.get).mockResolvedValue({});
  vi.mocked(api.exhibitions.month).mockResolvedValue({
    day: 12,
    eventDays: [3, 12],
    markedDays: [12],
    exhibitions: [{ id: 'june', day: 12, days: [12, 13], title: '六月展会' }],
    meetings: [],
  });
  // 减少动效：切月会走「直接换月」分支，测试只关心拖动时的预览位移与结构。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountHome(): Promise<HTMLElement> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().apply({ calendar: { landing: { year: 2026, month: 6 } } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: HomePage }],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/home');
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({ render: () => h(HomePage) });
  app.use(pinia).use(router).mount(container);
  await flush();
  return container;
}

/** 派发一个最小 PointerEvent：jsdom 的构造器不一定可用，直接给 Event 补字段。 */
function firePointer(target: Element, type: string, x: number, y: number, pointerId = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: x },
    clientY: { value: y },
    pointerType: { value: 'touch' },
  });
  target.dispatchEvent(event);
}

function ownDays(scope: ParentNode): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>('.cal-day')].filter(
    (button) => button.dataset.muted === 'false',
  );
}

describe('首页日历相邻月预览', () => {
  it('左右预览面板排的是上/下个月，而不是空白', async () => {
    const container = await mountHome();
    const previews = [...container.querySelectorAll<HTMLElement>('.calendar-preview')];
    expect(previews.length).toBe(2);
    for (const preview of previews) {
      expect(preview.getAttribute('aria-hidden')).toBe('true');
      // 预览面板的按钮全部禁用，不会抢焦点
      expect([...preview.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    }
    const previous = container.querySelector<HTMLElement>('.calendar-preview[data-side="prev"]')!;
    const next = container.querySelector<HTMLElement>('.calendar-preview[data-side="next"]')!;
    // 落在 2026 年 6 月：上一月 5 月 31 天，下一月 7 月 31 天
    expect(ownDays(previous).length).toBe(31);
    expect(ownDays(next).length).toBe(31);
    expect(next.querySelector<HTMLElement>('[data-day="31"][data-muted="false"]')).not.toBeNull();
    // 当前月（6 月）只有 30 天，7 月 31 日不会出现在当前面板
    const current = container.querySelector<HTMLElement>('.calendar:not(.calendar-preview) .calendar-grid')!;
    expect(current.querySelector('[data-day="31"][data-muted="false"]')).toBeNull();
  });

  it('选中跨天展会的中间一天，下面仍然展示这场展会', async () => {
    const container = await mountHome();
    await flush();
    const current = container.querySelector<HTMLElement>('.calendar:not(.calendar-preview)')!;
    const day13 = [...current.querySelectorAll<HTMLButtonElement>('.cal-day')].find(
      (button) => button.dataset.day === '13' && button.dataset.muted === 'false',
    );
    day13?.click();
    await flush();
    // 展会 12～13 日：选中 13 日时列表仍要出现它（不是只在开展当天展示）。
    expect(container.textContent).toContain('六月展会');
    expect(container.textContent).toContain('6 月 13 日');
  });

  it('拖动时当前月与预览一起平移，露出的位置有下一月内容', async () => {
    const container = await mountHome();
    const host = container.querySelector<HTMLElement>('.calendar-swipe')!;
    const card = container.querySelector<HTMLElement>('.calendar:not(.calendar-preview)')!;
    const next = container.querySelector<HTMLElement>('.calendar-preview[data-side="next"]')!;
    const previous = container.querySelector<HTMLElement>('.calendar-preview[data-side="prev"]')!;

    firePointer(host, 'pointerdown', 200, 300);
    firePointer(host, 'pointermove', 120, 302);
    await nextTick();

    // dx = -80：卡片跟手 -80，下一月预览从 +320 移到 +240，上一月在 -400
    expect(card.style.transform).toContain('-80px');
    expect(next.style.transform).toContain('240px');
    expect(previous.style.transform).toContain('-400px');
    expect(host.dataset.dragging).toBe('true');
    // 露出来的仍是完整的下一月网格（有日期按钮）
    expect(next.querySelectorAll('.cal-day').length).toBeGreaterThan(0);
  });
});
