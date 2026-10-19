/**
 * 展会契约与写权限 契约测试。
 *
 * 展会列表 / 月视图 / 详情 / 关键词搜索、增删改的角色与归属限制、收集项覆盖与长度设置。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/migrate.js';
import { del, get, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 展会契约 ────────────────────────────────────────────────────

test('展会列表字段覆盖页面渲染所需的全部字段', async () => {
  const { body } = await get('/api/v1/exhibitions');
  assert.ok(Array.isArray(body) && body.length > 0, '示例数据至少要有展会');
  const required = [
    'id',
    'title',
    'venue',
    'time',
    'category',
    'description',
    'descriptionFormat',
    'status',
    'mode',
    'modeLabel',
    'openForRegistration',
    'year',
    'month',
    'day',
    'date',
    'dateLabel',
    'exhibitor',
    'exhibitorRole',
    'exhibitorNote',
    'imageUri',
    'registrationStart',
    'registrationEnd',
    'qrEnabled',
    'allowCancel',
    'registrationCount',
    'fieldCount',
  ];
  for (const item of body) {
    for (const key of required) {
      assert.ok(item[key] !== undefined, `展会 ${item.id} 缺少字段 ${key}`);
    }
    assert.strictEqual(typeof item.qrEnabled, 'boolean');
    assert.strictEqual(typeof item.allowCancel, 'boolean');
    assert.strictEqual(typeof item.openForRegistration, 'boolean');
    assert.strictEqual(typeof item.registrationCount, 'number');
    assert.strictEqual(typeof item.fieldCount, 'number');
  }
});

test('月视图返回三块数据，且原样返回请求的月份与日期', async () => {
  // 示例展会相对今天生成，落点月份就是「第一场展会所在的月份」。
  const bootstrap = await get('/api/v1/bootstrap');
  const landing = bootstrap.body.calendar.landing;
  const june = await get(`/api/v1/exhibitions/month?year=${landing.year}&month=${landing.month}`);
  assert.strictEqual(june.body.year, landing.year);
  assert.strictEqual(june.body.month, landing.month);
  assert.ok(june.body.eventDays.length > 0, '落点月份应当有展会');
  assert.ok(june.body.monthLabel.includes(String(landing.year)));
  assert.ok(june.body.eventDays.includes(june.body.day), '缺省选中日期应当是有展会的日期');
  assert.ok(Array.isArray(june.body.exhibitions) && Array.isArray(june.body.selected));
  assert.deepStrictEqual(june.body.markedDays, [], '未登录不返回个人活动圆点');
  assert.deepStrictEqual(june.body.meetings, [], '未登录不返回私人会议卡片');

  // 指定了没有展会的日期：原样返回，由页面显示空状态
  const firstEventDay = june.body.eventDays[0];
  const otherDay = firstEventDay === 1 ? 2 : 1;
  const emptyDay = await get(`/api/v1/exhibitions/month?year=${landing.year}&month=${landing.month}&day=${otherDay}`);
  assert.strictEqual(emptyDay.body.day, otherDay, '选中日期被服务端改写了');
  assert.strictEqual(emptyDay.body.selected.length, 0);

  // 空月份：原样返回，不回落到有数据的月份
  const emptyMonth = await get(
    `/api/v1/exhibitions/month?year=${landing.year}&month=${((landing.month + 5) % 12) + 1}`,
  );
  assert.strictEqual(emptyMonth.body.month, ((landing.month + 5) % 12) + 1);
  assert.strictEqual(emptyMonth.body.eventDays.length, 0);
  assert.strictEqual(emptyMonth.body.day, 0);
});

test('展会详情带收集项，找不到时给 found:false', async () => {
  const detail = await get('/api/v1/exhibitions/exh-1');
  assert.strictEqual(detail.body.found, true);
  assert.strictEqual(detail.body.exhibition.id, 'exh-1');
  assert.ok(Array.isArray(detail.body.fields) && detail.body.fields.length > 0, '缺少报名收集项');

  const missing = await get('/api/v1/exhibitions/exh-not-exist');
  assert.strictEqual(missing.status, 200);
  assert.strictEqual(missing.body.found, false);
  assert.ok(missing.body.error);
});

test('展会可按关键词搜索，分类来自服务器设置', async () => {
  const hit = await get('/api/v1/exhibitions?query=智能');
  assert.ok(
    hit.body.some((item: any) => item.title.includes('智能')),
    '搜索没有命中',
  );
  const miss = await get('/api/v1/exhibitions?query=不存在的关键词');
  assert.deepStrictEqual(miss.body, []);
  const hosted = await get('/api/v1/exhibitions?exhibitorId=usr-2');
  assert.ok(hosted.body.length > 0, '主办人筛选没有返回展会');
  assert.ok(hosted.body.every((item: { exhibitorId?: string }) => item.exhibitorId === 'usr-2'));
  const otherHost = await get('/api/v1/exhibitions?exhibitorId=usr-3');
  assert.deepStrictEqual(otherHost.body, []);

  const categories = await get('/api/v1/exhibitions/categories');
  assert.ok(Array.isArray(categories.body) && categories.body.length > 0);
});

// ── 展会写权限 ──────────────────────────────────────────────────

test('展会的增删改受角色与归属限制', async () => {
  const anonymous = await post('/api/v1/exhibitions', { title: 'x' });
  assert.strictEqual(anonymous.status, 401, '访客不能新建展会');

  const asUser = await post('/api/v1/exhibitions', { title: 'x' }, { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403, '普通用户不能新建展会');

  // 展商新建一场自己的展会
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '接口测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-09-20',
      registrationStart: '2026-08-01',
      registrationEnd: '2026-09-10',
      category: '智能家居',
      status: 'review',
      description: '契约测试用',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, `新建失败：${JSON.stringify(created.body)}`);
  const id = created.body.exhibition.id;
  assert.strictEqual(created.body.exhibition.date, '2026-09-20');
  assert.strictEqual(created.body.exhibition.day, 20, '日期必须按 SQL 派生，不能因时区差一天');

  // 校验：截止早于开始、日期非法、标题超长
  const badRange = await put(
    `/api/v1/exhibitions/${id}`,
    {
      title: '接口测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-09-20',
      registrationStart: '2026-09-10',
      registrationEnd: '2026-08-01',
      status: 'review',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(badRange.body.ok, false);
  assert.ok(badRange.body.error.includes('报名截止'), `提示不对：${badRange.body.error}`);

  const badDate = await put(
    `/api/v1/exhibitions/${id}`,
    {
      title: '接口测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-02-31',
      status: 'review',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(badDate.body.ok, false, '2026-02-31 不是有效日期');

  const longTitle = await put(
    `/api/v1/exhibitions/${id}`,
    {
      title: '超'.repeat(200),
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-09-20',
      status: 'review',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(longTitle.body.ok, false, '标题超长必须被服务端拦住');

  // 另一个展商（用普通用户冒充）不能改别人的展会
  const otherUser = await put(`/api/v1/exhibitions/${id}`, { title: 'x' }, { token: tokens.user.token });
  assert.strictEqual(otherUser.status, 403);

  // 管理员可以改
  const asAdmin = await put(`/api/v1/exhibitions/${id}/status`, { status: 'optional' }, { token: tokens.admin.token });
  assert.strictEqual(asAdmin.body.ok, true, JSON.stringify(asAdmin.body));
  assert.strictEqual((await get(`/api/v1/exhibitions/${id}`)).body.exhibition.status, '无需审核');

  const removed = await del(`/api/v1/exhibitions/${id}`, { token: tokens.exhibitor.token });
  assert.strictEqual(removed.body.ok, true, `删除失败：${JSON.stringify(removed.body)}`);
  const gone = await get(`/api/v1/exhibitions/${id}`);
  assert.strictEqual(gone.body.found, false);
});

test('展会收集项可以整体覆盖并读回', async () => {
  const saved = await put(
    '/api/v1/exhibitions/exh-2/fields',
    {
      fields: [
        { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
        { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '媒体'] },
      ],
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(saved.body.ok, true, `保存收集项失败：${JSON.stringify(saved.body)}`);
  assert.strictEqual(saved.body.fields.length, 2);

  const read = await get('/api/v1/exhibitions/exh-2/fields');
  assert.strictEqual(read.body.length, 2);
  assert.deepStrictEqual(read.body[1].options, ['专业观众', '媒体']);
});

test('收集项的文本填写和选项长度按管理设置拦住', async () => {
  const originalFields = await get('/api/v1/exhibitions/exh-1/fields');
  assert.ok(Array.isArray(originalFields.body), `读取原收集项失败：${JSON.stringify(originalFields.body)}`);
  try {
    const tight = await put(
      '/api/v1/settings',
      { textFill: 2, radioOption: 2, checkOption: 2 },
      { token: tokens.admin.token },
    );
    assert.strictEqual(tight.body.ok, true, JSON.stringify(tight.body));
    assert.strictEqual(tight.body.settings.limits.textFill, 2);
    assert.strictEqual(tight.body.settings.limits.radioOption, 2);
    assert.strictEqual(tight.body.settings.limits.checkOption, 2);

    const longRadio = await put(
      '/api/v1/exhibitions/exh-1/fields',
      { fields: [{ title: '来源', type: 'radio', required: false, options: ['朋友们'] }] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(longRadio.body.ok, false, '超长单选选项必须被拒');
    assert.ok(String(longRadio.body.error).includes('单选选项'), longRadio.body.error);
    // 校验失败带 validation.* 码，占位值与文案里的变量一一对应。
    assert.strictEqual(longRadio.body.errorCode, 'validation.tooLong');
    assert.deepEqual(longRadio.body.errorParams, { label: '单选选项', max: 2 });

    const longCheck = await put(
      '/api/v1/exhibitions/exh-1/fields',
      { fields: [{ title: '需求', type: 'checkbox', required: false, options: ['停车位'] }] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(longCheck.body.ok, false, '超长多选选项必须被拒');
    assert.ok(String(longCheck.body.error).includes('多选选项'), longCheck.body.error);

    const longTitle = await put(
      '/api/v1/exhibitions/exh-1/fields',
      { fields: [{ title: '标'.repeat(31), type: 'text', required: false, options: [] }] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(longTitle.body.ok, false, '超长文本框标题必须被拒');
    assert.ok(String(longTitle.body.error).includes('文本框标题'), longTitle.body.error);

    const kept = await put(
      '/api/v1/exhibitions/exh-1/fields',
      { fields: [{ title: '来意', type: 'text', required: true, options: [] }] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(kept.body.ok, true, JSON.stringify(kept.body));
    const rejected = await post(
      '/api/v1/registrations',
      {
        exhibitionId: 'exh-1',
        visitorName: '长度用例',
        visitorType: '专业观众',
        answers: '来意：超过啦',
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(rejected.body.ok, false, '超过文本框填写上限必须被拒');
    assert.ok(String(rejected.body.error).includes('最多 2'), rejected.body.error);

    const meetingFields = await put(
      '/api/v1/meetings/settings',
      { acceptMeetings: true, fields: [{ title: '来意', type: 'text', required: true, options: [] }] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(meetingFields.body.ok, true, JSON.stringify(meetingFields.body));
    const meetingRejected = await post(
      '/api/v1/meetings',
      { exhibitorId: 'usr-2', meetingDate: '2099-08-01', answers: '来意：超过啦' },
      { token: tokens.user.token },
    );
    assert.strictEqual(meetingRejected.body.ok, false, '私人会议的文本框填写也要按上限拦住');
    assert.ok(String(meetingRejected.body.error).includes('最多 2'), meetingRejected.body.error);
  } finally {
    const restored = await put(
      '/api/v1/settings',
      {
        textFill: DEFAULT_SETTINGS.limits.textFill,
        radioOption: DEFAULT_SETTINGS.limits.radioOption,
        checkOption: DEFAULT_SETTINGS.limits.checkOption,
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(restored.body.settings?.limits?.textFill, DEFAULT_SETTINGS.limits.textFill);
    assert.strictEqual(restored.body.settings?.limits?.radioOption, DEFAULT_SETTINGS.limits.radioOption);
    assert.strictEqual(restored.body.settings?.limits?.checkOption, DEFAULT_SETTINGS.limits.checkOption);
    const restoredFields = await put(
      '/api/v1/exhibitions/exh-1/fields',
      { fields: originalFields.body },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(restoredFields.body.ok, true, `恢复收集项失败：${JSON.stringify(restoredFields.body)}`);
    const closedMeetings = await put(
      '/api/v1/meetings/settings',
      { acceptMeetings: false, fields: [] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(closedMeetings.body.ok, true, `恢复会议设置失败：${JSON.stringify(closedMeetings.body)}`);
  }
});
