/**
 * 审核与核销 契约测试。
 *
 * 审核列表五种状态计数、状态流转与状态机、修改已审核报名策略、核销推进到已参加。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { del, get, isoDateAfter, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 审核与核销 ──────────────────────────────────────────────────

test('已参加是终态：本人不能撤销，展商也不能再改', async () => {
  // 自造展会与报名，不依赖其它用例留下的记录（跑完删展会，外键级联清掉报名）。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '终态校验展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(20),
      category: '智能家居',
      status: '无需审核',
      qrEnabled: true,
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    const submitted = await post(
      '/api/v1/registrations',
      {
        exhibitionId,
        visitorName: '终态用例',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：终态用例\n参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const registrationId = submitted.body.registration.id;

    // 展商核销 → 已参加
    const checked = await post(
      '/api/v1/checkin',
      {
        code: `CALMOBILE-CHECKIN|${exhibitionId}|${registrationId}`,
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(checked.body.ok, true, JSON.stringify(checked.body));

    // 本人不能再撤销（出勤记录不能事后抹掉）：业务规则失败走 200 + ok:false
    const cancel = await del(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
    assert.strictEqual(cancel.status, 200, '业务规则失败应当是 200 + ok:false');
    assert.strictEqual(cancel.body.ok, false, `已参加不应允许撤销：${JSON.stringify(cancel.body)}`);
    assert.ok(cancel.body.error.includes('已参加'), cancel.body.error);

    // 展商也不能把它改回别的状态（状态机里已参加是终态）
    const reopen = await put(
      `/api/v1/review/${registrationId}/status`,
      { status: '已通过' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(reopen.status, 200);
    assert.strictEqual(reopen.body.ok, false, `已参加不应允许改回已通过：${JSON.stringify(reopen.body)}`);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('审核列表给出五种状态计数，且只能看自己举办的展会', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-1&status=全部', { token: tokens.exhibitor.token });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.body.records));
  for (const key of ['total', '待审核', '已通过', '已拒绝', '已参加']) {
    assert.strictEqual(typeof list.body.counts[key], 'number', `counts 缺少 ${key}`);
  }
  const pending = await get('/api/v1/review?exhibitionId=exh-1&status=待审核', { token: tokens.exhibitor.token });
  assert.ok(
    pending.body.records.every((item: any) => item.status === '待审核'),
    '筛选项混入了其它状态',
  );

  // 普通用户不能看审核
  const asUser = await get('/api/v1/review?exhibitionId=exh-1', { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);

  // 看一场不存在的展会：拒绝或给出空列表，但不能是 500
  const foreign = await get('/api/v1/review?exhibitionId=exh-not-exist', { token: tokens.exhibitor.token });
  assert.ok([200, 403, 404].includes(foreign.status), `不应是 ${foreign.status}`);
});

test('审核状态可以流转，非法状态被拒', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-2&status=全部', { token: tokens.exhibitor.token });
  const target = list.body.records.find((item: any) => item.status === '待审核');
  assert.ok(target, 'exh-2 应当有待审核的报名');

  const approved = await put(
    `/api/v1/review/${target.id}/status`,
    { status: '已通过' },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));
  assert.strictEqual(approved.body.record.status, '已通过');

  const invalid = await put(
    `/api/v1/review/${target.id}/status`,
    { status: '瞎写的状态' },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(invalid.body.ok, false);

  const asUser = await put(`/api/v1/review/${target.id}/status`, { status: '已拒绝' }, { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);
});

test('审核流转受状态机与「允许修改已审核报名」策略限制', async () => {
  const settingsBefore = await get('/api/v1/settings', { token: tokens.admin.token });
  const originalCanRevise = settingsBefore.body.review.canRevise === true;

  // 自造展会与报名：不碰其它用例共享的展会与报名记录，跑完即删（级联清掉报名）。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '审核流转用例展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(30),
      category: '智能家居',
      status: '需审核',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    await put('/api/v1/settings', { canRevise: false }, { token: tokens.admin.token });

    const submitted = await post(
      '/api/v1/registrations',
      {
        exhibitionId,
        visitorName: '流转用例',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：流转用例\n参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const id = submitted.body.registration.id;
    assert.strictEqual(submitted.body.registration.statusLabel, '待审核');

    // 待审核 → 已通过：canRevise=false 不影响展商的日常审核
    const approved = await put(`/api/v1/review/${id}/status`, { status: '已通过' }, { token: tokens.exhibitor.token });
    assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));

    // canRevise=false：展商不能改已通过的记录（越权 → 403，不是 200 的业务信封）
    const locked = await put(`/api/v1/review/${id}/status`, { status: '已拒绝' }, { token: tokens.exhibitor.token });
    assert.strictEqual(
      locked.status,
      403,
      `展商改已通过的记录应当是 403：${locked.status} ${JSON.stringify(locked.body)}`,
    );
    assert.ok(locked.body.error, '403 要带可展示的原因');

    // 管理员不受这条策略限制，可以在已通过 / 已拒绝之间切换
    const adminReject = await put(`/api/v1/review/${id}/status`, { status: '已拒绝' }, { token: tokens.admin.token });
    assert.strictEqual(adminReject.body.ok, true, JSON.stringify(adminReject.body));
    assert.strictEqual(adminReject.body.record.status, '已拒绝');
    const adminApprove = await put(`/api/v1/review/${id}/status`, { status: '已通过' }, { token: tokens.admin.token });
    assert.strictEqual(adminApprove.body.ok, true, JSON.stringify(adminApprove.body));

    // 管理员开放修改后，展商可以继续流转：已通过 → 已参加
    await put('/api/v1/settings', { canRevise: true }, { token: tokens.admin.token });
    const attended = await put(`/api/v1/review/${id}/status`, { status: '已参加' }, { token: tokens.exhibitor.token });
    assert.strictEqual(attended.body.ok, true, JSON.stringify(attended.body));
    assert.strictEqual(attended.body.record.status, '已参加');

    // 已参加是终态：非法流转是业务规则失败，走 HTTP 200 + { ok:false } 信封
    const illegal = await put(`/api/v1/review/${id}/status`, { status: '已通过' }, { token: tokens.exhibitor.token });
    assert.strictEqual(illegal.status, 200, '非法流转应当是业务失败，而不是权限失败');
    assert.strictEqual(illegal.body.ok, false, '已参加 → 已通过 必须被拒');
    assert.ok(illegal.body.error.includes('已参加'), illegal.body.error);

    const adminIllegal = await put(`/api/v1/review/${id}/status`, { status: '已拒绝' }, { token: tokens.admin.token });
    assert.strictEqual(adminIllegal.body.ok, false, '管理员同样受状态机约束：已参加不能改成别的');
  } finally {
    await put('/api/v1/settings', { canRevise: originalCanRevise }, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('核销把已通过推进为已参加，重复核销与非法码都有明确提示', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-1&status=已通过', { token: tokens.exhibitor.token });
  const approved = list.body.records[0];
  assert.ok(approved, 'exh-1 应当有已通过的报名');
  assert.ok(list.body.records.some((item: { visitorRole?: string }) => item.visitorRole === 'exhibitor'));
  assert.ok(list.body.records.some((item: { visitorRole?: string }) => item.visitorRole === 'user'));

  const first = await post(
    '/api/v1/checkin',
    { code: `CALMOBILE-CHECKIN|exh-1|${approved.id}` },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(first.body.ok, true, `首次核销应当成功：${JSON.stringify(first.body)}`);
  assert.strictEqual(first.body.status, '已参加');
  assert.ok(first.body.record.visitorName, '核销结果要带报名人信息');

  const again = await post(
    '/api/v1/checkin',
    { code: `CALMOBILE-CHECKIN|exh-1|${approved.id}` },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(again.body.ok, false);
  assert.strictEqual(again.body.duplicated, true);
  assert.ok(again.body.error.includes('已经核销'), again.body.error);

  const unknown = await post('/api/v1/checkin', { code: 'NOT-A-CODE' }, { token: tokens.exhibitor.token });
  assert.strictEqual(unknown.body.ok, false);
  assert.ok(unknown.body.error.includes('无法识别'), unknown.body.error);

  // 待审核的报名不能核销
  const pendingList = await get('/api/v1/review?exhibitionId=exh-2&status=待审核', { token: tokens.exhibitor.token });
  if (pendingList.body.records.length > 0) {
    const pending = pendingList.body.records[0];
    const rejected = await post(
      '/api/v1/checkin',
      { code: `CALMOBILE-CHECKIN|exh-2|${pending.id}` },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(rejected.body.ok, false);
    assert.ok(rejected.body.error.includes('待审核'), rejected.body.error);
  }

  const anonymous = await post('/api/v1/checkin', { code: 'CALMOBILE-CHECKIN|exh-1|reg-1' });
  assert.strictEqual(anonymous.status, 401);
});
