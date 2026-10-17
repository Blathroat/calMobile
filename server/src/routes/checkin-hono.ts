import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { REGISTRATION_COLUMNS, REGISTRATION_FROM } from '../domain/queries.js';
import type { RegistrationRow } from '../domain/payloads.js';
import { requireExhibitor, canManageExhibition, assertNotLimited } from '../domain/permissions.js';
import * as labels from '../domain/labels.js';
import { readJsonBody } from '../http/body-limit.js';
import { jsonResponse } from '../http/respond.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';
import { parseSchema } from '../domain/validation.js';
import { checkinSchema } from '../domain/schemas.js';

const app = new Hono<HonoEnv>();
/**
 * 核销要用的报名列：在通用报名列之上再取两个展示用字符串。
 *
 * 时间一律用 `to_char` 取成字符串：核销时间要精确到秒，而 `REGISTRATION_COLUMNS`
 * 里的 `r.check_in_time` 是时间戳，交给 driver 会按本机时区变成 Date。
 * 因此这里另起别名 `check_in_time_text`，避免与通用列重名（重名时 pg 只留后者）。
 */
const CHECKIN_COLUMNS = `${REGISTRATION_COLUMNS}, to_char(r.created_at, 'MM-DD HH24:MI') AS registration_time, to_char(r.check_in_time, 'YYYY-MM-DD HH24:MI:SS') AS check_in_time_text`;
interface CheckInRow extends RegistrationRow {
  registration_time?: string | null;
  check_in_time_text?: string | null;
}
/** 核销结果里的报名信息：`answers` 保留原始多行文本，由页面按收集项逐行渲染。 */
function checkInRecord(row: CheckInRow) {
  return {
    recordId: row.id,
    visitorName: row.visitor_name,
    exhibitionId: row.exhibition_id,
    exhibitionTitle: row.exhibition_title || '',
    registrationTime: row.registration_time || '',
    answers: String(row.answers ?? ''),
    checkInTime: row.check_in_time_text || '',
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
  const { code } = parseSchema(checkinSchema, body);
  const parsed = labels.parseCheckInCode(code);
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
  // 报名码里的凭据必须与行上的一致：报名被退回重审后凭据已轮换，旧二维码到这里失效。
  // 空的凭据（迁移前的老码、老数据）同样判失效，不给它蒙混过状态判断的机会。
  const secret = String(row.check_in_secret || '');
  if (!secret || secret !== parsed.secret)
    return jsonResponse(c, { ok: false, error: '报名码已失效，请在报名详情里重新打开二维码', record });
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
  // RETURNING 把本次写入的核销时间带回来：核销时间由数据库 now() 决定，不能拿旧行。
  const updated = await query<{ check_in_time_text: string | null }>(
    `UPDATE registrations SET status = 'attended', check_in_time = now(), updated_at = now() WHERE id = $1 AND status = 'approved' RETURNING to_char(check_in_time, 'YYYY-MM-DD HH24:MI:SS') AS check_in_time_text`,
    [row.id],
  );
  if (updated.rowCount === 0) {
    // 并发下另一个请求先核销成功：这次算重复，回读那一次留下的时间。
    const raced = await query<{ check_in_time_text: string | null }>(
      `SELECT to_char(check_in_time, 'YYYY-MM-DD HH24:MI:SS') AS check_in_time_text FROM registrations WHERE id = $1`,
      [row.id],
    );
    return jsonResponse(c, {
      ok: false,
      duplicated: true,
      status: labels.REGISTRATION_STATUS.attended,
      error: `${row.visitor_name} 的报名码已经核销过了`,
      record: { ...record, checkInTime: raced.rows[0]?.check_in_time_text || '' },
    });
  }
  return jsonResponse(c, {
    ok: true,
    duplicated: false,
    status: labels.REGISTRATION_STATUS.attended,
    message: `已核销 ${row.visitor_name} 的报名`,
    error: '',
    record: { ...record, checkInTime: updated.rows[0]?.check_in_time_text || '' },
  });
});

export function createCheckinRoutes() {
  return app;
}
export const CHECKIN_ENDPOINTS: readonly [string, string][] = [['POST', '/']];
