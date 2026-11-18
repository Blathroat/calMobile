/**
 * 「最近登录」的刷新口径（契约测试）。
 *
 * 管理端用户卡片显示的是**最近一次**登录的时间与 IP 归属地区，所以每次真正建立会话
 * 的登录都要重新写这一组字段，不能只在第一次或注册时写一次。地区由离线 xdb 解析，
 * 本机来源是回环地址，统一记成「内网」。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { createVerifiedAccount, get, post, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

const USER_ID = 'usr-login-record';

/** 读用户行上的最近登录记录。 */
async function loginRecord() {
  const result = await pool.query<{
    last_login_time: Date | null;
    last_login_ip: string;
    last_login_region: string;
  }>('SELECT last_login_time, last_login_ip, last_login_region FROM users WHERE id = $1', [USER_ID]);
  return result.rows[0];
}

/** 把记录改成一个明显过期的值：紧跟着的那次登录必须把它重新写回来。 */
async function ageLoginRecord(): Promise<void> {
  await pool.query(
    "UPDATE users SET last_login_time = '2020-01-01T00:00:00Z', last_login_ip = '', last_login_region = '' WHERE id = $1",
    [USER_ID],
  );
}

/** 登录一次并断言成功，返回会话里的用户。 */
async function loginOnce(deviceName: string): Promise<Record<string, any>> {
  const response = await post('/api/v1/auth/login', {
    username: 'loginrecord',
    password: 'password',
    deviceName,
  });
  assert.strictEqual(response.status, 200, `登录失败：${JSON.stringify(response.body)}`);
  assert.strictEqual(response.body.ok, true, `登录失败：${JSON.stringify(response.body)}`);
  return response.body;
}

test('每次登录都刷新最近登录的时间、IP 与地区', async () => {
  await createVerifiedAccount(USER_ID, 'loginrecord', 'loginrecord@example.com');
  try {
    // 第一次登录
    await ageLoginRecord();
    await loginOnce('第一次');
    const afterFirst = await loginRecord();
    assert.ok(afterFirst?.last_login_time, '登录成功要写最近登录时间');
    assert.ok(afterFirst.last_login_time.getTime() > Date.parse('2021-01-01'), '旧的登录时间要被换成这一次的时间');
    assert.strictEqual(afterFirst.last_login_ip, '127.0.0.1', '要记下这一次的客户端 IP');
    assert.strictEqual(afterFirst.last_login_region, '内网', '本机来源是回环地址，地区记成内网');

    // 第二次登录：记录必须再次被写回，而不是只在第一次登录时写。
    await ageLoginRecord();
    await loginOnce('第二次');
    const afterSecond = await loginRecord();
    assert.ok(afterSecond?.last_login_time, '第二次登录也要写最近登录时间');
    assert.ok(afterSecond.last_login_time.getTime() > Date.parse('2021-01-01'), '每次登录都要刷新最近登录时间');
    assert.strictEqual(afterSecond.last_login_region, '内网', '每次登录都要刷新最近登录地区');

    // 管理端的用户列表下发同一份记录：卡片上的「最近登录」才跟着更新。
    const list = await get('/api/v1/users?query=loginrecord', { token: tokens.admin.token });
    assert.strictEqual(list.body instanceof Array, true, `用户列表形状不对：${JSON.stringify(list.body)}`);
    const row = (list.body as Record<string, any>[]).find((item) => item.id === USER_ID);
    assert.ok(row, '管理端用户列表里应当有刚登录的账号');
    assert.strictEqual(row.lastLoginRegion, '内网');
    assert.ok(row.lastLoginTime && row.lastLoginTime !== '2020-01-01', '列表里的最近登录时间也要是这一次的');
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID]);
  }
});
