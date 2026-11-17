/**
 * 跨天展会的月视图与「单个展会最大持续天数」契约测试。
 *
 * - 管理设置里的 maxExhibitionDays 限制保存（按开展～闭展含两端算天数，0 不限）；
 * - 月视图按开展～闭展区间把展会铺到每一天：eventDays 加粗、选中日展示、跨月拆分；
 * - 展商自己的展会圆点也按区间铺开。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

async function createExhibition(payload: Record<string, unknown>) {
  return post(
    '/api/v1/exhibitions',
    {
      title: '跨天展会',
      venue: '测试展馆',
      time: '09:00-17:00',
      category: '智能家居',
      status: 'review',
      ...payload,
    },
    { token: tokens.exhibitor.token },
  );
}

test('单个展会最大持续天数：超限拒绝，范围内可保存，设置值收敛', async () => {
  const clampedHigh = await put('/api/v1/settings', { maxExhibitionDays: 999 }, { token: tokens.admin.token });
  assert.strictEqual(clampedHigh.body.settings.exhibitor.maxExhibitionDays, 365, '上限收敛到 365 天');
  const clampedLow = await put('/api/v1/settings', { maxExhibitionDays: -3 }, { token: tokens.admin.token });
  assert.strictEqual(clampedLow.body.settings.exhibitor.maxExhibitionDays, 0, '负数收敛到 0（不限）');

  await put('/api/v1/settings', { maxExhibitionDays: 3 }, { token: tokens.admin.token });
  const tooLong = await createExhibition({ title: '四天展', date: '2026-09-20', endDate: '2026-09-23' });
  assert.strictEqual(tooLong.body.ok, false, '4 天展会应被拒绝');
  assert.strictEqual(tooLong.body.errorCode, 'exhibition.durationTooLong');
  assert.ok(String(tooLong.body.error).includes('3 天'), `提示应带上限：${tooLong.body.error}`);

  const allowed = await createExhibition({ title: '三天展', date: '2026-09-20', endDate: '2026-09-22' });
  assert.strictEqual(allowed.body.ok, true, `3 天展会应允许：${JSON.stringify(allowed.body)}`);

  // 只填开展日（单日展会）永远满足上限
  const single = await createExhibition({ title: '单日展', date: '2026-09-21', endDate: '' });
  assert.strictEqual(single.body.ok, true, JSON.stringify(single.body));
  await put('/api/v1/settings', { maxExhibitionDays: 0 }, { token: tokens.admin.token });
});

test('月视图按开展～闭展区间铺日期，跨月展会拆到两个月', async () => {
  await put('/api/v1/settings', { maxExhibitionDays: 0 }, { token: tokens.admin.token });
  const created = await createExhibition({
    title: '月末跨月展',
    date: '2026-09-29',
    endDate: '2026-10-02',
  });
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const id = String(created.body.exhibition.id);

  const september = await fetchMonth(2026, 9);
  const septItem = september.exhibitions.find((item: { id: string }) => item.id === id);
  assert.deepStrictEqual(septItem.days, [29, 30], '九月只覆盖 29、30 两天');
  assert.deepStrictEqual(septItem.date, '2026-09-29');
  assert.deepStrictEqual(septItem.endDate, '2026-10-02');
  assert.ok(september.eventDays.includes(29) && september.eventDays.includes(30), '区间内日期都要加粗');
  assert.ok(september.markedDays.includes(29) && september.markedDays.includes(30), '展商自己的展会也要按区间打点');

  const septSelected = await fetchMonth(2026, 9, 30);
  assert.strictEqual(septSelected.day, 30);
  assert.ok(
    septSelected.selected.some((item: { id: string }) => item.id === id),
    '选中 30 日时列表里要有跨天展会',
  );

  const october = await fetchMonth(2026, 10);
  const octItem = october.exhibitions.find((item: { id: string }) => item.id === id);
  assert.deepStrictEqual(octItem.days, [1, 2], '十月只覆盖 1、2 两天');
  assert.strictEqual(octItem.day, 1, '本月第一天有展会的日期（旧页面兼容）');
  assert.ok(october.eventDays.includes(1) && october.eventDays.includes(2));
  const octSelected = await fetchMonth(2026, 10, 2);
  assert.ok(
    octSelected.selected.some((item: { id: string }) => item.id === id),
    '选中 10 月 2 日时列表里要有跨天展会',
  );
});

async function fetchMonth(year: number, month: number, day?: number) {
  const { get } = await import('./contract-harness.js');
  const query = `/api/v1/exhibitions/month?year=${year}&month=${month}${day ? `&day=${day}` : ''}`;
  // 圆点只对登录用户计算，用展商自己的身份取月视图。
  const response = await get(query, { token: tokens.exhibitor.token });
  assert.strictEqual(response.status, 200, JSON.stringify(response.body));
  return response.body;
}
