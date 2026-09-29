/**
 * 日期与文本格式化。
 *
 * 后端下发的是 `YYYY-MM-DD`，解析失败一律返回空串：日历与详情页都按这个日期定位，
 * 猜一个「今天」会让页面显示与数据不一致的月份。周几与「年/月」这类单位属于格式化
 * 常量而不是页面文案（与 `scripts/extract-strings.js` 的 `SKIP_FILES` 约定一致）。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** ISO 日期（2026-06-12）→ 年月日；非法日期返回 null。 */
export function parseDate(iso: unknown): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDateWithWeekday(iso: unknown): string {
  const date = parseDate(iso);
  if (!date) return '';
  const weekday = WEEKDAYS[new Date(date.year, date.month - 1, date.day).getDay()] ?? '';
  return `${date.month}月${date.day}日（${weekday}）`;
}

/**
 * 报名 / 参展记录里的展会日期：优先用接口给的 ISO 日期，没有才用年 / 月 / 日字段拼。
 * 页面直接写死月份会在真实数据（跨月展会）上显示成错的日期。
 */
export function formatRecordDate(record: JsonLike): string {
  const item = record ?? {};
  if (item.exhibitionDate) return formatDateWithWeekday(item.exhibitionDate);
  const day = Number(item.exhibitionDay) || 0;
  if (!day) return '';
  const month = Number(item.exhibitionMonth) || 0;
  const year = Number(item.exhibitionYear) || 0;
  if (year && month) {
    return formatDateWithWeekday(`${year}-${pad(month)}-${pad(day)}`);
  }
  return month ? `${month}月${day}日` : `${day}日`;
}

type JsonLike = Record<string, unknown> | undefined | null;

/** 把答案文本按行渲染为键值对，找不到分隔符时返回原文。 */
export function answerLines(answers: unknown): Array<{ label: string; value: string }> {
  const text = String(answers ?? '').trim();
  if (text === '') return [];
  return text.split('\n').map((line) => {
    const index = line.indexOf('：') >= 0 ? line.indexOf('：') : line.indexOf(':');
    if (index <= 0) return { label: '', value: line.trim() };
    return { label: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
  });
}

/** 裁剪文本，用于列表摘要。 */
export function truncate(value: unknown, max = 42): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 该月第一天的星期偏移，以周一为一周起点（与首页日历的表头一致）。 */
export function firstWeekdayOffset(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

/**
 * 日历要排几行：放得下就 5 行，放不下才 6 行。
 *
 * `offset + 当月天数` 就是占用的格子数：≤35 时 5 行足够（这时第 5 行末尾用下月日期补位），
 * 36…42 才需要第 6 行。下限取 5 而不是 4：个别 2 月正好 28 格，但让卡片在 4/5/6 三档
 * 之间跳更难看，所以 4 行的情况也补到 5 行。
 */
export function calendarRowCount(year: number, month: number): number {
  return firstWeekdayOffset(year, month) + daysInMonth(year, month) <= 35 ? 5 : 6;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = (year * 12) + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
