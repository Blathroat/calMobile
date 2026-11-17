/**
 * 用户 payload 的单元测试：只锁需求 11 碰到的两处口径，其余字段由契约测试覆盖。
 *
 * - 管理员用户列表：最近登录时间缺失时用注册时间兜底，「未知」不再出现；
 * - 登录地区只出现在管理员列表里，个人用户态（`userPayload`）不带，IP 原文任何 payload 都不带。
 */
import assert from 'node:assert/strict';
import { adminUserPayload, userPayload, type AdminUserRow } from './payloads.js';

function adminRow(overrides: Partial<AdminUserRow>): AdminUserRow {
  return {
    id: 'usr-test',
    username: 'tester',
    nickname: '测试用户',
    role: 'user',
    ...overrides,
  };
}

test('管理员用户列表：最近登录时间缺失时用注册时间兜底', () => {
  const payload = adminUserPayload(
    adminRow({ registration_time: '2026-01-02', last_login_time: null, last_login_region: null }),
    0,
  );
  assert.strictEqual(payload.lastLoginTime, '2026-01-02');
  assert.notStrictEqual(payload.lastLoginTime, '');
  assert.strictEqual(payload.lastLoginRegion, '');
});

test('管理员用户列表：有登录时间与地区时原样下发格式化后的地区', () => {
  const payload = adminUserPayload(adminRow({ last_login_time: '2026-11-17', last_login_region: '江苏省苏州市' }), 3);
  assert.strictEqual(payload.lastLoginTime, '2026-11-17');
  assert.strictEqual(payload.lastLoginRegion, '江苏省苏州市');
  assert.strictEqual(payload.order, 3);
});

test('个人用户态不下发登录地区，两个 payload 都不带 IP 原文', () => {
  const admin = adminUserPayload(adminRow({ last_login_time: '2026-11-17', last_login_region: '江苏省苏州市' }), 0);
  assert.strictEqual('lastLoginIp' in admin, false, '管理员列表不能下发登录 IP 原文');
  const self = userPayload(
    {
      id: 'usr-test',
      role: 'user',
      username: 'tester',
      nickname: '测试用户',
      last_login_time: '2026-11-17',
      last_login_region: '江苏省苏州市',
    },
    { register: true, profile: true, exhibitor: false, admin: false, limited: false },
  );
  assert.strictEqual('lastLoginRegion' in self, false, '个人用户态不需要登录地区');
  assert.strictEqual('lastLoginIp' in self, false, '个人用户态不能下发登录 IP 原文');
});
