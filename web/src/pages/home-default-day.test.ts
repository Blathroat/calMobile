/**
 * 首页日历默认选中的日期：
 * - 当前自然月里优先选「今天之后」第一个有活动的日期；今天之后没有活动就选今天（不管今天有没有活动）；
 * - 切到别的月份时选该月第一个有活动的日期。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, bootApp } from '@/app/runtime';
import { flush, mountHomePage, unmountHomePages } from './home-test-utils';

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

const JUNE_ACTIVITY = {
  day: 10,
  eventDays: [10, 12],
  markedDays: [15],
  exhibitions: [
    { id: 'tenth', day: 10, days: [10], title: '十号展会' },
    { id: 'twelfth', day: 12, days: [12], title: '十二号展会' },
  ],
  meetings: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-05T10:00:00'));
  vi.clearAllMocks();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  vi.mocked(api.users.list).mockResolvedValue([]);
  vi.mocked(api.exhibitions.list).mockResolvedValue([]);
  vi.mocked(api.settings.get).mockResolvedValue({});
  vi.mocked(api.exhibitions.month).mockImplementation(async ({ month } = {}) => {
    if (Number(month) === 7) {
      return {
        day: 3,
        eventDays: [3, 8],
        markedDays: [],
        exhibitions: [{ id: 'july', day: 3, days: [3], title: '七月展会' }],
        meetings: [],
      };
    }
    return JUNE_ACTIVITY;
  });
  // 减少动效：切月直接落月，用例只关心默认选中的日期。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  unmountHomePages();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 日历上当前被选中的那一天（只在当前月卡片里找，预览层是禁用的）。 */
function selectedDay(container: HTMLElement): string | undefined {
  const current = container.querySelector<HTMLElement>('.calendar:not(.calendar-preview)')!;
  return [...current.querySelectorAll<HTMLButtonElement>('.cal-day')].find(
    (button) => button.getAttribute('aria-pressed') === 'true',
  )?.dataset.day;
}

describe('首页日历默认选中的日期', () => {
  it('当天之后有活动：选最近的那一天', async () => {
    const container = await mountHomePage();

    expect(selectedDay(container)).toBe('10');
    expect(container.textContent).toContain('6 月 10 日的活动');
    expect(container.textContent).toContain('十号展会');
  });

  it('当天之后没有活动：选当天，哪怕当天没有活动', async () => {
    // 今天 20 号：本月活动都在 10 / 12 / 15 号。
    vi.setSystemTime(new Date('2026-06-20T10:00:00'));
    const container = await mountHomePage();

    expect(selectedDay(container)).toBe('20');
    expect(container.textContent).toContain('6 月 20 日的活动');
    expect(container.textContent).toContain('这一天还没有活动');
  });

  it('切到别的月份：选该月第一个有活动的日期', async () => {
    const container = await mountHomePage();
    container.querySelector<HTMLButtonElement>('button[title="下一个月"]')!.click();
    await flush();

    expect(selectedDay(container)).toBe('3');
    expect(container.textContent).toContain('7 月 3 日的活动');
    expect(container.textContent).toContain('七月展会');
  });
});
