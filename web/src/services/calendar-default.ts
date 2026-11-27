/**
 * 首页日历默认选中的日期。
 *
 * 规则（当前自然月）：优先「今天之后」第一个有活动的日期；今天之后没有活动就选今天，
 * 不管今天有没有活动。切到别的月份时没有「今天之后」这个概念，退回该月第一个有活动的日期；
 * 整月没有活动返回 0（不选中具体某天）。
 *
 * 有活动 = 日历上加粗的展会日（`eventDays`）或本人活动圆点（`markedDays`）。
 * 纯函数，日期由调用方传入，测试不需要依赖机器当前时间。
 */

export interface HomeDefaultDayOptions {
  /** 日历当前显示的年份。 */
  year: number;
  /** 日历当前显示的月份（1~12）。 */
  month: number;
  /** 该月有活动的日期（展会加粗日与本人活动圆点的并集）。 */
  activeDays: Iterable<number>;
  /** 当前时间：只有落在当前自然月时才用它的「今天」。 */
  today: Date;
}

/** 当前自然月的年月：首页取月与底部导航预热共用，参数一致才命中同一份缓存。 */
export function currentYearMonth(now: Date = new Date()): { year: number; month: number } {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * @returns 应默认选中的日期（1~31）；整个月都没有活动且不是当前月时返回 0
 */
export function homeDefaultDay(options: HomeDefaultDayOptions): number {
  const days = [...new Set(options.activeDays)]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
    .sort((left, right) => left - right);
  const todayYear = options.today.getFullYear();
  const todayMonth = options.today.getMonth() + 1;
  const currentMonth = options.year === todayYear && options.month === todayMonth;
  if (!currentMonth) return days[0] ?? 0;
  const today = options.today.getDate();
  return days.find((day) => day > today) ?? today;
}
