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
import { badRequest, notFound } from '../domain/errors.js';
import * as labels from '../domain/labels.js';
import { releaseExhibitionMedia } from '../services/media-gc.js';
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
      // 兼容字段（中文）；新代码读 statusCode。
      status: labels.REGISTRATION_STATUS[row.status] || '',
      statusCode: row.status,
      role: host ? 'host' : 'visitor',
      title: host ? row.visitor_name : row.exhibitor_name,
      titleRole: host ? row.visitor_role || '' : row.exhibitor_role || '',
    };
  });
}

/** 一个展会落在指定月份里的日期集合（跨月时只取本月覆盖到的天）。 */
function exhibitionDaysInMonth(date: string, endDate: string, year: number, month: number): number[] {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const start = Date.parse(`${date}T00:00:00Z`);
  const end = Date.parse(`${endDate || date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const from = Math.max(start, monthStart);
  const to = Math.min(end, monthEnd);
  if (from > to) return [];
  const days: number[] = [];
  for (let time = from; time <= to; time += 86_400_000) days.push(new Date(time).getUTCDate());
  return days;
}

function monthSummary(item: ReturnType<typeof exhibitionPayload>, days: number[]) {
  return {
    id: item.id,
    // `day` 保留给还没更新快照的旧页面：取本月第一天有展会的日期（跨月展会因此落在 1 号）。
    day: days[0] ?? item.day,
    // 本月内这场展会覆盖的所有天：日历据此加粗日期、选中日据此展示展会卡片。
    days,
    date: item.date,
    endDate: item.endDate,
    dateLabel: item.dateLabel,
    title: item.title,
    time: item.time,
    venue: item.venue,
    // 兼容字段（中文）与协议值都在这里给全：月视图的卡片按 statusCode 取文案。
    status: item.status,
    statusCode: item.statusCode,
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

/**
 * 单个展会最长持续天数：按开展日到闭展日（含两端）计算，只填开展日算 1 天。
 * 上限由管理员在「管理-设置 → 展商相关」里配置，0 表示不限。
 */
async function assertExhibitionDuration(date: string, endDate: string): Promise<void> {
  const config = await readSection('exhibitor');
  const maxDays = Math.max(0, Math.trunc(Number(config.maxExhibitionDays) || 0));
  if (maxDays <= 0 || !endDate) return;
  const start = Date.parse(`${date}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > maxDays) throw badRequest(`单个展会最长 ${maxDays} 天`, { code: 'exhibition.durationTooLong' });
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
  const exhibitorId = String(c.req.query('exhibitorId') || '').trim();
  const params: string[] = [];
  const clauses: string[] = [];
  if (keyword) {
    params.push(likePattern(keyword));
    const slot = `$${params.length}`;
    clauses.push(
      `(e.title ILIKE ${slot} OR e.venue ILIKE ${slot} OR e.category ILIKE ${slot} OR e.description ILIKE ${slot})`,
    );
  }
  if (exhibitorId) {
    params.push(exhibitorId);
    clauses.push(`e.exhibitor_id = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
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
    WHERE e.exhibition_date < (make_date($1::int, $2::int, 1) + interval '1 month')::date
      AND COALESCE(e.exhibition_end_date, e.exhibition_date) >= make_date($1::int, $2::int, 1)
    ORDER BY e.exhibition_date, e.id`,
    [year, monthNumber],
  );
  // 一场展会可能跨多天：按「开展～闭展」把它展开成本月覆盖的每一天。
  const items = result.rows.map((row) => {
    const item = exhibitionPayload(row);
    return { item, days: exhibitionDaysInMonth(item.date, item.endDate, year, monthNumber) };
  });
  const eventDays = [...new Set(items.flatMap((entry) => entry.days))].sort((a, b) => a - b);
  if (day <= 0) day = eventDays[0] || 0;
  // 圆点只标「和当前用户有关」的日期；有展会的日期仍由 eventDays 表示（日历把日期加粗）。
  const viewer = userOf(c);
  let markedDays: number[] = [];
  if (viewer?.userId) {
    const marked = await query<{ day: number }>(
      `SELECT DISTINCT day FROM (
         -- 用户的报名：已通过 / 已参加的报名在选了参加时间段时只给所选那几天打点，
         -- 没选（attendance_start 为空）时退回原来的整段展会区间。
         -- 跨月与脏数据都靠 GREATEST / LEAST 与展会区间、本月区间取交集兜住：
         -- start 超过 end 时 generate_series 为空，不会画出额外的圆点。
         SELECT EXTRACT(DAY FROM generate_series(
                  GREATEST(COALESCE(r.attendance_start, e.exhibition_date),
                           e.exhibition_date,
                           make_date($1::int, $2::int, 1)),
                  LEAST(COALESCE(r.attendance_end, r.attendance_start, e.exhibition_end_date, e.exhibition_date),
                        COALESCE(e.exhibition_end_date, e.exhibition_date),
                        (make_date($1::int, $2::int, 1) + interval '1 month - 1 day')::date),
                  interval '1 day'))::int AS day
           FROM registrations r
           JOIN exhibitions e ON e.id = r.exhibition_id
          WHERE r.visitor_id = $3 AND r.status IN ('approved', 'attended')
            AND GREATEST(COALESCE(r.attendance_start, e.exhibition_date), e.exhibition_date)
                <= (make_date($1::int, $2::int, 1) + interval '1 month - 1 day')::date
            AND LEAST(COALESCE(r.attendance_end, r.attendance_start, e.exhibition_end_date, e.exhibition_date),
                      COALESCE(e.exhibition_end_date, e.exhibition_date))
                >= make_date($1::int, $2::int, 1)
         UNION
         SELECT EXTRACT(DAY FROM generate_series(
                  GREATEST(e.exhibition_date, make_date($1::int, $2::int, 1)),
                  LEAST(COALESCE(e.exhibition_end_date, e.exhibition_date),
                        (make_date($1::int, $2::int, 1) + interval '1 month - 1 day')::date),
                  interval '1 day'))::int
           FROM exhibitions e
          WHERE e.exhibitor_id = $3
            AND e.exhibition_date <= (make_date($1::int, $2::int, 1) + interval '1 month - 1 day')::date
            AND COALESCE(e.exhibition_end_date, e.exhibition_date) >= make_date($1::int, $2::int, 1)
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
  const selected = items.filter((entry) => entry.days.includes(day));
  return jsonResponse(c, {
    year,
    month: monthNumber,
    day,
    monthLabel: `${year} 年 ${monthNumber} 月`,
    eventDays,
    markedDays,
    exhibitions: items.map((entry) => monthSummary(entry.item, entry.days)),
    meetings,
    selected: selected.map((entry) => monthSummary(entry.item, entry.days)),
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
    await assertExhibitionDuration(input.date, input.endDate);
    const id = newId('exh');
    await withExhibitionQuota(user, { exhibitorId: user.userId, date: input.date }, async (client) => {
      await client.query(
        `INSERT INTO exhibitions (id, title, venue, time, exhibition_date, exhibition_end_date, status, category, description, description_format, image_uri, exhibitor_note, registration_notice, registration_start, registration_end, qr_enabled, allow_cancel, exhibitor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          id,
          input.title,
          input.venue,
          input.time,
          input.date,
          input.endDate || null,
          input.status,
          input.category,
          input.description,
          input.descriptionFormat,
          input.imageUri,
          input.exhibitorNote,
          input.registrationNotice,
          input.registrationStart || null,
          input.registrationEnd || null,
          input.qrEnabled,
          input.allowCancel,
          user.userId,
        ],
      );
      if (input.fields) await replaceFields(client, id, input.fields);
    });
    await releaseExhibitionMedia({});
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
    await assertExhibitionDuration(input.date, input.endDate);
    await withExhibitionQuota(
      user,
      { id: existing.id, exhibitorId: existing.exhibitor_id, date: input.date },
      async (client) => {
        await client.query(
          `UPDATE exhibitions SET title=$2, venue=$3, time=$4, exhibition_date=$5, exhibition_end_date=$6, status=$7, category=$8, description=$9, description_format=$10, image_uri=$11, exhibitor_note=$12, registration_notice=$13, registration_start=$14, registration_end=$15, qr_enabled=$16, allow_cancel=$17, updated_at=now() WHERE id=$1`,
          [
            existing.id,
            input.title,
            input.venue,
            input.time,
            input.date,
            input.endDate || null,
            input.status,
            input.category,
            input.description,
            input.descriptionFormat,
            input.imageUri,
            input.exhibitorNote,
            input.registrationNotice,
            input.registrationStart || null,
            input.registrationEnd || null,
            input.qrEnabled,
            input.allowCancel,
          ],
        );
        if (input.fields) await replaceFields(client, existing.id, input.fields);
      },
    );
    await releaseExhibitionMedia({ description: existing.description, image_uri: existing.image_uri });
    return { exhibition: exhibitionPayload((await findRow(existing.id))!) };
  });
});
app.delete('/:id', authenticateHono, async (c) => {
  checkLimited(c, 'exhibitionDelete');
  requireExhibitorHono(c);
  const existing = await manageableRow(c, c.req.param('id'));
  return mutate(c, async () => {
    await query('DELETE FROM exhibitions WHERE id = $1', [existing.id]);
    await releaseExhibitionMedia({ description: existing.description, image_uri: existing.image_uri });
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
