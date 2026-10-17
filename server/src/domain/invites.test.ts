/**
 * 邀请码状态与规范化。不连数据库。
 */
import assert from 'node:assert/strict';
import { inviteStatus, normalizeInviteCode } from './invites.js';

test('规范化只去空白并转大写', () => {
  assert.strictEqual(normalizeInviteCode('  ab12cd  '), 'AB12CD');
  assert.strictEqual(normalizeInviteCode(''), '');
  assert.strictEqual(normalizeInviteCode('  '), '');
});

test('作废、过期、用完按这个顺序判定', () => {
  const base = {
    id: 'inv-1',
    code: 'ABCDEFGH',
    max_uses: 2,
    used_count: 2,
    expires_at: '2000-01-01T00:00:00.000Z',
    created_at: '2000-01-01T00:00:00.000Z',
    revoked_at: '2000-01-02T00:00:00.000Z',
  };
  assert.strictEqual(inviteStatus(base), 'revoked');
  assert.strictEqual(inviteStatus({ ...base, revoked_at: null }), 'expired');
  assert.strictEqual(inviteStatus({ ...base, revoked_at: null, expires_at: null }), 'exhausted');
  assert.strictEqual(inviteStatus({ ...base, revoked_at: null, expires_at: null, used_count: 1 }), 'available');
});
