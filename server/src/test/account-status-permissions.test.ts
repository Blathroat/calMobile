/**
 * 账号状态与权限 契约测试。
 *
 * 用户列表与账号状态仅管理员可操作、受限账号的报名 / 发布展会 / 编辑资料 / 核销限制。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { del, get, isoDateAfter, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

// ── 用户、隐私与设置 ────────────────────────────────────────────

test('用户列表与账号状态只有管理员能操作', async () => {
  const guestList = await get('/api/v1/users');
  assert.strictEqual(guestList.status, 401);
  const asUser = await get('/api/v1/users', { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);
  const exhibitorProfile = await get('/api/v1/users/usr-3', { token: tokens.exhibitor.token });
  assert.strictEqual(exhibitorProfile.status, 403);

  const list = await get('/api/v1/users?query=demo', { token: tokens.admin.token });
  assert.ok(Array.isArray(list.body) && list.body.length > 0, '管理员应当能查到用户');
  const row = list.body[0];
  for (const key of ['id', 'nickname', 'email', 'avatar', 'role', 'status', 'registrationTime', 'lastLoginTime']) {
    assert.ok(row[key] !== undefined, `用户缺少字段 ${key}`);
  }
  assert.strictEqual(row.password_hash, undefined, '不能把密码哈希发出去');

  const limited = await put('/api/v1/users/usr-3/status', { status: '受限' }, { token: tokens.admin.token });
  assert.strictEqual(limited.body.ok, true, JSON.stringify(limited.body));
  assert.strictEqual(limited.body.user.status, '受限');
  const restored = await put('/api/v1/users/usr-3/status', { status: '正常' }, { token: tokens.admin.token });
  assert.strictEqual(restored.body.user.status, '正常');

  const invalid = await put('/api/v1/users/usr-3/status', { status: '乱写' }, { token: tokens.admin.token });
  assert.strictEqual(invalid.body.ok, false);

  const self = await put('/api/v1/users/usr-1/status', { status: '封禁' }, { token: tokens.admin.token });
  assert.strictEqual(self.body.ok, false, '管理员不应该能封禁自己');
});

/**
 * 受限账号（`users.status = 'limited'`）真的生效：三件事被禁、其余照旧、管理员不受限。
 *
 * 用例自己改状态、自己在 finally 里还原（usr-3 是种子数据里的普通用户，别的用例也在用），
 * 因此不依赖其它用例的执行顺序，也不留下共享状态。
 */
test('受限账号不能报名 / 发布展会 / 编辑个人信息，其余照旧且管理员不受限', async () => {
  const profileBefore = (await get('/api/v1/profile', { token: tokens.user.token })).body;
  const notifyBefore = (await get('/api/v1/profile/notifications', { token: tokens.user.token })).body;
  try {
    const limited = await put('/api/v1/users/usr-3/status', { status: '受限' }, { token: tokens.admin.token });
    assert.strictEqual(limited.body.ok, true, JSON.stringify(limited.body));

    // 受限账号的用户态：能力位同步置灰，并带上原因标记
    const me = await get('/api/v1/bootstrap', { token: tokens.user.token });
    assert.strictEqual(me.body.user.can.register, false, '受限账号 can.register 应为 false');
    assert.strictEqual(me.body.user.can.profile, false, '受限账号 can.profile 应为 false');
    assert.strictEqual(me.body.user.can.limited, true, '受限账号 can.limited 应为 true');
    assert.strictEqual(me.body.user.can.admin, false);

    // ① 不能报名
    const registration = await post(
      '/api/v1/registrations',
      {
        exhibitionId: 'exh-1',
        visitorName: '受限用户',
        visitorType: '专业观众',
        answers: '',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(registration.status, 403, `受限账号报名应当 403：${JSON.stringify(registration.body)}`);
    assert.strictEqual(registration.body.error, '账号已被限制，不能报名');

    // ② 不能发布展会
    const exhibition = await post(
      '/api/v1/exhibitions',
      {
        title: '受限账号不该发出的展会',
        venue: '测试展馆',
        time: '09:00-17:00',
        date: '2026-09-20',
        status: '需审核',
      },
      { token: tokens.user.token },
    );
    assert.strictEqual(exhibition.status, 403, `受限账号发布展会应当 403：${JSON.stringify(exhibition.body)}`);
    assert.strictEqual(exhibition.body.error, '账号已被限制，不能发布展会');

    // ③ 不能编辑个人信息
    const profile = await put('/api/v1/profile', { nickname: '受限昵称' }, { token: tokens.user.token });
    assert.strictEqual(profile.status, 403, `受限账号改资料应当 403：${JSON.stringify(profile.body)}`);
    assert.strictEqual(profile.body.error, '账号已被限制，不能编辑个人信息');

    // 仍然允许：浏览与查询（200），通知偏好与改密码（不是 403）
    assert.strictEqual((await get('/api/v1/bootstrap', { token: tokens.user.token })).status, 200);
    assert.strictEqual((await get('/api/v1/exhibitions', { token: tokens.user.token })).status, 200);
    assert.strictEqual((await get('/api/v1/settings', { token: tokens.user.token })).status, 200);
    const notify = await put(
      '/api/v1/profile/notifications',
      {
        exhibitionReminder: !notifyBefore.exhibitionReminder,
      },
      { token: tokens.user.token },
    );
    assert.notStrictEqual(notify.status, 403, `通知偏好不受限：${JSON.stringify(notify.body)}`);
    assert.strictEqual(notify.body.ok, true, JSON.stringify(notify.body));
    const password = await post(
      '/api/v1/profile/password',
      {
        currentPassword: 'x',
        newPassword: 'y',
        confirmPassword: 'y',
      },
      { token: tokens.user.token },
    );
    assert.notStrictEqual(password.status, 403, '改密码属于账号安全，不应被受限拦下');

    // 管理员自己做同样三件事仍然成功（admin 自己发的展会用来报名，用完连展会一起删掉）
    const adminBootstrap = await get('/api/v1/bootstrap', { token: tokens.admin.token });
    assert.strictEqual(adminBootstrap.body.user.can.limited, false, '管理员不受限，can.limited 应为 false');
    assert.strictEqual(adminBootstrap.body.user.can.register, true);
    assert.strictEqual(adminBootstrap.body.user.can.profile, true);

    const adminExhibition = await post(
      '/api/v1/exhibitions',
      {
        title: '管理员发布的展会',
        venue: '测试展馆',
        time: '09:00-17:00',
        date: '2026-09-21',
        registrationStart: '2026-01-01',
        registrationEnd: '2026-12-31',
        status: '无需审核',
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(
      adminExhibition.body.ok,
      true,
      `管理员发布展会应当成功：${JSON.stringify(adminExhibition.body)}`,
    );
    const adminExhibitionId = adminExhibition.body.exhibition.id;

    const adminRegistration = await post(
      '/api/v1/registrations',
      {
        exhibitionId: adminExhibitionId,
        visitorName: '管理员',
        visitorType: '专业观众',
        // 新展会没有配置收集项，答案是自由文本（没有可校验的项）
        answers: '姓名 / 公司名称：管理员\n参观身份：专业观众',
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(
      adminRegistration.body.ok,
      true,
      `管理员报名应当成功：${JSON.stringify(adminRegistration.body)}`,
    );

    // 写一个与当前值相同的字段：既证明没被受限逻辑拦下，也不改动管理员的资料
    const adminProfile = await put(
      '/api/v1/profile',
      {
        nickname: adminBootstrap.body.user.nickname,
        region: adminBootstrap.body.user.region,
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(adminProfile.body.ok, true, `管理员改资料应当成功：${JSON.stringify(adminProfile.body)}`);

    // 清理：删掉展会（报名按外键级联删除）
    assert.strictEqual(
      (await del(`/api/v1/exhibitions/${adminExhibitionId}`, { token: tokens.admin.token })).body.ok,
      true,
    );
  } finally {
    // 还原：账号状态与个人资料，后面的用例还要用这个账号
    await put('/api/v1/users/usr-3/status', { status: '正常' }, { token: tokens.admin.token });
    await put(
      '/api/v1/profile',
      {
        nickname: profileBefore.nickname,
        region: profileBefore.region,
        bio: profileBefore.bio,
        socialMedia: profileBefore.socialMedia,
      },
      { token: tokens.user.token },
    );
    await put(
      '/api/v1/profile/notifications',
      {
        exhibitionReminder: notifyBefore.exhibitionReminder,
      },
      { token: tokens.user.token },
    );
    const restored = await get('/api/v1/bootstrap', { token: tokens.user.token });
    assert.strictEqual(restored.body.user.can.limited, false, '受限状态没有还原，后续用例会被污染');
  }
});

/**
 * 受限账号的写操作被全面收紧：编辑 / 删除展会、暂停恢复报名、改报名收集项、现场核销
 * 都要 403 +「受限」文案，且**不再给角色文案**（受限判定排在角色检查之前）；
 * 改回「正常」后五件事照样做得成；管理员即便库里是受限状态也不受影响。
 *
 * 自造展会与报名（跑完删展会，外键级联清掉报名），不依赖种子里的核销状态，
 * 也不依赖其它用例的执行顺序；受限状态一律在 `finally` 里还原成「正常」。
 */
test('受限账号不能编辑 / 删除展会、改报名设置与核销，恢复正常后照旧，管理员不受限', async () => {
  // 账号状态直接改库里的那一列：管理员不能改自己的状态（`PUT /users/:id/status` 会拒），
  // 而种子里只有一个管理员，因此「管理员受限」这个状态只能这样构造出来。
  // 库里存的是英文代码（`users_status_check` 只认 active / limited / banned），
  // 中文标签只在接口层收发，所以这里给代码而不是「受限 / 正常」。
  const setStatus = (id: string, status: string) =>
    pool.query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);

  // 两场自造展会：A 给受限展商 / 受限普通用户与「恢复正常后照旧」用；B 专门留给管理员核销。
  const createExhibition = async (title: string) => {
    const created = await post(
      '/api/v1/exhibitions',
      {
        title,
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
    return created.body.exhibition.id;
  };

  const exhibitionA = await createExhibition('受限收紧用例展 A');
  const exhibitionB = await createExhibition('受限收紧用例展 B');

  const submit = async (exhibitionId: string, token: string, name: string) => {
    const submitted = await post(
      '/api/v1/registrations',
      {
        exhibitionId,
        visitorName: name,
        visitorType: '专业观众',
        answers: `姓名 / 公司名称：${name}\n参观身份：专业观众`,
      },
      { token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    return submitted.body.registration;
  };
  const submittedA = await submit(exhibitionA, tokens.user.token, '受限收紧用例');
  const submittedB = await submit(exhibitionB, tokens.admin.token, '受限收紧管理员');
  const registrationA = submittedA.id;
  // 报名码带可轮换凭据，不能按 id 手拼：取报名接口下发的那两个。
  const codeA = String(submittedA.checkInCode);
  const codeB = String(submittedB.checkInCode);

  // 被收紧的五条路由：动作名 + 期望文案 + 怎么发这个请求（受限与恢复正常两轮共用）。
  const calls = [
    {
      name: '编辑展会',
      message: '账号已被限制，不能修改展会',
      send: (token: string, id: string, _code: string) =>
        put(`/api/v1/exhibitions/${id}`, { title: '受限账号不该改成的标题' }, { token }),
    },
    {
      name: '删除展会',
      message: '账号已被限制，不能删除展会',
      send: (token: string, id: string, _code: string) => del(`/api/v1/exhibitions/${id}`, { token }),
    },
    {
      name: '暂停 / 恢复报名',
      message: '账号已被限制，不能修改报名设置',
      send: (token: string, id: string, _code: string) =>
        put(`/api/v1/exhibitions/${id}/status`, { status: '无需审核' }, { token }),
    },
    {
      name: '改报名收集项',
      message: '账号已被限制，不能修改报名设置',
      send: (token: string, id: string, _code: string) =>
        put(
          `/api/v1/exhibitions/${id}/fields`,
          {
            fields: [{ title: '受限账号不该改成的问题', type: '文本', required: false }],
          },
          { token },
        ),
    },
    {
      name: '现场核销',
      message: '账号已被限制，不能核销',
      // 受限判定排在解析报名码之前，所以这里拿真实下发的码即可（内容不重要）。
      send: (token: string, _id: string, code: string) => post('/api/v1/checkin', { code }, { token }),
    },
  ];

  try {
    // ① 受限的展商（自己举办的展会也一样不给动）：403 + 逐条比对文案
    await setStatus('usr-2', 'limited');
    for (const item of calls) {
      const response = await item.send(tokens.exhibitor.token, exhibitionA, codeA);
      assert.strictEqual(response.status, 403, `${item.name}对受限展商应当 403：${JSON.stringify(response.body)}`);
      assert.strictEqual(response.body.error, item.message, `${item.name}的受限文案不对`);
    }

    // 被拦下的操作确实没生效：展会还在，标题 / 收集项 / 报名状态都没被改动
    const untouched = await get(`/api/v1/exhibitions/${exhibitionA}`);
    assert.strictEqual(untouched.body.found, true, '受限拦截之后展会必须还在');
    assert.strictEqual(untouched.body.exhibition.title, '受限收紧用例展 A', '受限账号不该改到标题');
    assert.deepStrictEqual(untouched.body.fields, [], '受限账号不该给展会加上收集项');
    const beforeCheckin = await get(`/api/v1/registrations/${registrationA}`, { token: tokens.user.token });
    assert.strictEqual(beforeCheckin.body.registration.statusLabel, '已通过', '受限账号不该核销成功');

    // ② 受限的普通用户：同样拿到「账号已被限制…」，而不是「只有展商或管理员可以执行此操作」
    //    —— 这正是受限判定必须排在角色检查之前的机器化证据
    await setStatus('usr-3', 'limited');
    for (const item of calls) {
      const response = await item.send(tokens.user.token, exhibitionA, codeA);
      assert.strictEqual(response.status, 403, `${item.name}对受限普通用户应当 403：${JSON.stringify(response.body)}`);
      assert.ok(
        response.body.error.includes('已被限制'),
        `${item.name}应当给「账号已被限制」文案：${response.body.error}`,
      );
      assert.ok(!response.body.error.includes('展商'), `${item.name}不该给角色文案：${response.body.error}`);
    }

    // ③ 摘掉受限标签后，普通用户被拒的原因变回角色权限（不再因为「已被限制」）
    await setStatus('usr-3', 'active');
    for (const item of calls) {
      const response = await item.send(tokens.user.token, exhibitionA, codeA);
      assert.strictEqual(response.status, 403, `${item.name}普通用户仍应因角色被拒：${JSON.stringify(response.body)}`);
      assert.ok(
        !response.body.error.includes('已被限制'),
        `${item.name}恢复正常后不该再因受限被拒：${response.body.error}`,
      );
    }

    // ④ 同一账号改回「正常」后，受限展商五件事全部做得成
    await setStatus('usr-2', 'active');
    const edited = await put(
      `/api/v1/exhibitions/${exhibitionA}`,
      { title: '恢复正常后改的标题' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(edited.body.ok, true, `恢复正常后编辑展会应当成功：${JSON.stringify(edited.body)}`);
    assert.strictEqual(edited.body.exhibition.title, '恢复正常后改的标题');

    const paused = await put(
      `/api/v1/exhibitions/${exhibitionA}/status`,
      { status: '需审核' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(paused.body.ok, true, `恢复正常后改报名设置应当成功：${JSON.stringify(paused.body)}`);
    assert.strictEqual(paused.body.exhibition.status, '需审核');

    const refields = await put(
      `/api/v1/exhibitions/${exhibitionA}/fields`,
      {
        fields: [{ title: '恢复正常后的问题', type: '文本', required: false }],
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(refields.body.ok, true, `恢复正常后改收集项应当成功：${JSON.stringify(refields.body)}`);
    assert.strictEqual(refields.body.fields[0].title, '恢复正常后的问题');

    const checked = await post('/api/v1/checkin', { code: codeA }, { token: tokens.exhibitor.token });
    assert.strictEqual(checked.body.ok, true, `恢复正常后核销应当成功：${JSON.stringify(checked.body)}`);
    assert.strictEqual(checked.body.status, '已参加');

    const removed = await del(`/api/v1/exhibitions/${exhibitionA}`, { token: tokens.exhibitor.token });
    assert.strictEqual(removed.body.ok, true, `恢复正常后删除展会应当成功：${JSON.stringify(removed.body)}`);
    assert.strictEqual((await get(`/api/v1/exhibitions/${exhibitionA}`)).body.found, false, '删除之后展会不应还在');

    // ⑤ 管理员：库里被标成「受限」也不受这些限制（否则没人能解除限制）
    await setStatus('usr-1', 'limited');
    const adminState = await get('/api/v1/bootstrap', { token: tokens.admin.token });
    assert.strictEqual(adminState.body.user.can.limited, false, '管理员不该被判定为受限');
    assert.strictEqual(adminState.body.user.can.register, true);
    assert.strictEqual(adminState.body.user.can.profile, true);

    const adminEdit = await put(
      `/api/v1/exhibitions/${exhibitionB}`,
      { title: '管理员受限态下仍能改' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(adminEdit.body.ok, true, `管理员受限态下编辑展会应当成功：${JSON.stringify(adminEdit.body)}`);
    const adminStatus = await put(
      `/api/v1/exhibitions/${exhibitionB}/status`,
      { status: '需审核' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(
      adminStatus.body.ok,
      true,
      `管理员受限态下改报名设置应当成功：${JSON.stringify(adminStatus.body)}`,
    );
    const adminFields = await put(
      `/api/v1/exhibitions/${exhibitionB}/fields`,
      {
        fields: [{ title: '管理员受限态下改的收集项', type: '文本', required: false }],
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(
      adminFields.body.ok,
      true,
      `管理员受限态下改收集项应当成功：${JSON.stringify(adminFields.body)}`,
    );
    const adminCheckin = await post('/api/v1/checkin', { code: codeB }, { token: tokens.admin.token });
    assert.strictEqual(adminCheckin.body.ok, true, `管理员受限态下核销应当成功：${JSON.stringify(adminCheckin.body)}`);
    assert.strictEqual(adminCheckin.body.status, '已参加');
    const adminDelete = await del(`/api/v1/exhibitions/${exhibitionB}`, { token: tokens.admin.token });
    assert.strictEqual(
      adminDelete.body.ok,
      true,
      `管理员受限态下删除展会应当成功：${JSON.stringify(adminDelete.body)}`,
    );
  } finally {
    // 还原：三个种子账号的状态（后面的用例还要用它们），再清掉自造展会（级联清报名；
    // 上面已经删掉的那场会拿到 404，忽略即可）。
    await setStatus('usr-1', 'active');
    await setStatus('usr-2', 'active');
    await setStatus('usr-3', 'active');
    await del(`/api/v1/exhibitions/${exhibitionA}`, { token: tokens.admin.token });
    await del(`/api/v1/exhibitions/${exhibitionB}`, { token: tokens.admin.token });
  }
});
