import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';
import { requireExhibitor, canManageExhibition } from '../domain/permissions.js';
import { badRequest, forbidden, notFound } from '../domain/errors.js';
import { readSection } from '../domain/settings.js';
import * as labels from '../domain/labels.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';
import { parseSchema } from '../domain/validation.js';
import { reviewQuerySchema, reviewStatusSchema } from '../domain/schemas.js';

const app = new Hono<HonoEnv>();
const REGISTRATION_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['attended', 'rejected', 'cancelled'],
  rejected: ['approved', 'cancelled'],
  attended: [],
  cancelled: ['pending', 'approved'],
};
interface ReviewRecordRow {
  id: string;
  exhibition_id: string;
  visitor_id: string | null;
  visitor_name: string;
  answers: string | null;
  status: string;
  registration_time: string | null;
  exhibition_exhibitor_id: string | null;
  visitor_role?: string | null;
}
interface StatusCountRow {
  status: string;
  total: number;
}
interface ExhibitionScopeRow {
  id: string;
  exhibitor_id: string | null;
}
const REVIEW_COLUMNS = `r.id, r.exhibition_id, r.visitor_id, r.visitor_name, r.answers, r.status, to_char(r.created_at, 'MM-DD HH24:MI') AS registration_time, e.exhibitor_id AS exhibition_exhibitor_id, COALESCE(vu.role, '') AS visitor_role`;
const REVIEW_FROM = `FROM registrations r JOIN exhibitions e ON e.id = r.exhibition_id LEFT JOIN users vu ON vu.id = r.visitor_id`;
async function canReviseByExhibitor() {
  const review = await readSection('review');
  return Boolean(review && review.canRevise === true);
}
function summaryOf(answers: unknown) {
  return String(answers || '')
    .replace(/\n/g, ' ')
    .slice(0, 46);
}
function reviewPayload(row: ReviewRecordRow) {
  return {
    id: row.id,
    exhibitionId: row.exhibition_id,
    visitorId: row.visitor_id || '',
    visitorName: row.visitor_name,
    visitorRole: row.visitor_role || '',
    registrationTime: row.registration_time || '',
    answers: row.answers || '',
    summary: summaryOf(row.answers),
    status: labels.REGISTRATION_STATUS[row.status] || '',
  };
}
async function assertExhibitionScope(exhibitionId: string, user: { userId: string; role: string }) {
  const result = await query<ExhibitionScopeRow>('SELECT id, exhibitor_id FROM exhibitions WHERE id = $1', [
    exhibitionId,
  ]);
  const exhibition = result.rows[0];
  if (!exhibition) throw notFound('展会不存在或已删除');
  if (!canManageExhibition(user, exhibition)) throw forbidden('只能查看自己举办的展会的报名');
  return exhibition;
}
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

app.get('/', authenticateHono, async (c) => {
  const user = requireExhibitor({ user: userOf(c) });
  const exhibitionId = String(c.req.query('exhibitionId') || '').trim();
  const { statusLabel, statusCode } = parseSchema(reviewQuerySchema, { status: c.req.query('status') || '' });
  const scopeParams: unknown[] = [];
  const scope: string[] = [];
  if (exhibitionId) {
    await assertExhibitionScope(exhibitionId, user);
    scopeParams.push(exhibitionId);
    scope.push(`r.exhibition_id = $${scopeParams.length}`);
  } else if (user.role !== 'admin') {
    scopeParams.push(user.userId);
    scope.push(`e.exhibitor_id = $${scopeParams.length}`);
  }
  const scopeSql = scope.length ? `WHERE ${scope.join(' AND ')}` : '';
  const counts: { total: number; [label: string]: number } = { total: 0 };
  for (const label of Object.values(labels.REGISTRATION_STATUS)) counts[label] = 0;
  const grouped = await query<StatusCountRow>(
    `SELECT r.status, count(*)::int AS total ${REVIEW_FROM} ${scopeSql} GROUP BY r.status`,
    scopeParams,
  );
  for (const row of grouped.rows) {
    counts.total += row.total;
    const label = labels.REGISTRATION_STATUS[row.status];
    if (label) counts[label] = row.total;
  }
  const recordParams = [...scopeParams];
  let recordsSql = scopeSql;
  if (statusCode) {
    recordParams.push(statusCode);
    recordsSql = `${scopeSql ? `${scopeSql} AND` : 'WHERE'} r.status = $${recordParams.length}`;
  }
  const records = await query<ReviewRecordRow>(
    `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} ${recordsSql} ORDER BY r.created_at DESC, r.id DESC`,
    recordParams,
  );
  return jsonResponse(c, { exhibitionId, status: statusLabel, records: records.rows.map(reviewPayload), counts });
});
app.get('/:id', authenticateHono, async (c) => {
  const user = requireExhibitor({ user: userOf(c) });
  const result = await query<ReviewRecordRow>(`SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE r.id = $1`, [
    c.req.param('id'),
  ]);
  const row = result.rows[0];
  if (!row || !canManageExhibition(user, { exhibitor_id: row.exhibition_exhibitor_id }))
    return jsonResponse(c, { found: false, error: '报名记录不存在' });
  return jsonResponse(c, { found: true, record: reviewPayload(row) });
});
app.put('/:id/status', authenticateHono, async (c) => {
  const user = requireExhibitor({ user: userOf(c) });
  const result = await query<ReviewRecordRow>(`SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE r.id = $1`, [
    c.req.param('id'),
  ]);
  const row = result.rows[0];
  if (row && !canManageExhibition(user, { exhibitor_id: row.exhibition_exhibitor_id }))
    throw forbidden('只能管理自己举办的展会的报名');
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const { status } = parseSchema(reviewStatusSchema, body);
    if (!row) throw badRequest('报名记录不存在');
    const allowed = REGISTRATION_TRANSITIONS[row.status] || [];
    if (!allowed.includes(status))
      throw badRequest(
        `不能把「${labels.REGISTRATION_STATUS[row.status] || row.status}」的报名改成「${labels.REGISTRATION_STATUS[status]}」`,
      );
    if (user.role !== 'admin' && !(await canReviseByExhibitor())) {
      if (row.status === 'approved' || row.status === 'rejected')
        throw forbidden('管理员未开放修改已通过或已拒绝的报名');
      if (row.status === 'cancelled') throw forbidden('管理员未开放重新审核已撤销的报名');
    }
    try {
      await query('UPDATE registrations SET status = $2, updated_at = now() WHERE id = $1', [row.id, status]);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        throw badRequest('该用户在这场展会上已有未撤销的报名，不能把这条改成此状态');
      throw error;
    }
    return { record: { ...reviewPayload(row), status: labels.REGISTRATION_STATUS[status] } };
  });
});

export function createReviewRoutes() {
  return app;
}
export const REVIEW_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['GET', '/:id'],
  ['PUT', '/:id/status'],
];
