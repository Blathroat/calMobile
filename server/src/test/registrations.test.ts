/**
 * 报名 契约测试。
 *
 * 我的报名、报名码下发、状态与窗口限制、自动通过、服务端收集项校验、已参加终态。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { del, get, isoDateAfter, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 报名 ────────────────────────────────────────────────────────

test('我的报名只返回自己的记录', async () => {
  const mine = await get('/api/v1/registrations', { token: tokens.user.token });
  assert.ok(Array.isArray(mine.body) && mine.body.length > 0);
  const required = [
    'id',
    'exhibitionId',
    'exhibitionTitle',
    'exhibitionDay',
    'exhibitionTime',
    'exhibitionVenue',
    'visitorName',
    'visitorType',
    'answers',
    'statusLabel',
    'qrEnabled',
    'allowCancel',
    'checkInCode',
    'attendanceStart',
    'attendanceEnd',
  ];
  for (const item of mine.body) {
    for (const key of required) {
      assert.ok(item[key] !== undefined, `报名 ${item.id} 缺少字段 ${key}`);
    }
    // 老数据没选参加时间段：两个字段给空串，页面据此不显示「参加时间」这一行。
    assert.strictEqual(item.attendanceStart, '', `没选参加时间段的报名要给空串：${item.id}`);
    assert.strictEqual(item.attendanceEnd, '', `没选参加时间段的报名要给空串：${item.id}`);
  }
  // 种子数据里 reg-1/reg-3 属于 user，reg-2 属于 exhibitor
  assert.ok(
    mine.body.every((item) => ['reg-1', 'reg-3'].includes(item.id)),
    `看到了别人的报名：${mine.body.map((item) => item.id).join(',')}`,
  );

  const others = await get('/api/v1/registrations', { token: tokens.exhibitor.token });
  assert.ok(others.body.every((item: any) => item.id === 'reg-2'));
});

test('报名码只在启用二维码且已通过时下发', async () => {
  const mine = await get('/api/v1/registrations', { token: tokens.user.token });
  const approved = mine.body.find((item: any) => item.id === 'reg-1');
  assert.ok(
    approved.checkInCode.startsWith('CALMOBILE-CHECKIN|exh-1|reg-1'),
    `已通过且启用二维码应当有报名码：${approved.checkInCode}`,
  );

  const pending = mine.body.find((item: any) => item.id === 'reg-3');
  assert.strictEqual(pending.checkInCode, '', '未通过或未启用二维码不应下发报名码');
});

test('报名受展会状态与窗口限制，重复报名被拒', async () => {
  // exh-4 仅展示
  const display = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-4',
      visitorName: '测试',
      visitorType: '专业观众',
      answers: '',
    },
    { token: tokens.user.token },
  );
  assert.strictEqual(display.body.ok, false);
  assert.ok(display.body.error.includes('仅展示'), display.body.error);

  // exh-3 截止报名
  const closed = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-3',
      visitorName: '测试',
      visitorType: '专业观众',
      answers: '',
    },
    { token: tokens.user.token },
  );
  assert.strictEqual(closed.body.ok, false);

  // 重复报名 exh-1（user 已有 reg-1）
  const duplicate = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-1',
      visitorName: '测试',
      visitorType: '专业观众',
      answers: '',
    },
    { token: tokens.user.token },
  );
  assert.strictEqual(duplicate.body.ok, false);
  assert.ok(duplicate.body.error.includes('已提交过'), duplicate.body.error);

  // 必填缺失
  const missing = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-2',
      visitorType: '专业观众',
      answers: '',
    },
    { token: tokens.user.token },
  );
  assert.strictEqual(missing.body.ok, false);

  // 匿名报名在报名站是允许的，但姓名必填；完整流程见 registration-query-link.test.ts
  const anonymous = await post('/api/v1/registrations', {
    exhibitionId: 'exh-2',
    visitorType: '专业观众',
    answers: '',
  });
  assert.strictEqual(anonymous.status, 200);
  assert.strictEqual(anonymous.body.ok, false);
  assert.ok(anonymous.body.error.includes('请输入姓名'), anonymous.body.error);
});

test('无需审核的展会提交即通过，撤销后可以重新报名', async () => {
  // exh-2 是需审核；用 admin（种子里没有他的报名）验证流转，避开 usr-3 已有的 reg-3。
  // 报名内容要满足该展会的收集项（必填项不能为空，单选值要在选项里）。
  const worksAnswers = '姓名 / 公司名称：接口测试\n参观身份：专业观众';
  const pending = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-2',
      visitorName: '接口测试',
      visitorType: '专业观众',
      answers: worksAnswers,
    },
    { token: tokens.admin.token },
  );
  assert.strictEqual(pending.body.ok, true, JSON.stringify(pending.body));
  assert.strictEqual(pending.body.autoApproved, false, '需审核的展会不应自动通过');
  assert.strictEqual(pending.body.statusLabel, '待审核');

  const cancelled = await del(`/api/v1/registrations/${pending.body.registration.id}`, { token: tokens.admin.token });
  assert.strictEqual(cancelled.body.ok, true, JSON.stringify(cancelled.body));

  const again = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-2',
      visitorName: '接口测试',
      visitorType: '专业观众',
      answers: worksAnswers,
    },
    { token: tokens.admin.token },
  );
  assert.strictEqual(again.body.ok, true, `撤销后应当可以重新报名：${JSON.stringify(again.body)}`);

  // admin 报 exh-1（无需审核）→ 自动通过
  const auto = await post(
    '/api/v1/registrations',
    {
      exhibitionId: 'exh-1',
      visitorName: '管理员报名',
      visitorType: '专业观众',
      answers: '姓名 / 公司名称：管理员报名\n参观身份：专业观众',
    },
    { token: tokens.admin.token },
  );
  assert.strictEqual(auto.body.ok, true, JSON.stringify(auto.body));
  assert.strictEqual(auto.body.autoApproved, true, '无需审核的展会应当自动通过');
  assert.strictEqual(auto.body.statusLabel, '已通过');
});

/**
 * 建一场用于参加时间段用例的展会：日期相对今天生成，避免写死日期过一阵就过期。
 * 不上传收集项（答案可以为空），按状态决定是否自动通过。
 */
async function createAttendanceExhibition(title: string, date: string, endDate: string, status = 'optional') {
  return post(
    '/api/v1/exhibitions',
    {
      title,
      venue: '测试展馆',
      time: '09:00-17:00',
      date,
      endDate,
      category: '智能家居',
      status,
    },
    { token: tokens.exhibitor.token },
  );
}

test('参加时间段：缺一端、开始晚于结束、超出展会区间被拒，合法值可回读', async () => {
  const exhibition = await createAttendanceExhibition('参加时间段校验展', isoDateAfter(60), isoDateAfter(64));
  assert.strictEqual(exhibition.body.ok, true, JSON.stringify(exhibition.body));
  const exhibitionId = String(exhibition.body.exhibition.id);
  const start = isoDateAfter(61);
  const end = isoDateAfter(62);
  const base = { exhibitionId, visitorName: '参加时间', visitorType: '专业观众', answers: '' };
  try {
    const onlyStart = await post(
      '/api/v1/registrations',
      { ...base, attendanceStart: start },
      { token: tokens.user.token },
    );
    assert.strictEqual(onlyStart.body.ok, false, '只填开始日期必须被拒');
    assert.strictEqual(onlyStart.body.errorCode, 'registration.attendanceIncomplete');
    assert.ok(onlyStart.body.error.includes('同时填写'), onlyStart.body.error);

    const reversed = await post(
      '/api/v1/registrations',
      { ...base, attendanceStart: end, attendanceEnd: start },
      { token: tokens.user.token },
    );
    assert.strictEqual(reversed.body.ok, false, '开始晚于结束必须被拒');
    assert.strictEqual(reversed.body.errorCode, 'registration.attendanceOrder');

    const outside = await post(
      '/api/v1/registrations',
      { ...base, attendanceStart: isoDateAfter(59), attendanceEnd: end },
      { token: tokens.user.token },
    );
    assert.strictEqual(outside.body.ok, false, '超出展会区间必须被拒');
    assert.strictEqual(outside.body.errorCode, 'registration.attendanceOutOfRange');
    assert.ok(
      outside.body.error.includes(`${isoDateAfter(60)} ~ ${isoDateAfter(64)}`),
      `提示要带上展会区间：${outside.body.error}`,
    );

    const saved = await post(
      '/api/v1/registrations',
      { ...base, attendanceStart: start, attendanceEnd: end },
      { token: tokens.user.token },
    );
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.registration.attendanceStart, start);
    assert.strictEqual(saved.body.registration.attendanceEnd, end);

    const detail = await get(`/api/v1/registrations/${saved.body.registration.id}`, { token: tokens.user.token });
    assert.strictEqual(detail.body.registration.attendanceStart, start, '报名详情要回读参加开始日期');
    assert.strictEqual(detail.body.registration.attendanceEnd, end, '报名详情要回读参加结束日期');
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('单日展会：参加时间段两端必须都是开展日', async () => {
  const day = isoDateAfter(90);
  const exhibition = await createAttendanceExhibition('单日参加时间展', day, '');
  assert.strictEqual(exhibition.body.ok, true, JSON.stringify(exhibition.body));
  const exhibitionId = String(exhibition.body.exhibition.id);
  const base = { exhibitionId, visitorName: '单日参加', visitorType: '专业观众', answers: '' };
  try {
    const mismatch = await post(
      '/api/v1/registrations',
      { ...base, attendanceStart: day, attendanceEnd: isoDateAfter(91) },
      { token: tokens.user.token },
    );
    assert.strictEqual(mismatch.body.ok, false, '单日展会的结束日期不能晚于开展日');
    assert.strictEqual(mismatch.body.errorCode, 'registration.attendanceOutOfRange');
    assert.ok(mismatch.body.error.includes(day), `单日展会的提示要带上开展日：${mismatch.body.error}`);

    const bothEnds = await post(
      '/api/v1/registrations',
      { ...base, attendanceStart: day, attendanceEnd: day },
      { token: tokens.user.token },
    );
    assert.strictEqual(bothEnds.body.ok, true, JSON.stringify(bothEnds.body));
    assert.strictEqual(bothEnds.body.registration.attendanceStart, day);
    assert.strictEqual(bothEnds.body.registration.attendanceEnd, day);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('月历圆点按参加时间段打点：已通过只标所选日期，待审核不打点', async () => {
  // 固定用「今天 + 120 天」所在月份的 10～14 日：月内日期，不会跨月，也远离示例展会。
  const anchor = new Date();
  anchor.setDate(anchor.getDate() + 120);
  const year = anchor.getFullYear();
  const month = anchor.getMonth() + 1;
  const dateOf = (day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const approvedExhibition = await createAttendanceExhibition('圆点时间展', dateOf(10), dateOf(14));
  const pendingExhibition = await createAttendanceExhibition('圆点待审展', dateOf(20), dateOf(21), 'review');
  assert.strictEqual(approvedExhibition.body.ok, true, JSON.stringify(approvedExhibition.body));
  assert.strictEqual(pendingExhibition.body.ok, true, JSON.stringify(pendingExhibition.body));
  const approvedId = String(approvedExhibition.body.exhibition.id);
  const pendingId = String(pendingExhibition.body.exhibition.id);
  try {
    const approved = await post(
      '/api/v1/registrations',
      {
        exhibitionId: approvedId,
        visitorName: '圆点测试',
        visitorType: '专业观众',
        answers: '',
        attendanceStart: dateOf(11),
        attendanceEnd: dateOf(12),
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));
    assert.strictEqual(approved.body.statusLabel, '已通过', '无需审核的展会报名应当直接通过');

    const pending = await post(
      '/api/v1/registrations',
      {
        exhibitionId: pendingId,
        visitorName: '圆点待审',
        visitorType: '专业观众',
        answers: '',
        attendanceStart: dateOf(20),
        attendanceEnd: dateOf(21),
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(pending.body.ok, true, JSON.stringify(pending.body));
    assert.strictEqual(pending.body.statusLabel, '待审核');

    const monthView = await get(`/api/v1/exhibitions/month?year=${year}&month=${month}`, {
      token: tokens.user.token,
    });
    const markedDays: number[] = monthView.body.markedDays;
    assert.ok(markedDays.includes(11) && markedDays.includes(12), `所选日期要有圆点：${markedDays}`);
    for (const dayNumber of [10, 13, 14]) {
      assert.ok(!markedDays.includes(dayNumber), `未选的展会日期不应有圆点：${markedDays}`);
    }
    for (const dayNumber of [20, 21]) {
      assert.ok(!markedDays.includes(dayNumber), `待审核的报名不打点：${markedDays}`);
    }
  } finally {
    await del(`/api/v1/exhibitions/${approvedId}`, { token: tokens.exhibitor.token });
    await del(`/api/v1/exhibitions/${pendingId}`, { token: tokens.exhibitor.token });
  }
});

test('报名窗口由服务端按数据库当前日期判断', async () => {
  // 示例数据里：exh-1 窗口开放、exh-3 已截止、exh-4 是仅展示
  const open = await get('/api/v1/exhibitions/exh-1');
  const today = new Date().toISOString().slice(0, 10);
  const window = open.body.exhibition;
  assert.ok(
    window.registrationStart <= today && window.registrationEnd >= today,
    `exh-1 的窗口应当覆盖今天：${window.registrationStart} ~ ${window.registrationEnd}`,
  );

  // 造一场窗口还没开始的展会，提交必须被拒且提示说的是窗口而不是别的
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '窗口测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(60),
      registrationStart: isoDateAfter(30),
      registrationEnd: isoDateAfter(50),
      category: '智能家居',
      status: 'optional',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const futureId = created.body.exhibition.id;

  const tooEarly = await post(
    '/api/v1/registrations',
    {
      exhibitionId: futureId,
      visitorName: '测试',
      visitorType: '专业观众',
      answers: '',
    },
    { token: tokens.user.token },
  );
  assert.strictEqual(tooEarly.body.ok, false, '窗口未开始不应报名成功');
  assert.ok(tooEarly.body.error.includes('尚未开始'), `提示应说明窗口未开始：${tooEarly.body.error}`);

  // 把窗口改成已结束，提示应当变成截止
  const past = await put(
    `/api/v1/exhibitions/${futureId}`,
    {
      title: '窗口测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(60),
      registrationStart: isoDateAfter(-30),
      registrationEnd: isoDateAfter(-1),
      category: '智能家居',
      status: 'optional',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(past.body.ok, true, JSON.stringify(past.body));

  const tooLate = await post(
    '/api/v1/registrations',
    {
      exhibitionId: futureId,
      visitorName: '测试',
      visitorType: '专业观众',
      answers: '',
    },
    { token: tokens.user.token },
  );
  assert.strictEqual(tooLate.body.ok, false, '窗口已结束不应报名成功');
  assert.ok(tooLate.body.error.includes('截止'), `提示应说明已截止：${tooLate.body.error}`);

  await del(`/api/v1/exhibitions/${futureId}`, { token: tokens.exhibitor.token });
});

test('报名收集项的必填与选项由服务端校验', async () => {
  // 自造一场展会：不依赖其它用例留下的展会配置，跑完即删（外键级联清掉收集项与报名）。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '收集项校验展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(30),
      category: '智能家居',
      status: 'optional',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    // 没有配置收集项就是空的：不塞默认三项，报名页只有提交按钮，空答案也能提交。
    const noFields = await get(`/api/v1/exhibitions/${exhibitionId}/fields`);
    assert.deepStrictEqual(noFields.body, [], '新建展会没有收集项时应当返回空数组');

    const bare = await post(
      '/api/v1/registrations',
      {
        exhibitionId,
        visitorName: '校验用例',
        visitorType: '专业观众',
        answers: '',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(bare.body.ok, true, `没有收集项时提交不应被拦：${JSON.stringify(bare.body)}`);

    // 腾出「同一用户同一展会只允许一条未撤销报名」的位置：下面还要用这个身份提交。
    const released = await del(`/api/v1/registrations/${bare.body.registration.id}`, {
      token: tokens.user.token,
    });
    assert.strictEqual(released.body.ok, true, `撤销后应当能再次报名：${JSON.stringify(released.body)}`);

    // 配置成必填 + 选项的收集项
    const saved = await put(
      `/api/v1/exhibitions/${exhibitionId}/fields`,
      {
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '媒体'] },
          { title: '报名需求', type: 'checkbox', required: false, options: ['停车位', '翻译服务'] },
        ],
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));

    const base = { exhibitionId, visitorName: '校验用例', visitorType: '专业观众' };

    const missing = await post(
      '/api/v1/registrations',
      {
        ...base,
        answers: '参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(missing.body.ok, false, '缺必填项必须被拒');
    assert.ok(missing.body.error.includes('请填写「姓名 / 公司名称」'), missing.body.error);

    const badOption = await post(
      '/api/v1/registrations',
      {
        ...base,
        answers: '姓名 / 公司名称：校验用例\n参观身份：同行人员',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(badOption.body.ok, false, '选项以外的单选值必须被拒');
    assert.ok(badOption.body.error.includes('参观身份'), badOption.body.error);

    const badMulti = await post(
      '/api/v1/registrations',
      {
        ...base,
        answers: '姓名 / 公司名称：校验用例\n参观身份：专业观众\n报名需求：停车位、接送机',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(badMulti.body.ok, false, '多选里混入选项以外的值必须被拒');

    const accepted = await post(
      '/api/v1/registrations',
      {
        ...base,
        answers: '姓名 / 公司名称：校验用例\n参观身份：专业观众\n报名需求：停车位、翻译服务',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(accepted.body.ok, true, `合规提交应当成功：${JSON.stringify(accepted.body)}`);
    assert.strictEqual(accepted.body.registration.statusLabel, '已通过');

    // 选填项没填：文稿会写「未填写」占位（见 server/src/domain/answer-document.ts），
    // 服务端要把它当成空值，而不是一个不在选项里的多选值。
    const blank = await post(
      '/api/v1/registrations',
      {
        ...base,
        visitorName: '校验用例二',
        answers: '姓名 / 公司名称：校验用例二\n参观身份：媒体\n报名需求：未填写',
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(blank.body.ok, true, `未填写占位不应被当成非法选项：${JSON.stringify(blank.body)}`);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});
