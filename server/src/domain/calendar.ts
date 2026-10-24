/**
 * 首页日历的日期基准。
 *
 * 「今天」统一取数据库的 CURRENT_DATE：示例展会、报名窗口和额度判断都用它，
 * 服务进程与数据库时区不一致时，页面不应该出现两套「今天」。
 */
import { query } from '../config/pool.js';

export interface CalendarToday {
  year: number;
  month: number;
  day: number;
}

/** 数据库的今天（年 / 月 / 日）。 */
export async function calendarToday(): Promise<CalendarToday> {
  const result = await query<CalendarToday>(
    `SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS year,
            EXTRACT(MONTH FROM CURRENT_DATE)::int AS month,
            EXTRACT(DAY FROM CURRENT_DATE)::int AS day`,
  );
  return result.rows[0]!;
}

/**
 * 缺省选中的日期。
 *
 * 当前月取「今天及以后第一个有活动的日子」；本月没有就落在今天 ——
 * 否则首页会把高亮停在一个已经过去的日子，当天列表却是空的。
 * 其它月份（用户自己翻过去的）仍取该月第一个有活动的日子；没有活动就不选中（0）。
 *
 * @param activityDays 有展会或本人私人会议的日期；重复值会被去掉。
 */
export function defaultCalendarDay(options: {
  year: number;
  month: number;
  today: CalendarToday;
  activityDays: unknown[];
}): number {
  const days = [...new Set(options.activityDays.map(Number).filter((day) => Number.isInteger(day) && day > 0))].sort(
    (left, right) => left - right,
  );
  if (options.year === options.today.year && options.month === options.today.month) {
    return days.find((day) => day >= options.today.day) ?? options.today.day;
  }
  return days[0] ?? 0;
}
