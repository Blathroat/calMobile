import { Hono } from 'hono';
import type { PoolClient } from 'pg';
import { query, transaction } from '../config/pool.js';
import { EXHIBITION_COLUMNS, EXHIBITION_FROM } from '../domain/queries.js';
import { exhibitionPayload, fieldPayload, type ExhibitionRow, type FieldRow } from '../domain/payloads.js';
import { requireExhibitor, assertCanManageExhibition, assertNotLimited } from '../domain/permissions.js';
import { readSection } from '../domain/settings.js';
import { withExhibitionQuota } from '../domain/exhibition-quota.js';
import { limits, parseSchema } from '../domain/validation.js';
import {
  exhibitionInputSchema,
  fieldsSchema,
  monthQuerySchema,
  exhibitionStatusSchema,
  type ExhibitionInput,
} from '../domain/schemas.js';
import { notFound } from '../domain/errors.js';
import * as labels from '../domain/labels.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';
import { authenticateHono, optionalAuthHono, userOf, type HonoContext, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();
const NOT_FOUND_TEXT = '展会不存在或已删除';

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function likePattern(keyword: string) {
  return `%${keyword.replace(/([\\%_])/g, '\\$1')}%`;
}
async function findRow(id: string) {
  const result = await query<ExhibitionRow>(`SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM} WHERE e.id = $1`, [id]);
  return result.rows[0] || null;
}
async function landingMonth() {
  const result = await query<{ year: number; month: number }>(`SELECT EXTRACT(YEAR FROM exhibition_date)::int AS year,
    EXTRACT(MONTH FROM exhibition_date)::int AS month FROM exhibitions ORDER BY exhibition_date LIMIT 1`);
  const row = result.rows[0];
  if (row) return { year: row.year, month: row.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
interface MonthMeetingRow {
  id: string;
  day: number;
  meeting_time: string;
  status: string;
  exhibitor_id: string;
  visitor_name: string;
  exhibitor_name: string;
  exhibitor_role: string;
  visitor_role: string;
}

/** 当天列表里的私人会议：申请人看到主办人，主办人看到申请人。已拒绝、已撤销不返回。 */
async function monthMeetings(year: number, month: number, userId: string) {
  const result = await query<MonthMeetingRow>(
    `SELECT m.id,
            EXTRACT(DAY FROM m.meeting_date)::int AS day,
            m.meeting_time,
            m.status,
            m.exhibitor_id,
            COALESCE(m.visitor_name, '') AS visitor_name,
            COALESCE(eu.nickname, '') AS exhibitor_name,
            COALESCE(eu.role, '') AS exhibitor_role,
            COALESCE(vu.role, '') AS visitor_role
       FROM private_meetings m
       JOIN users eu ON eu.id = m.exhibitor_id
       LEFT JOIN users vu ON vu.id = m.visitor_id
      WHERE m.status IN ('pending', 'approved')
        AND (m.visitor_id = $3 OR m.exhibitor_id = $3)
        AND EXTRACT(YEAR FROM m.meeting_date)::int = $1
        AND EXTRACT(MONTH FROM m.meeting_date)::int = $2
      ORDER BY m.meeting_date, m.meeting_time, m.id`,
    [year, month, userId],
  );
  return result.rows.map((row) => {
    const host = row.exhibitor_id === userId;
    return {
      id: row.id,
      day: row.day,
      meetingTime: row.meeting_time || '',
      status: labels.REGISTRATION_STATUS[row.status] || '',
      role: host ? 'host' : 'visitor',
      title: host ? row.visitor_name : row.exhibitor_name,
      titleRole: host ? row.visitor_role || '' : row.exhibitor_role || '',
    };
  });
}

function monthSummary(item: ReturnType<typeof exhibitionPayload>) {
  return {
    id: item.id,
    day: item.day,
    title: item.title,
    time: item.time,
    venue: item.venue,
    status: item.status,
    modeLabel: item.modeLabel,
    openForRegistration: item.openForRegistration,
    imageUri: item.imageUri,
    category: item.category,
  };
}
export async function loadFields(exhibitionId: string) {
  const result = await query<FieldRow>(
    `SELECT id, title, type, required, options FROM exhibition_fields
    WHERE exhibition_id = $1 ORDER BY position, id`,
    [exhibitionId],
  );
  return result.rows.map(fieldPayload);
}
type NormalizedField = NonNullable<ExhibitionInput['fields']>[number];
async function replaceFields(client: PoolClient, exhibitionId: string, fields: NormalizedField[]) {
  await client.query('DELETE FROM exhibition_fields WHERE exhibition_id = $1', [exhibitionId]);
  for (const [index, item] of fields.entries()) {
    await client.query(
      `INSERT INTO exhibition_fields (id, exhibition_id, title, type, required, options, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId('field'), exhibitionId, item.title, item.type, item.required, JSON.stringify(item.options), index],
    );
  }
}
async function exhibitionInput(body: Record<string, unknown> | null | undefined, existing?: ExhibitionRow | null) {
  const config = await limits();
  return parseSchema(exhibitionInputSchema(config, existing || undefined), body || {});
}
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function requireExhibitorHono(c: HonoContext) {
  return requireExhibitor({ user: userOf(c) });
}
function checkLimited(c: HonoContext, action: string) {
  assertNotLimited(userOf(c), action);
}
async function manageableRow(c: HonoContext, id: string) {
  const row = await findRow(id);
  if (!row) throw notFound(NOT_FOUND_TEXT);
  assertCanManageExhibition(userOf(c), row);
  return row;
}

app.get('/', optionalAuthHono, async (c) => {
  const keyword = String(c.req.query('query') || '').trim();
  const params: string[] = [];
  let where = '';
  if (keyword) {
    params.push(likePattern(keyword));
    where = 'WHERE e.title ILIKE $1 OR e.venue ILIKE $1 OR e.category ILIKE $1 OR e.description ILIKE $1';
  }
  const result = await query<ExhibitionRow>(
    `SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM} ${where} ORDER BY e.exhibition_date, e.id`,
    params,
  );
  return jsonResponse(c, result.rows.map(exhibitionPayload));
});
app.get('/month', optionalAuthHono, async (c) => {
  let requestedYear: unknown = c.req.query('year');
  let requestedMonth: unknown = c.req.query('month');
  if (!requestedYear || !requestedMonth) {
    const landing = await landingMonth();
    requestedYear ||= landing.year;
    requestedMonth ||= landing.month;
  }
  const month = parseSchema(monthQuerySchema, {
    year: requestedYear,
    month: requestedMonth,
    day: c.req.query('day'),
  });
  const year = month.year;
  const monthNumber = month.month;
  let day = month.day;
  const result = await query<ExhibitionRow>(
    `SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM}
    WHERE EXTRACT(YEAR FROM e.exhibition_date)::int = $1 AND EXTRACT(MONTH FROM e.exhibition_date)::int = $2 ORDER BY e.exhibition_date, e.id`,
    [year, monthNumber],
  );
  const items = result.rows.map(exhibitionPayload);
  const eventDays = [...new Set(items.map((item) => item.day))].sort((a, b) => Number(a) - Number(b));
  if (day <= 0) day = eventDays[0] || 0;
  // 圆点只标「和当前用户有关」的日期；有展会的日期仍由 eventDays 表示（日历把日期加粗）。
  const viewer = userOf(c);
  let markedDays: number[] = [];
  if (viewer?.userId) {
    const marked = await query<{ day: number }>(
      `SELECT DISTINCT day FROM (
         SELECT EXTRACT(DAY FROM e.exhibition_date)::int AS day
           FROM registrations r
           JOIN exhibitions e ON e.id = r.exhibition_id
          WHERE r.visitor_id = $3 AND r.status IN ('approved', 'attended')
            AND EXTRACT(YEAR FROM e.exhibition_date)::int = $1
            AND EXTRACT(MONTH FROM e.exhibition_date)::int = $2
         UNION
         SELECT EXTRACT(DAY FROM e.exhibition_date)::int
           FROM exhibitions e
          WHERE e.exhibitor_id = $3
            AND EXTRACT(YEAR FROM e.exhibition_date)::int = $1
            AND EXTRACT(MONTH FROM e.exhibition_date)::int = $2
         UNION
         SELECT EXTRACT(DAY FROM m.meeting_date)::int
           FROM private_meetings m
          WHERE m.status IN ('pending', 'approved') AND (m.visitor_id = $3 OR m.exhibitor_id = $3)
            AND EXTRACT(YEAR FROM m.meeting_date)::int = $1
            AND EXTRACT(MONTH FROM m.meeting_date)::int = $2
       ) days
       ORDER BY day`,
      [year, monthNumber, viewer.userId],
    );
    markedDays = marked.rows.map((row) => row.day);
  }
  const meetings = viewer?.userId ? await monthMeetings(year, monthNumber, viewer.userId) : [];
  return jsonResponse(c, {
    year,
    month: monthNumber,
    day,
    monthLabel: `${year} 年 ${monthNumber} 月`,
    eventDays,
    markedDays,
    exhibitions: items.map(monthSummary),
    meetings,
    selected: items.filter((item) => item.day === day).map(monthSummary),
  });
});
app.get('/categories', optionalAuthHono, async (c) => {
  const categories = await readSection('categories');
  return jsonResponse(c, Array.isArray(categories) ? categories : []);
});
app.get('/:id', optionalAuthHono, async (c) => {
  const row = await findRow(c.req.param('id'));
  if (!row) return jsonResponse(c, { found: false, error: NOT_FOUND_TEXT });
  return jsonResponse(c, { found: true, exhibition: exhibitionPayload(row), fields: await loadFields(row.id) });
});
app.get('/:id/fields', optionalAuthHono, async (c) => jsonResponse(c, await loadFields(c.req.param('id'))));

app.post('/', authenticateHono, async (c) => {
  checkLimited(c, 'exhibition');
  const user = requireExhibitorHono(c);
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const input = await exhibitionInput(body);
    const id = newId('exh');
    await withExhibitionQuota(user, { exhibitorId: user.userId, date: input.date }, async (client) => {
      await client.query(
        `INSERT INTO exhibitions (id, title, venue, time, exhibition_date, status, category, description, description_format, image_uri, exhibitor_note, registration_start, registration_end, qr_enabled, allow_cancel, exhibitor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          input.title,
          input.venue,
          input.time,
          input.date,
          input.status,
          input.category,
          input.description,
          input.descriptionFormat,
          input.imageUri,
          input.exhibitorNote,
          input.registrationStart || null,
          input.registrationEnd || null,
          input.qrEnabled,
          input.allowCancel,
          user.userId,
        ],
      );
      if (input.fields) await replaceFields(client, id, input.fields);
    });
    return { exhibition: exhibitionPayload((await findRow(id))!) };
  });
});
app.put('/:id', authenticateHono, async (c) => {
  checkLimited(c, 'exhibitionUpdate');
  const user = requireExhibitorHono(c);
  const existing = await manageableRow(c, c.req.param('id'));
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const input = await exhibitionInput(body, existing);
    await withExhibitionQuota(
      user,
      { id: existing.id, exhibitorId: existing.exhibitor_id, date: input.date },
      async (client) => {
        await client.query(
          `UPDATE exhibitions SET title=$2, venue=$3, time=$4, exhibition_date=$5, status=$6, category=$7, description=$8, description_format=$9, image_uri=$10, exhibitor_note=$11, registration_start=$12, registration_end=$13, qr_enabled=$14, allow_cancel=$15, updated_at=now() WHERE id=$1`,
          [
            existing.id,
            input.title,
            input.venue,
            input.time,
            input.date,
            input.status,
            input.category,
            input.description,
            input.descriptionFormat,
            input.imageUri,
            input.exhibitorNote,
            input.registrationStart || null,
            input.registrationEnd || null,
            input.qrEnabled,
            input.allowCancel,
          ],
        );
        if (input.fields) await replaceFields(client, existing.id, input.fields);
      },
    );
    return { exhibition: exhibitionPayload((await findRow(existing.id))!) };
  });
});
app.delete('/:id', authenticateHono, async (c) => {
  checkLimited(c, 'exhibitionDelete');
  requireExhibitorHono(c);
  const existing = await manageableRow(c, c.req.param('id'));
  return mutate(c, async () => {
    await query('DELETE FROM exhibitions WHERE id = $1', [existing.id]);
    return {};
  });
});
app.put('/:id/status', authenticateHono, async (c) => {
  checkLimited(c, 'exhibitionStatus');
  requireExhibitorHono(c);
  const existing = await manageableRow(c, c.req.param('id'));
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const { status } = parseSchema(exhibitionStatusSchema, body);
    await query('UPDATE exhibitions SET status = $2, updated_at = now() WHERE id = $1', [existing.id, status]);
    return { exhibition: exhibitionPayload((await findRow(existing.id))!) };
  });
});
app.put('/:id/fields', authenticateHono, async (c) => {
  checkLimited(c, 'exhibitionFields');
  requireExhibitorHono(c);
  const existing = await manageableRow(c, c.req.param('id'));
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const fields = parseSchema(fieldsSchema(await limits()), body.fields);
    await transaction((client) => replaceFields(client, existing.id, fields));
    return { fields: await loadFields(existing.id) };
  });
});

export function createExhibitionsRoutes() {
  return app;
}
export const EXHIBITION_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['GET', '/month'],
  ['GET', '/categories'],
  ['GET', '/:id'],
  ['GET', '/:id/fields'],
  ['POST', '/'],
  ['PUT', '/:id'],
  ['DELETE', '/:id'],
  ['PUT', '/:id/status'],
  ['PUT', '/:id/fields'],
];
