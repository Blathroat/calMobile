/**
 * 展会「注意事项」契约测试。
 *
 * - 编辑/详情接口能读回注意事项，超过 2000 字被服务端拒绝；
 * - 报名详情只在审核通过 / 已参加时下发注意事项，未通过（待审核）时字段为空；
 * - 已参加同样可见（核销后不影响）。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { pool } from '../config/pool.js';
import { get, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

const NOTICE = '请携带身份证\n签到地点：A 口服务台';

async function createExhibition(notice: string) {
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '注意事项测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-12-01',
      endDate: '2026-12-03',
      category: '智能家居',
      status: 'review',
      registrationNotice: notice,
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  return String(created.body.exhibition.id);
}

test('展会保存并读回注意事项，超过 2000 字被拒绝', async () => {
  const id = await createExhibition(NOTICE);
  const detail = await get(`/api/v1/exhibitions/${id}`);
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.exhibition.registrationNotice, NOTICE, '注意事项目标内容要原样读回');

  // 更新接口要求带上完整表单（标题等必填字段），与编辑页保存一致。
  const updated = await put(
    `/api/v1/exhibitions/${id}`,
    {
      title: '注意事项测试展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-12-01',
      endDate: '2026-12-03',
      category: '智能家居',
      status: 'review',
      registrationNotice: '更新后的注意事项',
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(updated.body.ok, true, JSON.stringify(updated.body));
  assert.strictEqual(updated.body.exhibition.registrationNotice, '更新后的注意事项');

  const tooLong = await post(
    '/api/v1/exhibitions',
    {
      title: '超长注意事项',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: '2026-12-01',
      category: '智能家居',
      status: 'review',
      registrationNotice: '甲'.repeat(2001),
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(tooLong.body.ok, false, '超过 2000 字应被拒绝');
  assert.strictEqual(tooLong.body.errorCode, 'validation.tooLong');
});

test('报名详情只在审核通过 / 已参加时下发注意事项', async () => {
  const id = await createExhibition(NOTICE);
  const registered = await post(
    '/api/v1/registrations',
    { exhibitionId: id, visitorName: '接口测试用户', visitorType: '专业观众' },
    { token: tokens.user.token },
  );
  assert.strictEqual(registered.body.ok, true, JSON.stringify(registered.body));
  const registrationId = String(registered.body.registration?.id || '');
  assert.ok(registrationId);

  const pending = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
  assert.strictEqual(pending.body.registration.statusCode, 'pending');
  assert.strictEqual(pending.body.registration.exhibitionNotice, '', '待审核时不下发注意事项');

  await pool.query(`UPDATE registrations SET status = 'approved' WHERE id = $1`, [registrationId]);
  const approved = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
  assert.strictEqual(approved.body.registration.statusCode, 'approved');
  assert.strictEqual(approved.body.registration.exhibitionNotice, NOTICE, '通过审核后展示注意事项');

  await pool.query(`UPDATE registrations SET status = 'attended' WHERE id = $1`, [registrationId]);
  const attended = await get(`/api/v1/registrations/${registrationId}`, { token: tokens.user.token });
  assert.strictEqual(attended.body.registration.exhibitionNotice, NOTICE, '已参加仍可见');
});
