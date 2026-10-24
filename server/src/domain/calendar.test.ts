/**
 * 首页缺省选中日：当前月落在今天以后第一个有活动的日子，本月没有就今天；
 * 其它月份仍落在该月第一个有活动的日子。
 */
import assert from 'node:assert/strict';
import { defaultCalendarDay } from './calendar.js';

const today = { year: 2026, month: 10, day: 24 };

function pick(month: number, activityDays: unknown[]): number {
  return defaultCalendarDay({ year: 2026, month, today, activityDays });
}

test('当前月取今天及以后第一个有活动的日子', () => {
  assert.equal(pick(10, [3, 20, 25, 31]), 25);
  assert.equal(pick(10, ['3', '25', 25, 31]), 25, '字符串与重复日期都要收成同一个数字');
});

test('今天有活动就落在今天', () => {
  assert.equal(pick(10, [24, 30]), 24);
});

test('本月只剩已经过去的活动时落在今天，不只高亮过去的日子', () => {
  assert.equal(pick(10, [3, 20]), 24);
});

test('本月没有任何活动时落在今天', () => {
  assert.equal(pick(10, []), 24);
});

test('其它月份仍取第一个有活动的日子，没有就不选中', () => {
  assert.equal(pick(11, [3, 9]), 3);
  assert.equal(pick(11, []), 0);
});
