import { describe, expect, it } from 'vitest';
import { homeDefaultDay } from './calendar-default';

const JUNE = { year: 2026, month: 6 } as const;
const TODAY = new Date('2026-06-05T10:00:00');

describe('首页默认选中的日期', () => {
  it('当前月：选今天之后第一个有活动的日期', () => {
    expect(homeDefaultDay({ ...JUNE, activeDays: [10, 12], today: TODAY })).toBe(10);
    expect(homeDefaultDay({ ...JUNE, activeDays: [4, 6, 6, 20], today: TODAY })).toBe(6);
  });

  it('当前月：今天之后没有活动就选今天（不管今天有没有活动）', () => {
    expect(homeDefaultDay({ ...JUNE, activeDays: [1, 2, 3], today: TODAY })).toBe(5);
    expect(homeDefaultDay({ ...JUNE, activeDays: [5], today: TODAY })).toBe(5);
    expect(homeDefaultDay({ ...JUNE, activeDays: [], today: TODAY })).toBe(5);
  });

  it('其它月份：没有「今天之后」，选该月第一个有活动的日期', () => {
    expect(homeDefaultDay({ year: 2026, month: 7, activeDays: [3, 8, 9], today: TODAY })).toBe(3);
    expect(homeDefaultDay({ year: 2025, month: 6, activeDays: [12], today: TODAY })).toBe(12);
  });

  it('整月没有活动且不是当前月：不选中具体日期', () => {
    expect(homeDefaultDay({ year: 2026, month: 7, activeDays: [], today: TODAY })).toBe(0);
  });

  it('活动日期里的脏值不影响挑选', () => {
    expect(homeDefaultDay({ ...JUNE, activeDays: [0, -3, 2.5, 99, 10], today: TODAY })).toBe(10);
  });
});
