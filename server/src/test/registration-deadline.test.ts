/**
 * 已截止报名 契约测试。
 *
 * 「已截止报名」由数据库按 `CURRENT_DATE > registration_end` 判定，且只在报名方式仍是
 * 需审核 / 无需审核时成立：
 * - 列表 / 月视图 / 详情 / 搜索结果都下发 `registrationEnded`，并把 `openForRegistration` 置为 false；
 * - 截止日当天仍可报名；没有截止日、截止日未到、报名开始日未到都不算截止；
 * - 仅展示 / 截止报名 / 已结束保持自己的状态文案，不被当成「已截止报名」。
 *
 * 日期统一取数据库的 CURRENT_DATE：判定口径就在数据库里，不要在测试里另算一套。
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { del, get, post, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/** 数据库口径的今天与前后几天（YYYY-MM-DD），用来构造报名窗口。 */
async function currentDates() {
  const result = await pool.query<{ today: string; yesterday: string; tomorrow: string; in_a_week: string }>(
    `SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - 1)::text AS yesterday,
            (CURRENT_DATE + 1)::text AS tomorrow, (CURRENT_DATE + 7)::text AS in_a_week`,
  );
  return result.rows[0]!;
}

/** 按日期字符串拆出月视图接口需要的年、月。 */
function yearMonthOf(date: string): { year: number; month: number } {
  const [year, month] = date.split('-').map(Number);
  return { year: year!, month: month! };
}

/** 用展商身份新建一场展会，返回展会 id。 */
async function createExhibition(options: {
  title: string;
  date: string;
  status: string;
  registrationStart?: string;
  registrationEnd?: string;
}): Promise<string> {
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: options.title,
      venue: '测试展馆',
      time: '09:00-17:00',
      date: options.date,
      category: '智能家居',
      status: options.status,
      ...(options.registrationStart ? { registrationStart: options.registrationStart } : {}),
      ...(options.registrationEnd ? { registrationEnd: options.registrationEnd } : {}),
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, `新建展会失败：${JSON.stringify(created.body)}`);
  return String(created.body.exhibition.id);
}

/** 取列表 / 详情 / 月视图里的同一场展会，三处下发口径必须一致。 */
async function readEverywhere(id: string, date: string) {
  const list = await get('/api/v1/exhibitions');
  const listed = list.body.find((item: { id: string }) => item.id === id);
  assert.ok(listed, `列表里缺少展会 ${id}`);

  const detail = await get(`/api/v1/exhibitions/${id}`);
  assert.strictEqual(detail.body.found, true, JSON.stringify(detail.body));

  const { year, month } = yearMonthOf(date);
  const monthView = await get(`/api/v1/exhibitions/month?year=${year}&month=${month}`);
  const summary = monthView.body.exhibitions.find((item: { id: string }) => item.id === id);
  assert.ok(summary, `月视图里缺少展会 ${id}`);

  return { listed, detail: detail.body.exhibition, summary };
}

async function removeExhibitions(ids: string[]): Promise<void> {
  for (const id of ids) await del(`/api/v1/exhibitions/${id}`, { token: tokens.admin.token });
}

test('报名截止日已过：列表 / 月视图 / 详情下发 registrationEnded，且不再可报名', async () => {
  const { today, yesterday } = await currentDates();
  const created: string[] = [];
  try {
    const review = await createExhibition({
      title: '截止日已过的需审核展',
      date: today,
      status: 'review',
      registrationEnd: yesterday,
    });
    created.push(review);
    const optional = await createExhibition({
      title: '截止日已过的无需审核展',
      date: today,
      status: 'optional',
      registrationEnd: yesterday,
    });
    created.push(optional);

    // 契约：列表里每一项都带布尔 registrationEnded。
    const list = await get('/api/v1/exhibitions');
    for (const item of list.body) {
      assert.strictEqual(typeof item.registrationEnded, 'boolean', `展会 ${item.id} 缺少 registrationEnded`);
    }

    for (const id of [review, optional]) {
      const { listed, detail, summary } = await readEverywhere(id, today);
      for (const [where, item] of [
        ['列表', listed],
        ['详情', detail],
        ['月视图', summary],
      ] as const) {
        assert.strictEqual(
          item.registrationEnded,
          true,
          `${where}应下发 registrationEnded=true：${JSON.stringify(item)}`,
        );
        assert.strictEqual(item.openForRegistration, false, `${where}在报名截止后不应再可报名`);
      }
    }
  } finally {
    await removeExhibitions(created);
  }
});

test('截止日当天、未到截止日、没有截止日都不算截止', async () => {
  const { today, tomorrow, in_a_week } = await currentDates();
  const created: string[] = [];
  try {
    const cases = [
      // 截止日就是今天：当天仍然可报名。
      { title: '今天截止的展会', registrationEnd: today },
      { title: '明天截止的展会', registrationEnd: tomorrow },
      // 没有截止日：报名一直有效。
      { title: '没有截止日的展会', registrationEnd: undefined },
    ];
    for (const item of cases) {
      const id = await createExhibition({
        title: item.title,
        date: today,
        status: 'review',
        registrationEnd: item.registrationEnd,
      });
      created.push(id);
      const { listed, detail, summary } = await readEverywhere(id, today);
      for (const [where, row] of [
        ['列表', listed],
        ['详情', detail],
        ['月视图', summary],
      ] as const) {
        assert.strictEqual(row.registrationEnded, false, `${where}（${item.title}）不应算已截止`);
        assert.strictEqual(row.openForRegistration, true, `${where}（${item.title}）仍应可报名`);
      }
    }

    // 报名开始日还没到：属于「尚未开始」，不是「已截止」。开始日不是这次改动的判定口径，
    // 因此这里只钉 registrationEnded，不规定开始日之前能不能报名。
    const notStarted = await createExhibition({
      title: '报名未开始的展会',
      date: today,
      status: 'review',
      registrationStart: tomorrow,
      registrationEnd: in_a_week,
    });
    created.push(notStarted);
    const notStartedRows = await readEverywhere(notStarted, today);
    for (const [where, row] of [
      ['列表', notStartedRows.listed],
      ['详情', notStartedRows.detail],
      ['月视图', notStartedRows.summary],
    ] as const) {
      assert.strictEqual(row.registrationEnded, false, `${where}在报名开始日之前不应算已截止`);
    }
  } finally {
    await removeExhibitions(created);
  }
});

test('仅展示 / 截止报名 / 已结束不会被当成「已截止报名」', async () => {
  const { today, yesterday } = await currentDates();
  const created: string[] = [];
  try {
    const statuses = ['display', 'closed', 'ended'];
    for (const status of statuses) {
      const id = await createExhibition({
        title: `${status} 状态且截止日已过`,
        date: today,
        status,
        registrationEnd: yesterday,
      });
      created.push(id);
      const { listed, detail, summary } = await readEverywhere(id, today);
      for (const [where, row] of [
        ['列表', listed],
        ['详情', detail],
        ['月视图', summary],
      ] as const) {
        assert.strictEqual(row.registrationEnded, false, `${where}（${status}）不应被当成已截止报名`);
        assert.strictEqual(row.statusCode, status, `${where}应保持原报名方式`);
        assert.strictEqual(row.openForRegistration, false, `${where}（${status}）本来就不能报名`);
      }
    }
  } finally {
    await removeExhibitions(created);
  }
});

test('搜索结果同样带 registrationEnded', async () => {
  const { today, yesterday } = await currentDates();
  const created: string[] = [];
  try {
    const id = await createExhibition({
      title: '已截止搜索专用展会',
      date: today,
      status: 'review',
      registrationEnd: yesterday,
    });
    created.push(id);
    const response = await get('/api/v1/search?query=已截止搜索专用展会');
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const found = response.body.exhibitions.find((item: { id: string }) => item.id === id);
    assert.ok(found, `搜索结果里缺少展会 ${id}：${JSON.stringify(response.body)}`);
    assert.strictEqual(found.registrationEnded, true);
    assert.strictEqual(found.openForRegistration, false);
  } finally {
    await removeExhibitions(created);
  }
});
