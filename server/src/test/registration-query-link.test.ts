/**
 * 报名站分享链接 契约测试。
 *
 * 未登录（匿名）报名：只收姓名与收集项答案，提交后发一条只出现一次的查询凭据；
 * 凭据能查到自己的报名与报名码，库里只存 sha256 哈希；登录后可以把这条报名认领到账号。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { createVerifiedAccount, get, login, post, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/** 匿名报名要用满足展会收集项的答案（示例展会的收集项都一样）。 */
function answersFor(name: string): string {
  return `姓名 / 公司名称：${name}\n参观身份：专业观众`;
}

/** 在开放报名的展会上做一次匿名报名，返回完整响应体。 */
async function anonymousRegister(exhibitionId: string, name: string, answers = answersFor(name)) {
  return post('/api/v1/registrations', { exhibitionId, visitorName: name, answers });
}

test('匿名报名生成一次性查询凭据，凭据能查到这条报名', async () => {
  const created = await anonymousRegister('exh-2', '匿名访客甲');
  assert.strictEqual(created.status, 200, JSON.stringify(created.body));
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  assert.strictEqual(created.body.autoApproved, false, '需审核的展会不应自动通过');
  assert.strictEqual(created.body.statusLabel, '待审核');

  // 明文凭据只在创建响应里出现一次：43 个 base64url 字符（32 字节）。
  const token = String(created.body.queryToken || '');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, `查询凭据形状不对：${token}`);
  assert.strictEqual(created.body.registration.visitorName, '匿名访客甲');
  assert.strictEqual(created.body.registration.visitorType, 'guest', '匿名报名的身份记为访客');

  // 库里只有哈希，且这条报名没有 visitor_id。
  const stored = await pool.query<{ query_token_hash: string; visitor_id: string | null }>(
    'SELECT query_token_hash, visitor_id FROM registrations WHERE id = $1',
    [created.body.registration.id],
  );
  assert.strictEqual(stored.rows[0]?.visitor_id, null, '匿名报名不应关联账号');
  assert.match(stored.rows[0]?.query_token_hash ?? '', /^[0-9a-f]{64}$/, '库里应存 sha256 十六进制');
  assert.notStrictEqual(stored.rows[0]?.query_token_hash, token, '库里不能存明文凭据');

  // 凭据能查到与 GET /registrations/:id 同形的响应，且公开、不缓存。
  const queried = await get(`/api/v1/registrations/query/${token}`);
  assert.strictEqual(queried.status, 200);
  assert.strictEqual(queried.body.found, true, JSON.stringify(queried.body));
  assert.strictEqual(queried.body.registration.id, created.body.registration.id);
  assert.strictEqual(queried.body.registration.visitorName, '匿名访客甲');
  assert.strictEqual(queried.body.registration.answers, created.body.registration.answers);
  assert.strictEqual(queried.headers?.['cache-control'], 'no-store');

  // 无效凭据：HTTP 200 + found:false + 稳定错误码，与「查不到」同形，不暴露凭据是否存在。
  const invalid = await get('/api/v1/registrations/query/not-a-real-token');
  assert.strictEqual(invalid.status, 200);
  assert.strictEqual(invalid.body.found, false);
  assert.strictEqual(invalid.body.errorCode, 'registration.queryLinkInvalid');
  assert.ok(invalid.body.error.includes('查询链接无效'), invalid.body.error);
});

test('匿名报名仍受展会状态、报名窗口、姓名与收集项校验约束', async () => {
  // 仅展示的展会不接受报名
  const display = await anonymousRegister('exh-4', '匿名访客');
  assert.strictEqual(display.body.ok, false);
  assert.ok(display.body.error.includes('仅展示'), display.body.error);

  // 已截止报名的展会
  const closed = await anonymousRegister('exh-3', '匿名访客');
  assert.strictEqual(closed.body.ok, false);

  // 姓名必填
  const missingName = await post('/api/v1/registrations', { exhibitionId: 'exh-2', answers: '' });
  assert.strictEqual(missingName.status, 200);
  assert.strictEqual(missingName.body.ok, false);
  assert.ok(missingName.body.error.includes('请输入姓名'), missingName.body.error);

  // 姓名上限沿用管理员配置的昵称长度（默认 20）
  const tooLong = await anonymousRegister('exh-2', '甲'.repeat(21));
  assert.strictEqual(tooLong.body.ok, false);
  assert.ok(tooLong.body.error.includes('姓名最多'), tooLong.body.error);

  // 收集项的必填校验与登录报名一致
  const emptyAnswers = await anonymousRegister('exh-2', '匿名访客乙', '');
  assert.strictEqual(emptyAnswers.body.ok, false);
  assert.ok(emptyAnswers.body.error.includes('请填写「姓名 / 公司名称」'), emptyAnswers.body.error);
});

test('登录报名不生成查询凭据，应用内行为不变', async () => {
  const created = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-2',
      visitorName: '管理员报名',
      visitorType: 'admin',
      answers: answersFor('管理员报名'),
    },
    { token: tokens.admin.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  assert.strictEqual(created.body.queryToken, undefined, '登录报名不应下发查询凭据');
  assert.strictEqual(created.body.registration.visitorType, 'admin');
});

test('带着失效令牌的报名不会降级成匿名报名', async () => {
  // 应用内的报名请求总是带令牌：令牌过期时后端必须回 401 让前端刷新 / 重新登录，
  // 不能把它当成匿名报名（那样记录不属于任何账号，用户在自己的列表里看不到）。
  const expired = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-2',
      visitorName: '过期令牌',
      visitorType: 'user',
      answers: answersFor('过期令牌'),
    },
    { token: 'definitely-not-a-valid-access-token' },
  );
  assert.strictEqual(expired.status, 401, JSON.stringify(expired.body));
  const created = await pool.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM registrations WHERE visitor_name = '过期令牌'",
  );
  assert.strictEqual(created.rows[0]?.total, 0, '失效令牌不应留下匿名报名');
});

test('登录后可以认领匿名报名，重复认领幂等，别人已认领则拒绝', async () => {
  // 认领用干净账号：示例账号在示例展会上都已经有报名，会和认领冲突。
  await createVerifiedAccount('join-claim-a', 'joinclaima', 'join-claim-a@example.com');
  await createVerifiedAccount('join-claim-b', 'joinclaimb', 'join-claim-b@example.com');
  const first = await login('joinclaima');
  const second = await login('joinclaimb');

  const created = await anonymousRegister('exh-2', '匿名访客丙');
  const token = String(created.body.queryToken || '');
  const registrationId = String(created.body.registration.id);

  // 未登录不能认领
  const anonymousClaim = await post('/api/v1/registrations/claim', { token });
  assert.strictEqual(anonymousClaim.status, 401);

  // 第一次认领：关联到当前账号
  const claimed = await post('/api/v1/registrations/claim', { token }, { token: first.token });
  assert.strictEqual(claimed.status, 200);
  assert.strictEqual(claimed.body.ok, true, JSON.stringify(claimed.body));
  assert.strictEqual(claimed.body.claimed, true);
  assert.strictEqual(claimed.body.registration.id, registrationId);
  assert.strictEqual(claimed.body.registration.visitorName, '匿名访客丙', '认领保留匿名报名时填的姓名');

  // 认领后进入「我的活动」，本人可以打开报名详情
  const mine = await get('/api/v1/registrations', { token: first.token });
  assert.ok(
    mine.body.some((item: { id: string }) => item.id === registrationId),
    '认领后的报名应出现在我的活动',
  );
  const detail = await get(`/api/v1/registrations/${registrationId}`, { token: first.token });
  assert.strictEqual(detail.body.found, true, JSON.stringify(detail.body));

  // 查询链接在认领后仍然有效：保存了链接的人还能继续用它看状态。
  const byToken = await get(`/api/v1/registrations/query/${token}`);
  assert.strictEqual(byToken.body.found, true);

  // 重复认领：幂等成功
  const again = await post('/api/v1/registrations/claim', { token }, { token: first.token });
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.ok, true, JSON.stringify(again.body));
  assert.strictEqual(again.body.claimed, false, '已属于当前账号时不算新认领');

  // 别的账号再认领：明确文案，不是 4xx
  const other = await post('/api/v1/registrations/claim', { token }, { token: second.token });
  assert.strictEqual(other.status, 200);
  assert.strictEqual(other.body.ok, false);
  assert.ok(other.body.error.includes('已关联到其他账号'), other.body.error);

  // 无效凭据
  const invalid = await post('/api/v1/registrations/claim', { token: 'nope' }, { token: first.token });
  assert.strictEqual(invalid.status, 200);
  assert.strictEqual(invalid.body.ok, false);
  assert.strictEqual(invalid.body.errorCode, 'registration.queryLinkInvalid');
});

test('认领与账号在本展会的已有报名冲突、以及已撤销报名仍可认领', async () => {
  await createVerifiedAccount('join-conflict', 'joinconflict', 'join-conflict@example.com');
  const account = await login('joinconflict');

  // 同一个账号先有这一场的报名（登录报名）
  const own = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-2',
      visitorName: '已有报名',
      visitorType: 'user',
      answers: answersFor('已有报名'),
    },
    { token: account.token },
  );
  assert.strictEqual(own.body.ok, true, JSON.stringify(own.body));

  // 再把同展会的匿名报名认领到同一账号：唯一索引拒绝，给与登录报名相同的文案
  const anonymous = await anonymousRegister('exh-2', '匿名访客丁');
  const conflict = await post(
    '/api/v1/registrations/claim',
    { token: anonymous.body.queryToken },
    { token: account.token },
  );
  assert.strictEqual(conflict.status, 200);
  assert.strictEqual(conflict.body.ok, false, JSON.stringify(conflict.body));
  assert.ok(conflict.body.error.includes('已提交过该展会的报名'), conflict.body.error);
  assert.strictEqual(conflict.body.errorCode, 'registration.duplicate');

  // 已撤销的匿名报名仍允许认领（进历史，不会与未撤销报名冲突）
  const cancelled = await anonymousRegister('exh-2', '匿名访客戊');
  await pool.query("UPDATE registrations SET status = 'cancelled' WHERE id = $1", [cancelled.body.registration.id]);
  const claimCancelled = await post(
    '/api/v1/registrations/claim',
    { token: cancelled.body.queryToken },
    { token: account.token },
  );
  assert.strictEqual(claimCancelled.status, 200);
  assert.strictEqual(claimCancelled.body.ok, true, JSON.stringify(claimCancelled.body));
  assert.strictEqual(claimCancelled.body.registration.statusCode, 'cancelled');
});
