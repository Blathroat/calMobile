import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { REGISTRATION_COLUMNS, REGISTRATION_FROM } from '../domain/queries.js';
import type { RegistrationRow } from '../domain/payloads.js';
import { requireExhibitor, canManageExhibition, assertNotLimited } from '../domain/permissions.js';
import * as labels from '../domain/labels.js';
import { readJsonBody } from '../http/body-limit.js';
import { jsonResponse } from '../http/respond.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();
const CHECKIN_COLUMNS = `${REGISTRATION_COLUMNS}, to_char(r.created_at, 'MM-DD HH24:MI') AS registration_time`;
interface CheckInRow extends RegistrationRow {
  registration_time?: string | null;
}
function summaryOf(answers: unknown) {
  return String(answers || '')
    .replace(/\n/g, ' ')
    .slice(0, 46);
}
function checkInRecord(row: CheckInRow) {
  return {
    recordId: row.id,
    visitorName: row.visitor_name,
    exhibitionId: row.exhibition_id,
    exhibitionTitle: row.exhibition_title || '',
    registrationTime: row.registration_time || '',
    answers: summaryOf(row.answers),
  };
}
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

app.post('/', authenticateHono, async (c) => {
  const user = userOf(c);
  assertNotLimited(user, 'checkin');
  const exhibitor = requireExhibitor({ user });
  const body = bodyRecord(await readJsonBody(c));
  const parsed = labels.parseCheckInCode(String(body.code || '').trim());
  if (!parsed) return jsonResponse(c, { ok: false, error: '无法识别的报名码，请扫描报名详情里的二维码' });
  const result = await query<CheckInRow>(`SELECT ${CHECKIN_COLUMNS} ${REGISTRATION_FROM} WHERE r.id = $1`, [
    parsed.registrationId,
  ]);
  const row = result.rows[0];
  if (!row) return jsonResponse(c, { ok: false, error: '报名记录不存在，可能已被撤销' });
  if (row.exhibition_id !== parsed.exhibitionId) return jsonResponse(c, { ok: false, error: '报名码与展会不匹配' });
  const record = checkInRecord(row);
  if (!canManageExhibition(exhibitor, { exhibitor_id: row.exhibition_exhibitor_id }))
    return jsonResponse(c, { ok: false, error: '该报名不属于你举办的展会', record });
  const statusLabel = labels.REGISTRATION_STATUS[row.status] || '';
  if (row.status === 'attended')
    return jsonResponse(c, {
      ok: false,
      duplicated: true,
      status: statusLabel,
      error: `${row.visitor_name} 的报名码已经核销过了`,
      record,
    });
  if (row.status !== 'approved')
    return jsonResponse(c, {
      ok: false,
      status: statusLabel,
      error: `当前状态为「${statusLabel}」，只有已通过的报名可以核销`,
      record,
    });
  const updated = await query(
    `UPDATE registrations SET status = 'attended', check_in_time = now(), updated_at = now() WHERE id = $1 AND status = 'approved'`,
    [row.id],
  );
  if (updated.rowCount === 0)
    return jsonResponse(c, {
      ok: false,
      duplicated: true,
      status: labels.REGISTRATION_STATUS.attended,
      error: `${row.visitor_name} 的报名码已经核销过了`,
      record,
    });
  return jsonResponse(c, {
    ok: true,
    duplicated: false,
    status: labels.REGISTRATION_STATUS.attended,
    message: `已核销 ${row.visitor_name} 的报名`,
    error: '',
    record,
  });
});

export function createCheckinRoutes() {
  return app;
}
export const CHECKIN_ENDPOINTS: readonly [string, string][] = [['POST', '/']];
