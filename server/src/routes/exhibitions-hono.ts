import { Hono } from 'hono';
import type { PoolClient } from 'pg';
import { query, transaction } from '../config/pool.js';
import { EXHIBITION_COLUMNS, EXHIBITION_FROM } from '../domain/queries.js';
import { exhibitionPayload, fieldPayload, type ExhibitionRow, type FieldRow } from '../domain/payloads.js';
import * as labels from '../domain/labels.js';
import { requireExhibitor, assertCanManageExhibition, assertNotLimited } from '../domain/permissions.js';
import { readSection } from '../domain/settings.js';
import { limits, text, int, bool, isoDate, timeRange, stringList } from '../domain/validation.js';
import { badRequest, notFound } from '../domain/errors.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';
import { authenticateHono, optionalAuthHono, userOf, type HonoContext, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();
const FIELD_TYPES = ['文本', '单选', '多选'];
const MAX_FIELDS = 50;
const STATUS_HINT = '报名方式只能是 需审核 / 无需审核 / 仅展示 / 截止报名 / 已结束';
const NOT_FOUND_TEXT = '展会不存在或已删除';

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function likePattern(keyword: string) {
  return `%${keyword.replace(/([\\%_])/g, '\\$1')}%`;
}
function given(body: Record<string, unknown> | null | undefined, key: string) {
  return Boolean(body) && Object.prototype.hasOwnProperty.call(body, key) && body![key] !== undefined;
}
function looksLikeHtml(value: unknown) {
  return /^\s*<(p|div|h[1-6]|ul|ol|blockquote|br|strong|em)\b/.test(String(value || ''));
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
interface NormalizedField {
  title: string;
  type: string;
  required: boolean;
  options: string[];
}
function normalizeFields(raw: unknown, config: Awaited<ReturnType<typeof limits>>): NormalizedField[] {
  if (!Array.isArray(raw)) throw badRequest('收集项需为数组');
  if (raw.length > MAX_FIELDS) throw badRequest(`收集项最多 ${MAX_FIELDS} 项`);
  return raw.map((item: unknown) => {
    const source = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const type = String(source.type ?? '文本').trim();
    if (!FIELD_TYPES.includes(type)) throw badRequest('收集项类型只能是 文本 / 单选 / 多选');
    return {
      title: text(source.title, { label: '收集项标题', max: config.fieldTitle }),
      type,
      required: bool(source.required, false),
      options: type === '文本' ? [] : stringList(source.options, { label: '选项' }),
    };
  });
}
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
  const source = body || {};
  const current: Partial<ExhibitionRow> = existing || {};
  const creating = !existing;
  const title = text(source.title, { label: '展会名称', max: config.exhibitionTitle, required: false });
  if (!title) throw badRequest('展会名称不能为空');
  const venue =
    given(source, 'venue') || creating
      ? text(source.venue, { label: '展会地点', max: config.exhibitionVenue, required: false })
      : current.venue || '';
  const category =
    given(source, 'category') || creating
      ? text(source.category, { label: '展会分类', max: config.category, required: false })
      : current.category || '';
  const date =
    given(source, 'date') || creating
      ? isoDate(source.date, { label: '展会日期', required: true })
      : current.exhibition_date;
  const time =
    given(source, 'time') || creating ? timeRange(source.time, { label: '展会时间', required: true }) : current.time;
  let status = current.status || 'review';
  if (given(source, 'status') && String(source.status).trim() !== '') {
    const mapped = labels.toExhibitionStatus(source.status);
    if (!mapped) throw badRequest(STATUS_HINT);
    status = mapped;
  }
  const registrationStart =
    given(source, 'registrationStart') || creating
      ? isoDate(source.registrationStart, { label: '报名开始日期' })
      : current.registration_start || '';
  const registrationEnd =
    given(source, 'registrationEnd') || creating
      ? isoDate(source.registrationEnd, { label: '报名截止日期' })
      : current.registration_end || '';
  if (registrationStart && registrationEnd && registrationEnd < registrationStart)
    throw badRequest('报名截止日期不能早于开始日期');
  const description = given(source, 'description') ? String(source.description ?? '') : current.description || '';
  const requestedFormat = given(source, 'descriptionFormat')
    ? source.descriptionFormat === 'html'
      ? 'html'
      : 'md'
    : current.description_format || 'md';
  const descriptionFormat = requestedFormat === 'html' || looksLikeHtml(description) ? 'html' : 'md';
  return {
    title,
    venue,
    category,
    date,
    time,
    status,
    registrationStart,
    registrationEnd,
    description,
    descriptionFormat,
    highlights: given(source, 'highlights')
      ? stringList(source.highlights, { label: '展会亮点' })
      : Array.isArray(current.highlights)
        ? current.highlights
        : [],
    imageUri: given(source, 'imageUri') ? String(source.imageUri || '') : current.image_uri || '',
    exhibitorNote: given(source, 'exhibitorNote')
      ? String(source.exhibitorNote || '')
      : creating
        ? '主办方公开信息'
        : current.exhibitor_note || '',
    qrEnabled: given(source, 'qrEnabled') ? bool(source.qrEnabled, false) : Boolean(current.qr_enabled),
    fields: Array.isArray(source.fields) && source.fields.length > 0 ? normalizeFields(source.fields, config) : null,
  };
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
  const year = int(requestedYear, { label: '年份', min: 1970, max: 9999 });
  const month = int(requestedMonth, { label: '月份', min: 1, max: 12 });
  let day = int(c.req.query('day'), { label: '日期', min: 0, max: 31, fallback: 0 });
  const result = await query<ExhibitionRow>(
    `SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM}
    WHERE EXTRACT(YEAR FROM e.exhibition_date)::int = $1 AND EXTRACT(MONTH FROM e.exhibition_date)::int = $2 ORDER BY e.exhibition_date, e.id`,
    [year, month],
  );
  const items = result.rows.map(exhibitionPayload);
  const eventDays = [...new Set(items.map((item) => item.day))].sort((a, b) => Number(a) - Number(b));
  if (day <= 0) day = eventDays[0] || 0;
  return jsonResponse(c, {
    year,
    month,
    day,
    monthLabel: `${year} 年 ${month} 月`,
    eventDays,
    exhibitions: items.map(monthSummary),
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
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO exhibitions (id, title, venue, time, exhibition_date, status, category, description, description_format, highlights, image_uri, exhibitor_note, registration_start, registration_end, qr_enabled, exhibitor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
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
          JSON.stringify(input.highlights),
          input.imageUri,
          input.exhibitorNote,
          input.registrationStart || null,
          input.registrationEnd || null,
          input.qrEnabled,
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
  requireExhibitorHono(c);
  const existing = await manageableRow(c, c.req.param('id'));
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const input = await exhibitionInput(body, existing);
    await transaction(async (client) => {
      await client.query(
        `UPDATE exhibitions SET title=$2, venue=$3, time=$4, exhibition_date=$5, status=$6, category=$7, description=$8, description_format=$9, highlights=$10, image_uri=$11, exhibitor_note=$12, registration_start=$13, registration_end=$14, qr_enabled=$15, updated_at=now() WHERE id=$1`,
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
          JSON.stringify(input.highlights),
          input.imageUri,
          input.exhibitorNote,
          input.registrationStart || null,
          input.registrationEnd || null,
          input.qrEnabled,
        ],
      );
      if (input.fields) await replaceFields(client, existing.id, input.fields);
    });
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
    const status = labels.toExhibitionStatus(body.status);
    if (!status) throw badRequest(STATUS_HINT);
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
    const fields = normalizeFields(body.fields, await limits());
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
