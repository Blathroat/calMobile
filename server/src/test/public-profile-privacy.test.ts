/**
 * 公开页与隐私 契约测试。
 *
 * 隐私开关决定报名记录可见性、按昵称查询、公开页带上开办的展会、公开页不下发报名码。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { del, get, isoDateAfter, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('隐私开关决定公开页是否展示报名记录，管理员始终可见', async () => {
  const hidden = await get('/api/v1/users/public?userId=usr-3', { token: tokens.exhibitor.token });
  assert.strictEqual(hidden.body.found, true);
  assert.strictEqual(hidden.body.showRegistrations, false, '默认应当是关闭的');
  assert.strictEqual(hidden.body.viewedAsAdmin, false);
  assert.deepStrictEqual(hidden.body.registrations, [], '关闭时不应返回报名记录');

  // 本人打开开关（顺带验证 profile 保存真的持久化了这个字段）
  const saved = await put('/api/v1/profile', { showRegistrations: true }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true);
  assert.strictEqual(saved.body.user.showRegistrations, true, '保存结果里应当带上开关状态');

  const reread = await get('/api/v1/profile', { token: tokens.user.token });
  assert.strictEqual(reread.body.showRegistrations, true, '隐私开关没有持久化');

  const visible = await get('/api/v1/users/public?userId=usr-3', { token: tokens.exhibitor.token });
  assert.strictEqual(visible.body.showRegistrations, true);
  assert.ok(visible.body.registrations.length > 0, '打开后应当能看到报名记录');

  const asAdmin = await get('/api/v1/users/public?userId=usr-3', { token: tokens.admin.token });
  assert.strictEqual(asAdmin.body.viewedAsAdmin, true, '管理员视角应当被标记');
  assert.ok(asAdmin.body.registrations.length >= visible.body.registrations.length);

  // 还原
  await put('/api/v1/profile', { showRegistrations: false }, { token: tokens.user.token });
});

test('公开页支持按昵称查询', async () => {
  const byNickname = await get('/api/v1/users/public?nickname=user');
  assert.strictEqual(byNickname.body.found, true, '公开页应当支持昵称查询');
  assert.ok(byNickname.body.profile.nickname);
});

test('公开页带上该用户开办的展会', async () => {
  // 展商主页要展示「开办的展会」：自己造一条、最后删掉，不依赖种子数据。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '公开页开办展会用例',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(21),
      category: '智能家居',
      status: '无需审核',
      qrEnabled: false,
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;
  try {
    const asVisitor = await get('/api/v1/users/public?nickname=exhibitor', { token: tokens.user.token });
    assert.strictEqual(asVisitor.body.found, true);
    const item = asVisitor.body.exhibitions.find((row: { id: string }) => row.id === exhibitionId);
    assert.ok(item, '公开页应当列出该用户开办的展会');
    assert.strictEqual(item.title, '公开页开办展会用例');
    assert.ok(!('checkInCode' in item), '公开页的展会卡片不下发报名码');

    // 普通用户没有开办展会：字段仍然存在，只是空数组（前端据此整块不渲染）
    const plain = await get('/api/v1/users/public?nickname=user', { token: tokens.exhibitor.token });
    assert.deepStrictEqual(plain.body.exhibitions, []);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});

test('公开页不下发报名码，本人与管理员仍能拿到', async () => {
  // 自己造数据、自己还原：不依赖其它用例执行到哪一步，也不改它们共享的记录。
  const users = await get('/api/v1/users?query=user', { token: tokens.admin.token });
  const self = users.body.find((row: any) => row.username === 'user');
  assert.ok(self, '种子里的 user 账号应当存在');

  // 启用二维码 + 无需审核：提交即已通过，因此本人应当拿得到报名码。
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '公开页报名码用例展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(30),
      category: '智能家居',
      status: '无需审核',
      qrEnabled: true,
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  const before = await get('/api/v1/profile', { token: tokens.user.token });
  const originalShow = before.body.showRegistrations === true;
  try {
    const submitted = await post(
      '/api/v1/registrations',
      {
        exhibitionId,
        visitorName: '公开页用例',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：公开页用例\n参观身份：专业观众',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    const registrationId = submitted.body.registration.id;

    // 本人的取码路径（报名详情）照常带报名码；码里带可轮换凭据，不按 id 手拼。
    const own = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
    assert.strictEqual(own.body.found, true);
    const ownCode = String(own.body.registration.checkInCode);
    assert.ok(
      ownCode.startsWith(`CALMOBILE-CHECKIN|${exhibitionId}|${registrationId}|`),
      `本人应当拿到报名码：${ownCode}`,
    );

    // 打开「展示我的报名」后，匿名访问公开页也必须看不到报名码
    const saved = await put('/api/v1/profile', { showRegistrations: true }, { token: tokens.user.token });
    assert.strictEqual(saved.body.ok, true);

    const anonymous = await get(`/api/v1/users/public?userId=${self.id}`);
    assert.strictEqual(anonymous.body.found, true);
    const record = anonymous.body.registrations.find((item: any) => item.id === registrationId);
    assert.ok(record, '打开隐私开关后，匿名访问应当看到这条已通过的报名');
    assert.ok(
      record.checkInCode === '' || record.checkInCode === undefined,
      `公开页不能下发报名码：${JSON.stringify(record.checkInCode)}`,
    );

    // 公开页对所有视角一致（本人 / 管理员也一样）：要报名码请走报名详情或审核接口
    const asSelf = await get(`/api/v1/users/public?userId=${self.id}`, { token: tokens.user.token });
    const selfRecord = asSelf.body.registrations.find((item: any) => item.id === registrationId);
    assert.ok(selfRecord, '本人应当能在公开页看到自己的报名');
    assert.ok(selfRecord.checkInCode === '' || selfRecord.checkInCode === undefined, '公开页对本人也不下发报名码');

    const asAdmin = await get(`/api/v1/users/public?userId=${self.id}`, { token: tokens.admin.token });
    const adminRecord = asAdmin.body.registrations.find((item: any) => item.id === registrationId);
    assert.ok(adminRecord, '管理员应当能看到公开页上的这条报名');
    assert.strictEqual(adminRecord.checkInCode, '', '公开页对管理员也不下发报名码');
    assert.ok(String(adminRecord.answers).includes('公开页用例'), '展示报名记录仍是隐私开关的本意，回答照常给出');

    // 管理员另有带报名码的路径：报名详情对管理员开放任意一条
    const adminDetail = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.admin.token });
    assert.strictEqual(adminDetail.body.found, true);
    assert.strictEqual(
      String(adminDetail.body.registration.checkInCode),
      ownCode,
      '管理员走报名详情应当拿到同一个凭据拼出的报名码',
    );
  } finally {
    await put('/api/v1/profile', { showRegistrations: originalShow }, { token: tokens.user.token });
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});
