/**
 * 审核与核销 契约测试。
 *
 * 审核列表五种状态计数、状态流转与状态机、修改已审核报名策略、已参加退回策略、核销推进到已参加。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import {
  del,
  get,
  isoDateAfter,
  post,
  put,
  registrationCode,
  startContract,
  stopContract,
  tokens,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 审核与核销 ──────────────────────────────────────────────────

test('已参加默认是终态：本人不能撤销，展商默认也不能再改', async () => {
  // 自造展会与报名，不依赖其它用例留下的记录（跑完删展会，外键级联清掉报名）。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '终态校验展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(20),
      category: '智能家居',
      status: 'optional',
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
    // 报名码带可轮换凭据，不能按 id 手拼：直接用报名接口下发的那一个。
    const code = String(submitted.body.registration.checkInCode);

    // 展商核销 → 已参加
    const checked = await post('/api/v1/checkin', { code }, { token: tokens.exhibitor.token });
    assert.strictEqual(checked.body.ok, true, JSON.stringify(checked.body));

    // 本人不能再撤销（出勤记录不能事后抹掉）：业务规则失败走 200 + ok:false
    const cancel = await del(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
    assert.strictEqual(cancel.status, 200, '业务规则失败应当是 200 + ok:false');
    assert.strictEqual(cancel.body.ok, false, `已参加不应允许撤销：${JSON.stringify(cancel.body)}`);
    assert.ok(cancel.body.error.includes('已参加'), cancel.body.error);

    // 展商默认不能把它改回别的状态：`canReviseAttended` 默认关闭 → 权限失败（403）。
    // 打开后的行为见「已参加能否退回由…单独控制」那条用例。
    const reopen = await put(
      `/api/v1/review/${registrationId}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(
      reopen.status,
      403,
      `未开放修改已参加时应当是 403：${reopen.status} ${JSON.stringify(reopen.body)}`,
    );
    assert.ok(reopen.body.error.includes('已参加'), reopen.body.error);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('审核列表给出五种状态计数，且只能看自己举办的展会', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-1&status=all', { token: tokens.exhibitor.token });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.body.records));
  for (const key of ['total', 'pending', 'approved', 'rejected', 'attended']) {
    assert.strictEqual(typeof list.body.counts[key], 'number', `counts 缺少 ${key}`);
  }
  const pending = await get('/api/v1/review?exhibitionId=exh-1&status=pending', { token: tokens.exhibitor.token });
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
  const list = await get('/api/v1/review?exhibitionId=exh-2&status=all', { token: tokens.exhibitor.token });
  const target = list.body.records.find((item: any) => item.status === '待审核');
  assert.ok(target, 'exh-2 应当有待审核的报名');

  const approved = await put(
    `/api/v1/review/${target.id}/status`,
    { status: 'approved' },
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

  const asUser = await put(`/api/v1/review/${target.id}/status`, { status: 'rejected' }, { token: tokens.user.token });
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
      status: 'review',
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
    const approved = await put(
      `/api/v1/review/${id}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));

    // canRevise=false：展商不能改已通过的记录（越权 → 403，不是 200 的业务信封）
    const locked = await put(`/api/v1/review/${id}/status`, { status: 'rejected' }, { token: tokens.exhibitor.token });
    assert.strictEqual(
      locked.status,
      403,
      `展商改已通过的记录应当是 403：${locked.status} ${JSON.stringify(locked.body)}`,
    );
    assert.ok(locked.body.error, '403 要带可展示的原因');

    // 管理员不受这条策略限制，可以在已通过 / 已拒绝之间切换
    const adminReject = await put(`/api/v1/review/${id}/status`, { status: 'rejected' }, { token: tokens.admin.token });
    assert.strictEqual(adminReject.body.ok, true, JSON.stringify(adminReject.body));
    assert.strictEqual(adminReject.body.record.status, '已拒绝');
    const adminApprove = await put(
      `/api/v1/review/${id}/status`,
      { status: 'approved' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(adminApprove.body.ok, true, JSON.stringify(adminApprove.body));

    // 管理员开放修改已审核报名后，展商可以继续流转：已通过 → 已参加
    await put('/api/v1/settings', { canRevise: true }, { token: tokens.admin.token });
    const attended = await put(
      `/api/v1/review/${id}/status`,
      { status: 'attended' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(attended.body.ok, true, JSON.stringify(attended.body));
    assert.strictEqual(attended.body.record.status, '已参加');

    // 已参加另有独立开关（见专门用例）：这里没打开，展商退回是权限失败（403），不是业务信封
    const attendedLocked = await put(
      `/api/v1/review/${id}/status`,
      { status: 'approved' },
      {
        token: tokens.exhibitor.token,
      },
    );
    assert.strictEqual(
      attendedLocked.status,
      403,
      `未开放修改已参加时应当是 403：${attendedLocked.status} ${JSON.stringify(attendedLocked.body)}`,
    );
    assert.ok(attendedLocked.body.error.includes('已参加'), attendedLocked.body.error);

    // 管理员始终可以改：已参加 → 已拒绝 是合法流转
    const adminRevoke = await put(`/api/v1/review/${id}/status`, { status: 'rejected' }, { token: tokens.admin.token });
    assert.strictEqual(adminRevoke.body.ok, true, JSON.stringify(adminRevoke.body));
    assert.strictEqual(adminRevoke.body.record.status, '已拒绝');

    // 状态机仍然拦非法流转（管理员也一样）：已拒绝 → 待审核 不在允许列表里
    const illegal = await put(`/api/v1/review/${id}/status`, { status: 'pending' }, { token: tokens.admin.token });
    assert.strictEqual(illegal.status, 200, '非法流转应当是业务失败，而不是权限失败');
    assert.strictEqual(illegal.body.ok, false, '已拒绝 → 待审核 必须被拒');
  } finally {
    await put('/api/v1/settings', { canRevise: originalCanRevise }, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('已参加能否退回由「允许修改已参加的报名」单独控制', async () => {
  const settingsBefore = await get('/api/v1/settings', { token: tokens.admin.token });
  const originalCanReviseAttended = settingsBefore.body.review.canReviseAttended === true;
  // 这条策略默认关闭；显式写一次，避免受文件里其它用例的开关状态影响。
  await put('/api/v1/settings', { canReviseAttended: false }, { token: tokens.admin.token });

  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '已参加退回用例展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(25),
      category: '智能家居',
      status: 'optional',
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
        visitorName: '退回用例',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：退回用例\n参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const id = submitted.body.registration.id;

    // 核销 → 已参加，并记下核销时间（码取报名接口下发的那一个）
    const code = String(submitted.body.registration.checkInCode);
    const checked = await post('/api/v1/checkin', { code }, { token: tokens.exhibitor.token });
    assert.strictEqual(checked.body.ok, true, JSON.stringify(checked.body));
    const checkedRow = await pool.query<{ check_in_time: Date | null }>(
      'SELECT check_in_time FROM registrations WHERE id = $1',
      [id],
    );
    assert.ok(checkedRow.rows[0]?.check_in_time, '核销后应当记下核销时间');

    // 默认关闭：展商改已参加是权限失败（403），且记录原封不动
    const locked = await put(`/api/v1/review/${id}/status`, { status: 'approved' }, { token: tokens.exhibitor.token });
    assert.strictEqual(locked.status, 403, `默认关闭时应当是 403：${locked.status} ${JSON.stringify(locked.body)}`);
    assert.ok(locked.body.error.includes('已参加'), locked.body.error);
    const untouched = await pool.query<{ status: string; check_in_time: Date | null }>(
      'SELECT status, check_in_time FROM registrations WHERE id = $1',
      [id],
    );
    assert.strictEqual(untouched.rows[0]?.status, 'attended', '403 不能改到记录');
    assert.ok(untouched.rows[0]?.check_in_time, '403 不能清掉核销时间');

    // 打开后：展商可以把已参加退回已通过，核销时间同时清空
    // （核销时间是「曾经核销」的事实，状态退回后不该再挂着）
    await put('/api/v1/settings', { canReviseAttended: true }, { token: tokens.admin.token });
    const reopened = await put(
      `/api/v1/review/${id}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(reopened.body.ok, true, JSON.stringify(reopened.body));
    assert.strictEqual(reopened.body.record.status, '已通过');
    const cleared = await pool.query<{ status: string; check_in_time: Date | null }>(
      'SELECT status, check_in_time FROM registrations WHERE id = $1',
      [id],
    );
    assert.strictEqual(cleared.rows[0]?.status, 'approved');
    assert.strictEqual(cleared.rows[0]?.check_in_time, null, '退回后核销时间必须清空');

    // 退回已通过时凭据轮换：旧码不该再能核销，新码可以
    const rotated = await registrationCode(id, tokens.user.token);
    assert.notStrictEqual(rotated, code, '退回已通过后必须换新报名码');

    // 再次核销回到已参加，验证关闭开关后管理员不受这条策略限制
    const again = await post('/api/v1/checkin', { code: rotated }, { token: tokens.exhibitor.token });
    assert.strictEqual(again.body.ok, true, JSON.stringify(again.body));
    await put('/api/v1/settings', { canReviseAttended: false }, { token: tokens.admin.token });
    const adminChange = await put(
      `/api/v1/review/${id}/status`,
      { status: 'rejected' },
      {
        token: tokens.admin.token,
      },
    );
    assert.strictEqual(adminChange.body.ok, true, `管理员应当始终可以改：${JSON.stringify(adminChange.body)}`);
    assert.strictEqual(adminChange.body.record.status, '已拒绝');
  } finally {
    await put('/api/v1/settings', { canReviseAttended: originalCanReviseAttended }, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('核销把已通过推进为已参加，重复核销与非法码都有明确提示', async () => {
  const list = await get('/api/v1/review?exhibitionId=exh-1&status=approved', { token: tokens.exhibitor.token });
  const approved = list.body.records[0];
  assert.ok(approved, 'exh-1 应当有已通过的报名');
  assert.ok(list.body.records.some((item: { visitorRole?: string }) => item.visitorRole === 'exhibitor'));
  assert.ok(list.body.records.some((item: { visitorRole?: string }) => item.visitorRole === 'user'));

  // 报名码带可轮换凭据，取接口下发的那一个（管理员能看任意一条报名详情）。
  const code = await registrationCode(approved.id, tokens.admin.token);

  const first = await post('/api/v1/checkin', { code }, { token: tokens.exhibitor.token });
  assert.strictEqual(first.body.ok, true, `首次核销应当成功：${JSON.stringify(first.body)}`);
  assert.strictEqual(first.body.status, '已参加');
  assert.ok(first.body.record.visitorName, '核销结果要带报名人信息');

  const again = await post('/api/v1/checkin', { code }, { token: tokens.exhibitor.token });
  assert.strictEqual(again.body.ok, false);
  assert.strictEqual(again.body.duplicated, true);
  assert.ok(again.body.error.includes('已经核销'), again.body.error);

  const unknown = await post('/api/v1/checkin', { code: 'NOT-A-CODE' }, { token: tokens.exhibitor.token });
  assert.strictEqual(unknown.body.ok, false);
  assert.ok(unknown.body.error.includes('无法识别'), unknown.body.error);

  // 状态不允许核销：自造一场需审核的展会，拿到码后把报名改判成已拒绝。
  // 凭据只在「退回已参加」时轮换，因此这个码格式有效，只会撞到状态判断。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '核销状态校验展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(22),
      category: '智能家居',
      status: 'review',
      qrEnabled: true,
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const statusExhibitionId = created.body.exhibition.id;

  try {
    const submitted = await post(
      '/api/v1/registrations',
      {
        exhibitionId: statusExhibitionId,
        visitorName: '状态校验用例',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：状态校验用例\n参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const statusRegistrationId = submitted.body.registration.id;

    // 待审核 → 已通过（展商日常审核），这时才有码下发
    const approvedAgain = await put(
      `/api/v1/review/${statusRegistrationId}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(approvedAgain.body.ok, true, JSON.stringify(approvedAgain.body));
    const statusCode = await registrationCode(statusRegistrationId, tokens.admin.token);

    // 已通过 → 已拒绝 用管理员（展商默认没有改已通过报名的权限），凭据不轮换
    const rejectedStatus = await put(
      `/api/v1/review/${statusRegistrationId}/status`,
      { status: 'rejected' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(rejectedStatus.body.ok, true, JSON.stringify(rejectedStatus.body));

    const rejected = await post('/api/v1/checkin', { code: statusCode }, { token: tokens.exhibitor.token });
    assert.strictEqual(rejected.body.ok, false);
    assert.ok(rejected.body.error.includes('已拒绝'), rejected.body.error);
  } finally {
    await del(`/api/v1/exhibitions/${statusExhibitionId}`, { token: tokens.exhibitor.token });
  }

  const anonymous = await post('/api/v1/checkin', { code });
  assert.strictEqual(anonymous.status, 401);
});

test('已参加退回已通过后换新报名码，旧码立即失效，新码可核销', async () => {
  const settingsBefore = await get('/api/v1/settings', { token: tokens.admin.token });
  const originalCanReviseAttended = settingsBefore.body.review.canReviseAttended === true;
  // 展商要能把已参加退回，必须显式打开这个开关（默认关闭）。
  await put('/api/v1/settings', { canReviseAttended: true }, { token: tokens.admin.token });

  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '报名码轮换用例展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(26),
      category: '智能家居',
      status: 'optional',
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
        visitorName: '轮换用例',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：轮换用例\n参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const registrationId = submitted.body.registration.id;
    const oldCode = String(submitted.body.registration.checkInCode);
    // 码的形态：展会 + 报名 + 可轮换凭据
    assert.ok(
      oldCode.startsWith(`CALMOBILE-CHECKIN|${exhibitionId}|${registrationId}|`),
      `报名码应当带轮换凭据：${oldCode}`,
    );

    // 迁移前的老码（没有凭据那一段）一律失效，而不是被当成有效码
    const legacy = await post(
      '/api/v1/checkin',
      { code: `CALMOBILE-CHECKIN|${exhibitionId}|${registrationId}` },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(legacy.body.ok, false, `老码应当失效：${JSON.stringify(legacy.body)}`);
    assert.ok(legacy.body.error.includes('失效'), `老码应当提示失效：${legacy.body.error}`);

    // 第一次核销：码有效
    const first = await post('/api/v1/checkin', { code: oldCode }, { token: tokens.exhibitor.token });
    assert.strictEqual(first.body.ok, true, JSON.stringify(first.body));
    assert.strictEqual(first.body.status, '已参加');

    // 退回已通过 → 换新码（这就是需求点：同一个报名不能一直用同一张码）
    const reopened = await put(
      `/api/v1/review/${registrationId}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(reopened.body.ok, true, JSON.stringify(reopened.body));
    assert.strictEqual(reopened.body.record.status, '已通过');
    const newCode = await registrationCode(registrationId, tokens.user.token);
    assert.notStrictEqual(newCode, oldCode, '退回已通过后必须换新报名码');

    // 新码可以核销
    const second = await post('/api/v1/checkin', { code: newCode }, { token: tokens.exhibitor.token });
    assert.strictEqual(second.body.ok, true, `新码应当可以核销：${JSON.stringify(second.body)}`);
    assert.strictEqual(second.body.status, '已参加');
    assert.match(
      String(second.body.record.checkInTime),
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      `第二次核销要记新的核销时间：${second.body.record.checkInTime}`,
    );

    // 旧码立即失效：先被凭据校验拦下，而不是命中「已经核销」
    const stale = await post('/api/v1/checkin', { code: oldCode }, { token: tokens.exhibitor.token });
    assert.strictEqual(stale.body.ok, false, `旧码应当失效：${JSON.stringify(stale.body)}`);
    assert.ok(stale.body.error.includes('失效'), `旧码应当提示失效：${stale.body.error}`);
  } finally {
    await put('/api/v1/settings', { canReviseAttended: originalCanReviseAttended }, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});
