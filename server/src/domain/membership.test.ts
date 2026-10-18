/**
 * 展商会员时长：天数夹取、到期边界与只读展示。不连数据库。
 */
import assert from 'node:assert/strict';
import {
  MEMBERSHIP_MAX_DAYS,
  clampDurationDays,
  effectiveRole,
  isMembershipExpired,
  isPastExpiry,
} from './membership.js';

test('天数夹到 0..3650，非数字按永久处理', () => {
  assert.strictEqual(clampDurationDays(undefined), 0);
  assert.strictEqual(clampDurationDays(''), 0);
  assert.strictEqual(clampDurationDays('abc'), 0);
  assert.strictEqual(clampDurationDays(-5), 0);
  assert.strictEqual(clampDurationDays('30'), 30);
  assert.strictEqual(clampDurationDays(3650), 3650);
  assert.strictEqual(clampDurationDays(3651), MEMBERSHIP_MAX_DAYS);
  assert.strictEqual(clampDurationDays(999999), MEMBERSHIP_MAX_DAYS);
});

test('到期边界：NULL 永久，正好到期算已过期', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  assert.strictEqual(isPastExpiry(null, now), false);
  assert.strictEqual(isPastExpiry('', now), false);
  assert.strictEqual(isPastExpiry('2026-10-18T12:00:01.000Z', now), false);
  assert.strictEqual(isPastExpiry('2026-10-18T12:00:00.000Z', now), true);
  assert.strictEqual(isPastExpiry('2026-10-18T11:59:59.000Z', now), true);
  assert.strictEqual(isPastExpiry('not-a-date', now), false, '脏数据不能当成已过期');
});

test('只有限时展商参与到期判断，管理员与普通用户不受影响', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  const past = '2026-01-01T00:00:00.000Z';
  assert.strictEqual(isMembershipExpired('exhibitor', past, now), true);
  assert.strictEqual(isMembershipExpired('exhibitor', null, now), false);
  assert.strictEqual(isMembershipExpired('admin', past, now), false);
  assert.strictEqual(isMembershipExpired('user', past, now), false);
  assert.strictEqual(effectiveRole('exhibitor', past, now), 'user');
  assert.strictEqual(effectiveRole('exhibitor', null, now), 'exhibitor');
  assert.strictEqual(effectiveRole('admin', past, now), 'admin');
  assert.strictEqual(effectiveRole(undefined, null, now), '');
});
