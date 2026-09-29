/**
 * 首页日期的格式化与日历排布。
 *
 * 这里的用例钉住两件事，它们是同一个 bug 的两面：
 *
 * 1. 星期偏移与表头顺序必须一致——表头从周一开始，偏移就得以周一为 0，否则整月的日期
 *    会整体串列（「9 月 1 日是周二却排在周四」就是这种串列）；
 * 2. 行数按月份取 5 或 6 行：放得下就 5 行，放不下才 6 行，且任何一个月都不能少于 5 行。
 */

import { describe, expect, it } from 'vitest';
import { calendarRowCount, daysInMonth, firstWeekdayOffset, formatDateWithWeekday, parseDate } from './format';

/** 表头顺序（`HomePage.vue` 的 `WEEK_LABELS`）：周一在前，与偏移的起点一致。 */
const WEEK_START = '一';

describe('firstWeekdayOffset', () => {
  it('以周一为 0，和表头顺序对齐', () => {
    expect(WEEK_START).toBe('一');
    // 2026-06-01 是周一 → 第一格就是 1 号；2026-09-01 是周二 → 前面只补一天。
    expect(firstWeekdayOffset(2026, 6)).toBe(0);
    expect(firstWeekdayOffset(2026, 9)).toBe(1);
    expect(firstWeekdayOffset(2026, 10)).toBe(3);
  });

  it('每个月的每一天都落在它真实的星期列上', () => {
    for (let year = 2024; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const offset = firstWeekdayOffset(year, month);
        for (let day = 1; day <= daysInMonth(year, month); day += 1) {
          // 格子列号（从周一起算）必须等于当天的真实星期列号，否则表头就对不上号。
          const column = (offset + day - 1) % 7;
          const truth = (new Date(year, month - 1, day).getDay() + 6) % 7;
          expect({ year, month, day, column }).toEqual({ year, month, day, column: truth });
        }
      }
    }
  });
});

describe('calendarRowCount', () => {
  it('放得下就 5 行，放不下才 6 行', () => {
    expect(calendarRowCount(2026, 9)).toBe(5); // 1 天补位 + 30 天 = 31 格
    expect(calendarRowCount(2026, 10)).toBe(5); // 3 + 31 = 34 格
    expect(calendarRowCount(2026, 8)).toBe(6); // 5 + 31 = 36 格，5 行放不下
    expect(calendarRowCount(2026, 11)).toBe(6); // 6 + 30 = 36 格
  });

  it('永远不会少于 5 行', () => {
    for (let year = 2024; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const rows = calendarRowCount(year, month);
        const filled = firstWeekdayOffset(year, month) + daysInMonth(year, month);
        expect(rows).toBeGreaterThanOrEqual(5);
        expect(rows).toBeLessThanOrEqual(6);
        // 5 行够用时不能排 6 行，5 行不够时必须补到 6 行。
        expect(rows).toBe(filled <= 35 ? 5 : 6);
      }
    }
  });
});

describe('日期格式化', () => {
  it('周几与日期对得上', () => {
    expect(formatDateWithWeekday('2026-09-01')).toBe('9月1日（周二）');
    expect(formatDateWithWeekday('2026-10-01')).toBe('10月1日（周四）');
    expect(formatDateWithWeekday('2026-06-12')).toBe('6月12日（周五）');
  });

  it('非法日期返回空串，不猜一个今天', () => {
    expect(parseDate('2026-9-1')).toBeNull();
    expect(formatDateWithWeekday('')).toBe('');
    expect(formatDateWithWeekday('not-a-date')).toBe('');
  });
});
