/**
 * 额度与一次性提示 契约测试。
 *
 * 展商可筹备展会数上限、额度按保存日期计算、调低后的编辑、并发抢最后一个名额、一次性提示的绑定与并发确认。
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
  raceWrites,
  startContract,
  stopContract,
  tokens,
  type HttpResponse,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('展商可同时筹备的展会数上限：超出后不能再新建，管理员不受限', async () => {
  const created: string[] = [];
  const payload = {
    title: '展会数上限用例',
    venue: '测试展馆',
    time: '09:00-17:00',
    date: isoDateAfter(35),
    category: '智能家居',
    status: '无需审核',
    qrEnabled: false,
  };
  try {
    // 种子里的展商本来就有未来的展会，所以先按现状把额度设成「刚好还能再建一个」，
    // 不然第一条就会撞额度（失败原因也会是这句，看不出是测试写错还是规则生效）。
    const listed = await get('/api/v1/exhibitions', { token: tokens.exhibitor.token });
    const today = new Date().toISOString().slice(0, 10);
    const mine = (listed.body as { exhibitor: string; date: string }[]).filter(
      (item) => item.exhibitor === 'exhibitor' && item.date >= today,
    ).length;
    await put('/api/v1/settings', { maxFutureExhibitions: mine + 1 }, { token: tokens.admin.token });

    const first = await post('/api/v1/exhibitions', payload, { token: tokens.exhibitor.token });
    assert.strictEqual(first.body.ok, true, JSON.stringify(first.body));
    created.push(String(first.body.exhibition.id));

    const second = await post('/api/v1/exhibitions', payload, { token: tokens.exhibitor.token });
    assert.strictEqual(second.body.ok, false, '超出上限应当按规则失败');
    assert.match(String(second.body.error), /同时筹备/, `失败原因要说明限额：${second.body.error}`);

    // 管理员不受这条策略限制：额度是管理员自己设的，不该把他锁在门外
    const asAdmin = await post('/api/v1/exhibitions', payload, { token: tokens.admin.token });
    assert.strictEqual(asAdmin.body.ok, true, JSON.stringify(asAdmin.body));
    created.push(String(asAdmin.body.exhibition.id));
  } finally {
    for (const id of created) await del(`/api/v1/exhibitions/${id}`, { token: tokens.admin.token });
    await put('/api/v1/settings', { maxFutureExhibitions: 0 }, { token: tokens.admin.token });
  }
});

/** 给现有展商留一个名额；所有日期由数据库给出，避免测试机时区改变计数口径。 */
async function withOneExhibitionSlot(
  run: (fixture: {
    today: string;
    past: string;
    future: string;
    create: (date: string) => Promise<HttpResponse>;
  }) => Promise<void>,
): Promise<void> {
  const before = await get('/api/v1/settings');
  const dates = await pool.query<{ today: string; past: string; future: string; total: number }>(
    `SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - 1)::text AS past,
      (CURRENT_DATE + 35)::text AS future, count(*)::int AS total FROM exhibitions
      WHERE exhibitor_id = (SELECT id FROM users WHERE username = $1) AND exhibition_date >= CURRENT_DATE`,
    [tokens.exhibitor.user.username],
  );
  const { today, past, future, total } = dates.rows[0]!;
  const created: string[] = [];
  const create = async (date: string) => {
    const response = await post(
      '/api/v1/exhibitions',
      {
        title: '并发额度用例',
        venue: '测试展馆',
        time: '09:00-17:00',
        date,
        category: '智能家居',
        status: '无需审核',
        qrEnabled: false,
      },
      { token: tokens.exhibitor.token },
    );
    if (response.body.exhibition?.id) created.push(String(response.body.exhibition.id));
    return response;
  };
  try {
    const configured = await put(
      '/api/v1/settings',
      { maxFutureExhibitions: total + 1 },
      { token: tokens.admin.token },
    );
    assert.strictEqual(configured.body.ok, true, JSON.stringify(configured.body));
    await run({ today, past, future, create });
  } finally {
    for (const id of created) await del(`/api/v1/exhibitions/${id}`, { token: tokens.admin.token });
    await put(
      '/api/v1/settings',
      {
        maxFutureExhibitions: before.body.exhibitor.maxFutureExhibitions,
      },
      { token: tokens.admin.token },
    );
  }
}

test('展会额度按保存后的日期计算：当天占名额，历史展会不占，改期不能绕过上限', async () => {
  await withOneExhibitionSlot(async ({ today, past, future, create }) => {
    const current = await create(today);
    assert.strictEqual(current.body.ok, true, JSON.stringify(current.body));
    const currentId = String(current.body.exhibition.id);
    const update = (id: string, date: string, token = tokens.exhibitor.token) =>
      put(`/api/v1/exhibitions/${id}`, { title: '额度改期用例', date }, { token });

    const unchangedQuota = await update(currentId, future);
    assert.strictEqual(unchangedQuota.body.ok, true, '已占名额的展会改期不应重复计数');
    const historical = await create(past);
    assert.strictEqual(historical.body.ok, true, '额度已满仍可录入历史展会');
    const historicalId = String(historical.body.exhibition.id);

    const overLimit = await update(historicalId, today);
    assert.strictEqual(overLimit.status, 200);
    assert.strictEqual(overLimit.body.ok, false, '历史展会改到今天也要检查额度');
    assert.match(String(overLimit.body.error), /同时筹备/);
    assert.strictEqual((await get(`/api/v1/exhibitions/${historicalId}`)).body.exhibition.date, past);

    assert.strictEqual((await update(currentId, past)).body.ok, true, '改回过去日期应释放名额');
    assert.strictEqual((await update(historicalId, today)).body.ok, true, '释放后的名额可以用于改期');
    assert.strictEqual((await update(currentId, future, tokens.admin.token)).body.ok, true, '管理员改期不受额度限制');
  });
});

test('展会额度调低后仍可编辑已占名额的展会，但历史改期仍受限', async () => {
  await withOneExhibitionSlot(async ({ today, past, future, create }) => {
    const current = await create(today);
    const extra = await create(past);
    assert.strictEqual(current.body.ok, true, JSON.stringify(current.body));
    assert.strictEqual(extra.body.ok, true, JSON.stringify(extra.body));
    const currentId = String(current.body.exhibition.id);
    const extraId = String(extra.body.exhibition.id);
    const promoted = await put(
      `/api/v1/exhibitions/${extraId}`,
      {
        title: '管理员扩展额度用例',
        date: future,
      },
      { token: tokens.admin.token },
    );
    assert.strictEqual(promoted.body.ok, true, JSON.stringify(promoted.body));

    const lowered = await put('/api/v1/settings', { maxFutureExhibitions: 1 }, { token: tokens.admin.token });
    assert.strictEqual(lowered.body.ok, true, JSON.stringify(lowered.body));
    const edited = await put(
      `/api/v1/exhibitions/${currentId}`,
      {
        title: '额度调低后的标题',
        venue: '更新展馆',
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(edited.body.ok, true, '降低额度不能冻结已有展会的普通编辑');
    const rescheduled = await put(
      `/api/v1/exhibitions/${currentId}`,
      {
        title: '额度调低后的改期',
        date: future,
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(rescheduled.body.ok, true, '未来展会之间改期没有增加名额');
    const historical = await create(past);
    assert.strictEqual(historical.body.ok, true, JSON.stringify(historical.body));
    const expanded = await put(
      `/api/v1/exhibitions/${historical.body.exhibition.id}`,
      {
        title: '额度调低后的历史改期',
        date: future,
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(expanded.body.ok, false, '超额时仍不能增加未来展会');
  });
});

for (const operations of [
  ['新建', '新建'],
  ['新建', '改期'],
  ['改期', '改期'],
] as const) {
  test(`展会额度并发${operations.join('与')}：最后一个名额只能用一次`, async () => {
    await withOneExhibitionSlot(async ({ past, future, create }) => {
      const requests: Array<() => Promise<HttpResponse>> = [];
      const candidateIds: string[] = [];
      for (const operation of operations) {
        if (operation === '新建') {
          requests.push(() => create(future));
        } else {
          const historical = await create(past);
          assert.strictEqual(historical.body.ok, true, JSON.stringify(historical.body));
          const id = String(historical.body.exhibition.id);
          candidateIds.push(id);
          requests.push(() =>
            put(
              `/api/v1/exhibitions/${id}`,
              {
                title: '并发改期用例',
                date: future,
              },
              { token: tokens.exhibitor.token },
            ),
          );
        }
      }
      const results = await raceWrites('exhibitions', requests);
      assert.ok(
        results.every((result) => result.status === 200),
        JSON.stringify(results),
      );
      assert.strictEqual(results.filter((result) => result.body.ok === true).length, 1, JSON.stringify(results));
      const rejected = results.find((result) => result.body.ok === false);
      assert.match(String(rejected?.body.error), /同时筹备/);
      for (const result of results) {
        if (result.body.exhibition?.id) candidateIds.push(String(result.body.exhibition.id));
      }
      const persisted = await Promise.all([...new Set(candidateIds)].map((id) => get(`/api/v1/exhibitions/${id}`)));
      assert.strictEqual(persisted.filter((result) => result.body.exhibition.date === future).length, 1);
    });
  });
}

test('一次性提示与账号绑定：记下之后 bootstrap 会带回来', async () => {
  const key = 'home-calendar-swipe';
  const before = await get('/api/v1/bootstrap', { token: tokens.user.token });
  const hadKey = Array.isArray(before.body.user.seenHints) && before.body.user.seenHints.includes(key);
  assert.strictEqual(hadKey, false, '这条用例自己造数据，开始时不该已存在');

  const saved = await put('/api/v1/profile/hints', { hint: key }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.ok(Array.isArray(saved.body.seenHints) && saved.body.seenHints.includes(key));

  // 幂等：再提交一次不会出现重复项
  const again = await put('/api/v1/profile/hints', { hint: key }, { token: tokens.user.token });
  assert.strictEqual(again.body.seenHints.filter((item: string) => item === key).length, 1);

  // 与账号绑定：换一次请求（等同换设备）仍然带着它，前端据此不再显示提示
  const bootstrap = await get('/api/v1/bootstrap', { token: tokens.user.token });
  assert.ok(bootstrap.body.user.seenHints.includes(key), 'bootstrap 的用户态要带上已读提示');

  // 提示 key 是受控短码：乱填直接拒绝
  const bad = await put('/api/v1/profile/hints', { hint: 'A B' }, { token: tokens.user.token });
  assert.strictEqual(bad.body.ok, false, '非法提示标识应当被拒绝');
});

test('一次性提示并发确认保留各自记录，重复确认幂等且最多保留最近 50 项', async () => {
  const username = tokens.user.user.username;
  const before = await get('/api/v1/bootstrap', { token: tokens.user.token });
  const savedHints = before.body.user.seenHints;
  const original = Array.from({ length: 49 }, (_, index) => `test-hint-${index}`);
  try {
    await pool.query('UPDATE users SET seen_hints = $2 WHERE username = $1', [username, original]);
    const mark = (hint: string) => put('/api/v1/profile/hints', { hint }, { token: tokens.user.token });
    const keys = ['test-hint-concurrent-a', 'test-hint-concurrent-b'];
    const responses = await raceWrites(
      'users',
      keys.map((key) => () => mark(key)),
    );
    assert.ok(
      responses.every((result) => result.status === 200 && result.body.ok),
      JSON.stringify(responses),
    );
    const loaded = await get('/api/v1/bootstrap', { token: tokens.user.token });
    const hints: string[] = loaded.body.user.seenHints;
    assert.strictEqual(hints.length, 50);
    assert.ok(
      keys.every((key) => hints.includes(key)),
      '并发确认的两条提示都应持久保留',
    );
    assert.ok(!hints.includes(original[0]!), '超出上限只移除最早的提示');
    assert.ok(
      original.slice(1).every((key) => hints.includes(key)),
      '其余已读提示不能丢失',
    );

    const duplicate = await raceWrites('users', [() => mark(keys[0]!), () => mark(keys[0]!)]);
    assert.ok(
      duplicate.every((result) => result.body.ok),
      JSON.stringify(duplicate),
    );
    assert.deepStrictEqual((await get('/api/v1/bootstrap', { token: tokens.user.token })).body.user.seenHints, hints);
  } finally {
    await pool.query('UPDATE users SET seen_hints = $2 WHERE username = $1', [username, savedHints]);
  }
});
