import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { REGISTRATION_COLUMNS, REGISTRATION_FROM, EXHIBITION_COLUMNS, EXHIBITION_FROM } from '../domain/queries.js';
import { registrationPayload, type ExhibitionRow, type RegistrationRow } from '../domain/payloads.js';
import { loadFields } from './exhibitions-hono.js';
import { requireUser, assertNotLimited } from '../domain/permissions.js';
import { badRequest, forbidden } from '../domain/errors.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';
import * as labels from '../domain/labels.js';
import { limits as readLimits, parseSchema } from '../domain/validation.js';
import { registrationSchema, registrationTargetSchema } from '../domain/schemas.js';

const app = new Hono<HonoEnv>();
const DUPLICATE_MESSAGE = '已提交过该展会的报名';
function closedMessage(statusCode: string) {
  if (statusCode === 'display') return '该展会仅展示，不开放报名';
  if (statusCode === 'closed') return '该展会已截止报名';
  if (statusCode === 'ended') return '该展会已结束';
  return '该展会当前不可报名';
}
interface ExhibitionWindowRow extends ExhibitionRow {
  before_start: boolean;
  after_end: boolean;
}
async function loadExhibition(id: string) {
  const result = await query<ExhibitionWindowRow>(
    `SELECT ${EXHIBITION_COLUMNS}, (e.registration_start IS NOT NULL AND CURRENT_DATE < e.registration_start) AS before_start, (e.registration_end IS NOT NULL AND CURRENT_DATE > e.registration_end) AS after_end ${EXHIBITION_FROM} WHERE e.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}
async function loadRegistration(id: string) {
  const result = await query<RegistrationRow>(`SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.id = $1`, [
    id,
  ]);
  return result.rows[0] || null;
}
const EMPTY_ANSWER = '未填写';
function answerValue(answers: unknown, title: string) {
  for (const line of String(answers ?? '').split('\n'))
    for (const separator of ['：', ':']) {
      const prefix = `${title}${separator}`;
      if (line.startsWith(prefix)) {
        const value = line.slice(prefix.length).trim();
        return value === EMPTY_ANSWER ? '' : value;
      }
    }
  return '';
}
function splitChoices(value: string) {
  return String(value || '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function validateAnswers(fields: Awaited<ReturnType<typeof loadFields>>, answers: unknown) {
  for (const field of fields) {
    const value = answerValue(answers, field.title);
    if (!value) {
      if (field.required) throw badRequest(`请填写「${field.title}」`);
      continue;
    }
    if (field.type !== '单选' && field.type !== '多选') continue;
    const options = Array.isArray(field.options) ? field.options : [];
    const chosen = field.type === '多选' ? splitChoices(value) : [value];
    if (options.length > 0 && chosen.some((item) => !options.includes(item)))
      throw badRequest(`「${field.title}」只能选择：${options.join(' / ')}`);
  }
}
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

app.get('/', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const result = await query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.visitor_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [user.userId],
  );
  return jsonResponse(c, result.rows.map(registrationPayload));
});
app.get('/:id', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const row = await loadRegistration(c.req.param('id'));
  if (!row || (row.visitor_id !== user.userId && user.role !== 'admin'))
    return jsonResponse(c, { found: false, error: '报名记录不存在或已撤销' });
  return jsonResponse(c, { found: true, registration: registrationPayload(row) });
});
app.post('/', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  assertNotLimited(user, 'register');
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const { exhibitionId } = parseSchema(registrationTargetSchema, body);
    if (!exhibitionId) throw badRequest('请选择要报名的展会');
    const exhibition = await loadExhibition(exhibitionId);
    if (!exhibition) throw badRequest('展会不存在或已删除');
    if (!labels.acceptsRegistration(exhibition.status)) throw badRequest(closedMessage(exhibition.status));
    const existing = await query(
      `SELECT id FROM registrations WHERE exhibition_id = $1 AND visitor_id = $2 AND status <> 'cancelled' LIMIT 1`,
      [exhibitionId, user.userId],
    );
    if (existing.rows.length > 0) throw badRequest(DUPLICATE_MESSAGE);
    if (exhibition.before_start) throw badRequest('报名尚未开始');
    if (exhibition.after_end) throw badRequest('报名已截止');
    const answerMax = Number((await readLimits()).answer) || 0;
    const { visitorName, visitorType, answers } = parseSchema(registrationSchema(answerMax), body);
    validateAnswers(await loadFields(exhibitionId), answers);
    const autoApproved = exhibition.status === 'optional';
    const status = autoApproved ? 'approved' : 'pending';
    const id = `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await query(
        `INSERT INTO registrations (id, exhibition_id, visitor_id, visitor_name, visitor_type, answers, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, exhibitionId, user.userId, visitorName, visitorType, answers, status],
      );
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        throw badRequest(DUPLICATE_MESSAGE);
      throw error;
    }
    const created = await loadRegistration(id);
    return {
      autoApproved,
      statusLabel: labels.REGISTRATION_STATUS[status],
      registration: registrationPayload(created!),
    };
  });
});
app.delete('/:id', authenticateHono, async (c) =>
  mutate(c, async () => {
    const user = requireUser({ user: userOf(c) }, '请先登录后再操作');
    const result = await query<{ id: string; visitor_id: string | null; status: string }>(
      'SELECT id, visitor_id, status FROM registrations WHERE id = $1',
      [c.req.param('id')],
    );
    const row = result.rows[0];
    if (!row) throw badRequest('报名记录不存在或已撤销');
    if (row.visitor_id !== user.userId) throw forbidden('只能撤销自己的报名');
    if (row.status === 'cancelled') throw badRequest('该报名已撤销，无需重复操作');
    if (row.status === 'attended') throw badRequest('已参加的报名不能再撤销');
    await query(`UPDATE registrations SET status = 'cancelled', updated_at = now() WHERE id = $1`, [row.id]);
    return {};
  }),
);

export function createRegistrationsRoutes() {
  return app;
}
export const REGISTRATION_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['GET', '/:id'],
  ['POST', '/'],
  ['DELETE', '/:id'],
];
