/**
 * 首页空白日期的下一步：选到没有活动的日期时，原位给出本月最近、确实有活动的日期按钮，
 * 点一下就地切换（月视图一次取整月，切换日期不发请求）；搜索入口只给已登录账号，
 * 因为 /search 要求登录，访客点进去只会被弹回登录页。
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

beforeEach(() => {
  // 首页默认落在当前自然月：把「今天」固定在 2026-06-05，用例里的 6 月数据才是当前月。
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-05T10:00:00'));
  vi.clearAllMocks();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  vi.mocked(api.users.list).mockResolvedValue([]);
  vi.mocked(api.exhibitions.list).mockResolvedValue([]);
  vi.mocked(api.settings.get).mockResolvedValue({});
  // 6 月 10 日与 12 日有展会，11 日是空白；15 日只有本人的活动。
  vi.mocked(api.exhibitions.month).mockResolvedValue({
    day: 10,
    eventDays: [10, 12],
    markedDays: [15],
    exhibitions: [
      { id: 'tenth', day: 10, days: [10], title: '十号展会' },
      { id: 'twelfth', day: 12, days: [12], title: '十二号展会' },
    ],
    meetings: [],
  });
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

/** 点日历上的某一天（只认当月的格子，补位格子是灰的）。 */
async function pickDay(container: HTMLElement, day: number): Promise<void> {
  // 只点当前月：两侧预览里也有同一天的格子，但它们是禁用且 aria-hidden 的。
  const current = container.querySelector<HTMLElement>('.calendar:not(.calendar-preview)')!;
  const cell = [...current.querySelectorAll<HTMLButtonElement>('.cal-day')].find(
    (button) => button.dataset.day === String(day) && button.dataset.muted === 'false',
  );
  expect(cell, `日历里没有 ${day} 日`).not.toBeUndefined();
  cell!.click();
  await flush();
}

describe('首页空白日期', () => {
  it('给出最近的有展会日期，点一下就切换到那天的活动', async () => {
    const container = await mountHomePage();
    expect(container.textContent).toContain('十号展会');

    await pickDay(container, 11);
    // 空白日：空状态 + 前后两天的跳转按钮，而不是只给一句「没有活动」。
    expect(container.textContent).toContain('这一天还没有活动');
    const jumps = [...container.querySelectorAll<HTMLButtonElement>('.home-day-jumps button')];
    // 两颗按钮并排显示日期；「有展会」放在读屏名称里，按钮文字才放得下一行。
    expect(jumps.map((button) => button.textContent?.trim())).toEqual(['6月10日（周三）', '6月12日（周五）']);
    expect(jumps[1]?.getAttribute('aria-label')).toBe('6月12日有展会');

    jumps[1]!.click();
    await flush();
    expect(container.textContent).toContain('十二号展会');
    expect(container.textContent).toContain('6 月 12 日的活动');
  });

  it('只有本人活动的日期标成「有我的活动」', async () => {
    const container = await mountHomePage();
    await pickDay(container, 13);

    const jumps = [...container.querySelectorAll<HTMLButtonElement>('.home-day-jumps button')];
    const mine = jumps.find((button) => button.textContent?.includes('6月15日'));
    expect(mine).not.toBeUndefined();
    // 按钮文字只写日期，标记放在读屏名称里。
    expect(mine?.getAttribute('aria-label')).toBe('6月15日有我的活动');
  });

  it('访客看不到要登录的搜索入口，已登录账号才有', async () => {
    const guest = await mountHomePage();
    await pickDay(guest, 11);
    expect(guest.querySelector<HTMLButtonElement>('.home-day-jumps')).not.toBeNull();
    const guestButtons = [...guest.querySelectorAll<HTMLButtonElement>('button')].map((button) =>
      button.textContent?.trim(),
    );
    expect(guestButtons).not.toContain('搜索展会');

    unmountHomePages();
    document.body.innerHTML = '';

    const member = await mountHomePage({ loggedIn: true });
    await pickDay(member, 11);
    const memberButtons = [...member.querySelectorAll<HTMLButtonElement>('button')].map((button) =>
      button.textContent?.trim(),
    );
    expect(memberButtons).toContain('搜索展会');
  });
});
