/**
 * 报名参加时间段：两端必填、顺序、合法日期与展会区间。不连数据库。
 */
import assert from 'node:assert/strict';
import { registrationAttendance } from './registration-attendance.js';

const EXHIBITION = { date: '2026-09-20', endDate: '2026-09-23' };

/** 断言抛出的是业务错误：文案与稳定错误码都要对得上。 */
function rejected(input: { attendanceStart?: unknown; attendanceEnd?: unknown }, code: string, message: string): void {
  assert.throws(
    () => registrationAttendance(input, EXHIBITION),
    (error: { errorCode?: string; message?: string } | null) => {
      assert.strictEqual(error?.errorCode, code);
      assert.ok(String(error?.message).includes(message), `提示应包含「${message}」：${error?.message}`);
      return true;
    },
  );
}

test('两端都空表示没选，返回 null', () => {
  assert.strictEqual(registrationAttendance({}, EXHIBITION), null);
  assert.strictEqual(registrationAttendance({ attendanceStart: '', attendanceEnd: '  ' }, EXHIBITION), null);
  assert.strictEqual(registrationAttendance(null, EXHIBITION), null);
});

test('只填一端被拒绝', () => {
  rejected({ attendanceStart: '2026-09-21' }, 'registration.attendanceIncomplete', '同时填写');
  rejected({ attendanceEnd: '2026-09-22' }, 'registration.attendanceIncomplete', '同时填写');
});

test('非法日期与开始晚于结束被拒绝', () => {
  rejected(
    { attendanceStart: '2026-9-21', attendanceEnd: '2026-09-22' },
    'registration.attendanceInvalid',
    'YYYY-MM-DD',
  );
  rejected(
    { attendanceStart: '2026-02-30', attendanceEnd: '2026-03-01' },
    'registration.attendanceInvalid',
    'YYYY-MM-DD',
  );
  rejected({ attendanceStart: '2026-09-22', attendanceEnd: '2026-09-21' }, 'registration.attendanceOrder', '不能晚于');
});

test('超出展会区间：文案带上展会区间', () => {
  rejected(
    { attendanceStart: '2026-09-19', attendanceEnd: '2026-09-21' },
    'registration.attendanceOutOfRange',
    '2026-09-20 ~ 2026-09-23',
  );
  rejected(
    { attendanceStart: '2026-09-22', attendanceEnd: '2026-09-24' },
    'registration.attendanceOutOfRange',
    '2026-09-20 ~ 2026-09-23',
  );
  assert.deepStrictEqual(
    registrationAttendance({ attendanceStart: '2026-09-20', attendanceEnd: '2026-09-23' }, EXHIBITION),
    {
      start: '2026-09-20',
      end: '2026-09-23',
    },
  );
});

test('单日展会只允许两端都等于开展日', () => {
  const single = { date: '2026-09-20', endDate: '' };
  assert.deepStrictEqual(
    registrationAttendance({ attendanceStart: '2026-09-20', attendanceEnd: '2026-09-20' }, single),
    {
      start: '2026-09-20',
      end: '2026-09-20',
    },
  );
  assert.throws(
    () => registrationAttendance({ attendanceStart: '2026-09-20', attendanceEnd: '2026-09-21' }, single),
    (error: { errorCode?: string } | null) => error?.errorCode === 'registration.attendanceOutOfRange',
  );
});
