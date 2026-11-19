/**
 * 报名参加时间段校验。
 *
 * 多天展会的报名页让用户选「参加哪几天」，服务端在这里统一校验格式与区间，
 * 登录报名与匿名报名共用同一段代码：
 *
 * - 两端都空：表示没选，返回 null（按整段展会处理），老页面与老数据都走这条路；
 * - 只填一端：拒绝，不替用户猜「只参加哪一天」；
 * - 不是合法 `YYYY-MM-DD`：拒绝；
 * - 开始晚于结束：拒绝；
 * - 超出展会区间（开展～闭展，单日展会就是开展当天）：拒绝，文案带上展会区间。
 *
 * 与 `isoDateSchema` 一样回查 Date 的归一化结果：`2026-02-30` 这类会被 `new Date`
 * 悄悄进位到三月，不能当成合法日期收下。
 */

import { badRequest } from './errors.js';

/** 展会区间：`date` 是开展日，`endDate` 是闭展日；闭展为空表示单日展会。 */
export interface ExhibitionDateRange {
  date?: string | null;
  endDate?: string | null;
}

/** 校验通过后的参加时间段：两端都在展会区间内，且 start <= end。 */
export interface AttendanceRange {
  start: string;
  end: string;
}

/** 是否是一个真实存在的 `YYYY-MM-DD`：格式正确，且回查归一化结果没有进位。 */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * 校验报名提交的参加时间段。
 *
 * 两个字段都为空时返回 null（没选，按整段展会处理）；只要提交了一段就必须完整合法。
 * 校验失败抛 `badRequest`，错误码以 `registration.attendance` 开头，前端据此查文案。
 */
export function registrationAttendance(
  input: { attendanceStart?: unknown; attendanceEnd?: unknown } | null | undefined,
  exhibition: ExhibitionDateRange,
): AttendanceRange | null {
  const start = text(input?.attendanceStart);
  const end = text(input?.attendanceEnd);
  if (!start && !end) return null;
  if (!start || !end) {
    throw badRequest('参加时间需要同时填写开始与结束日期', { code: 'registration.attendanceIncomplete' });
  }
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw badRequest('参加时间需要是 YYYY-MM-DD 格式的日期', { code: 'registration.attendanceInvalid' });
  }
  if (start > end) {
    throw badRequest('参加时间的开始日期不能晚于结束日期', { code: 'registration.attendanceOrder' });
  }
  const exhibitionStart = text(exhibition.date);
  const exhibitionEnd = text(exhibition.endDate) || exhibitionStart;
  // 展会日期是必填列，正常不会为空；万一脏数据缺日期就不做区间判断，不把合法报名挡掉。
  if (exhibitionStart && (start < exhibitionStart || end > exhibitionEnd)) {
    const range = exhibitionStart === exhibitionEnd ? exhibitionStart : `${exhibitionStart} ~ ${exhibitionEnd}`;
    throw badRequest(`参加时间需要在展会日期 ${range} 内`, {
      code: 'registration.attendanceOutOfRange',
      params: { range },
    });
  }
  return { start, end };
}
