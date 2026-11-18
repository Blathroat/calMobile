/**
 * 浏览器 / iOS PWA 的「加入日历」：把展会信息拼成 iCalendar（RFC 5545）文件再交给系统。
 *
 * Android 应用里加入日历走原生 `calendar.toggle`（系统 CalendarContract）；浏览器里没有
 * 原生桥，退一步生成 `.ics` 文件：优先交给系统分享面板（iOS 的「存储到“文件”」→ 点开
 * 加入日历），分享不可用时直接下载。两条路都能落到系统日历，页面只需要看结果。
 *
 * 组装规则：
 * - `DTSTAMP` 必须写 UTC，`now` 只用于这一行；同一场展会两次导出得到相同 UID。
 * - 全天 / 多天用 `VALUE=DATE`，`DTEND` 是**闭展次日**（RFC 5545 的结束日期不含当天）。
 * - 有时段（`09:00-17:30` 或只有 `09:00`）就按展会现场时区 `Asia/Shanghai` 写本地时间，
 *   并附 VTIMEZONE；解析不出时间就当全天，不猜。
 * - 文本值转义 `\ ; , 换行`，所有行按 UTF-8 字节折到 75 以内。
 */
import { downloadBlob, shareFile } from './browser-device';

/** 日历事件的输入：字段与详情页 / 原生 `calendar.toggle` 同名，页面只组一份。 */
export interface CalendarEventInput {
  title: string;
  /** 开始日，后端下发的 `YYYY-MM-DD`。 */
  date: string;
  /** 闭展日（含当天），缺省与 `date` 同一天。 */
  endDate?: string;
  /** 展示时间 `09:00-17:30` 或只有开始时间 `09:00`；解析不出就按全天处理。 */
  time?: string;
  venue?: string;
  description?: string;
  /** 报名链接等，写进 VEVENT 的 URL。 */
  url?: string;
  /** 稳定标识：有就用它生成 UID，没有就用标题 + 日期。 */
  id?: string;
}

/** 加入日历的结果：交给系统分享、退回下载、或用户在分享面板里取消。 */
export type CalendarShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** 展会时间按现场时区解释；全年固定 +08:00，没有夏令时。 */
const TIME_ZONE = 'Asia/Shanghai';
const TZ_OFFSET = '+0800';
const TZ_NAME = 'CST';
const MS_PER_DAY = 86_400_000;

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** 两位补零；年份补到四位。 */
function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** 解析后端下发的 `YYYY-MM-DD`；格式不对或日期不存在（如 2 月 30 日）返回 null。 */
function parseDay(value: unknown): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** `YYYYMMDD`，用于全天事件的 DATE 值。 */
function dayStamp(day: CalendarDay): string {
  return `${pad(day.year, 4)}${pad(day.month)}${pad(day.day)}`;
}

/** 日期换成 UTC 天序号：跨月 / 跨年只做整数加减，不碰本地时区。 */
function epochDay(day: CalendarDay): number {
  return Math.trunc(Date.UTC(day.year, day.month - 1, day.day) / MS_PER_DAY);
}

function dayFromEpoch(value: number): CalendarDay {
  const date = new Date(value * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * 解析展示时间：`09:00-17:30`、`09:00` 两种写法，分钟数从当天 0 点算起。
 * 只有开始时间时结束时间留 null，由调用方补默认时长。
 */
function parseClockRange(value: unknown): { start: number; end: number | null } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?:\s*[-–—~至]\s*([01]?\d|2[0-3]):([0-5]\d))?$/.exec(
    String(value ?? '').trim(),
  );
  if (!match) return null;
  return {
    start: Number(match[1]) * 60 + Number(match[2]),
    end: match[3] === undefined ? null : Number(match[3]) * 60 + Number(match[4]),
  };
}

/** UTC 时间戳 `YYYYMMDDTHHMMSSZ`；`now` 非法时退回当前时刻，不让整份文件失败。 */
function utcStamp(value: Date): string {
  const date = Number.isNaN(value.getTime()) ? new Date() : value;
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** 当天分钟数换成 `YYYYMMDDTHHMMSS`（带 TZID 时不能用 Z 后缀）。 */
function localStamp(instant: number): string {
  const day = Math.floor(instant / 1440);
  const minutes = instant - day * 1440;
  return `${dayStamp(dayFromEpoch(day))}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

/** iCalendar 文本转义：反斜杠最先，避免把后面生成的转义符再转一次。 */
function escapeIcsText(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** 单个字符的 UTF-8 字节数（按码点，不会把代理对拆开）。 */
function utf8ByteLength(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * RFC 5545 折行：一行超过 75 字节时插入 CRLF + 一个空格，续行正文最多 74 字节。
 * 按字节而不是字符计数，中文标题不会被按长度切断。
 */
function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let chunk = '';
  let size = 0;
  for (const char of line) {
    // 首行最多 75 字节；续行的前导空格占 1 字节，正文只剩 74 字节。
    const limit = chunks.length === 0 ? 75 : 74;
    if (size + utf8ByteLength(char) > limit) {
      chunks.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += char;
    size += utf8ByteLength(char);
  }
  chunks.push(chunk);
  return chunks.join('\r\n ');
}

/** 稳定的 UID：有后端 id 用 id，否则用标题 + 日期；换行与空白不能进属性值。 */
function eventUid(input: CalendarEventInput): string {
  const explicit = String(input.id ?? '').trim();
  const raw = explicit || `${String(input.title ?? '').trim()}-${String(input.date ?? '').trim()}`;
  const safe = raw
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return `${safe || 'exhibition'}@calmobile`;
}

/** 文件名主干：去掉各系统文件名里非法的字符，太长截断；带上日期方便在「文件」里找。 */
function fileStem(input: CalendarEventInput): string {
  const title = String(input.title ?? '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  const day = parseDay(input.date);
  const suffix = day ? dayStamp(day) : 'exhibition';
  return title ? `${title}-${suffix}` : `exhibition-${suffix}`;
}

/** 有时间段时附上的 VTIMEZONE：展会现场时区，固定偏移。 */
const TIME_ZONE_BLOCK = [
  'BEGIN:VTIMEZONE',
  `TZID:${TIME_ZONE}`,
  `X-LIC-LOCATION:${TIME_ZONE}`,
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  `TZOFFSETFROM:${TZ_OFFSET}`,
  `TZOFFSETTO:${TZ_OFFSET}`,
  `TZNAME:${TZ_NAME}`,
  'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * 生成一份展会日历文件。抛错只发生在日期缺失 / 格式不对时：这种情况没有可写的
 * DTSTART，宁可直接失败让页面提示，也不猜一个月份。
 *
 * @param input 展会信息，字段见 `CalendarEventInput`
 * @param now `DTSTAMP` 用的时刻，测试可固定；缺省当前时间
 */
export function buildExhibitionIcs(input: CalendarEventInput, now: Date = new Date()): string {
  const start = parseDay(input.date);
  if (!start) throw new Error('展会日期不合法，无法生成日历文件');
  const explicitEnd = parseDay(input.endDate);
  const last = explicitEnd && epochDay(explicitEnd) > epochDay(start) ? explicitEnd : start;
  const range = parseClockRange(input.time);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalMobile//Exhibition Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (range) lines.push(...TIME_ZONE_BLOCK);

  lines.push('BEGIN:VEVENT', `UID:${eventUid(input)}`, `DTSTAMP:${utcStamp(now)}`);
  if (range) {
    const startInstant = epochDay(start) * 1440 + range.start;
    // 只有开始时间时默认一小时；结束不晚于开始（数据写反 / 跨零点）时给一小时兜底。
    const requestedEnd = epochDay(last) * 1440 + (range.end ?? range.start + 60);
    const endInstant = requestedEnd > startInstant ? requestedEnd : startInstant + 60;
    lines.push(`DTSTART;TZID=${TIME_ZONE}:${localStamp(startInstant)}`);
    lines.push(`DTEND;TZID=${TIME_ZONE}:${localStamp(endInstant)}`);
  } else {
    // 全天的结束日期不含当天：闭展日 11-22 → DTEND 11-23。
    lines.push(`DTSTART;VALUE=DATE:${dayStamp(start)}`);
    lines.push(`DTEND;VALUE=DATE:${dayStamp(dayFromEpoch(epochDay(last) + 1))}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(String(input.title ?? ''))}`);
  const venue = String(input.venue ?? '').trim();
  if (venue) lines.push(`LOCATION:${escapeIcsText(venue)}`);
  const description = String(input.description ?? '').trim();
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  const url = String(input.url ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * 浏览器里的「加入日历」：生成 `.ics` 文件后优先走系统分享面板，分享不可用时下载。
 * 用户取消原样返回；生成或分享失败向上抛，由页面提示。
 */
export async function addExhibitionToCalendar(input: CalendarEventInput): Promise<CalendarShareOutcome> {
  const content = buildExhibitionIcs(input);
  const fileName = `${fileStem(input)}.ics`;
  const file = new File([content], fileName, { type: 'text/calendar' });
  const outcome = await shareFile(file, String(input.title ?? '').trim() || fileName);
  if (outcome === 'shared') return 'shared';
  if (outcome === 'cancelled') return 'cancelled';
  downloadBlob(file, fileName);
  return 'downloaded';
}
