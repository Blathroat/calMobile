import { describe, expect, it } from 'vitest';
import { resolveCalendarSwipe } from './calendar-swipe';

describe('首页月历横向手势', () => {
  it('拖过卡片宽度的 1/4 才切换月份', () => {
    expect(resolveCalendarSwipe({ deltaX: -80, velocityX: 0, width: 320 })).toEqual({
      commit: true,
      direction: 1,
    });
    expect(resolveCalendarSwipe({ deltaX: 80, velocityX: 0, width: 320 })).toEqual({
      commit: true,
      direction: -1,
    });
    expect(resolveCalendarSwipe({ deltaX: -40, velocityX: 0, width: 320 })).toEqual({
      commit: false,
      direction: 0,
    });
  });

  it('距离不够但甩得够快也算切换，微小抖动不算', () => {
    expect(resolveCalendarSwipe({ deltaX: -24, velocityX: -0.9, width: 320 })).toEqual({
      commit: true,
      direction: 1,
    });
    expect(resolveCalendarSwipe({ deltaX: -8, velocityX: -2, width: 320 })).toEqual({
      commit: false,
      direction: 0,
    });
  });

  it('宽度缺失或异常时不除零和误判', () => {
    expect(resolveCalendarSwipe({ deltaX: -10, velocityX: 0, width: 0 })).toEqual({
      commit: false,
      direction: 0,
    });
    expect(resolveCalendarSwipe({ deltaX: 20, velocityX: 0.1, width: 100 })).toEqual({
      commit: false,
      direction: 0,
    });
  });
});
