/**
 * 日期 / 时间入口里的纯函数：`HH:MM` 与「时 / 分」互相转换。
 *
 * 抽出来测是因为它同时被编辑展会（拆分历史 `HH:MM-HH:MM`）和会议申请（空时间按时 / 分摆位）用到，
 * 出错只会在界面上显示成错的时间。
 */
import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from './pickers';

describe('parseClock', () => {
  it('只认 HH:MM，带一位小时也接受', () => {
    expect(parseClock('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseClock('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseClock('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('空值、时间区间与非法值返回 null', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock(undefined)).toBeNull();
    expect(parseClock('09:00-17:00')).toBeNull();
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('09:60')).toBeNull();
    expect(parseClock('9：05')).toBeNull();
  });
});

describe('formatClock', () => {
  it('补零成两位并使越界值落在合法范围内', () => {
    expect(formatClock(9, 5)).toBe('09:05');
    expect(formatClock(0, 0)).toBe('00:00');
    expect(formatClock(23, 59)).toBe('23:59');
    expect(formatClock(30, 90)).toBe('23:59');
    expect(formatClock(-3, -10)).toBe('00:00');
  });

  it('与 parseClock 互为逆运算', () => {
    for (const value of ['00:00', '09:05', '12:30', '23:59']) {
      const parsed = parseClock(value);
      expect(parsed).not.toBeNull();
      expect(formatClock(parsed!.hour, parsed!.minute)).toBe(value);
    }
  });
});
