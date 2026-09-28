import { Hono } from 'hono';
import type { PoolClient } from 'pg';
import { query, transaction } from '../config/pool.js';
import { EXHIBITION_COLUMNS, EXHIBITION_FROM } from '../domain/queries.js';
import { exhibitionPayload, fieldPayload, type ExhibitionRow, type FieldRow } from '../domain/payloads.js';
import { requireExhibitor, assertCanManageExhibition, assertNotLimited } from '../domain/permissions.js';
import { readSection } from '../domain/settings.js';
import { limits, parseSchema } from '../domain/validation.js';
import {
  exhibitionInputSchema,
  fieldsSchema,
  monthQuerySchema,
  exhibitionStatusSchema,
  type ExhibitionInput,
} from '../domain/schemas.js';
import { notFound } from '../domain/errors.js';
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
  return jsonResponse(c, {
    year,
    month: monthNumber,
    day,
    monthLabel: `${year} 年 ${monthNumber} 月`,
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
        `INSERT INTO exhibitions (id, title, venue, time, exhibition_date, status, category, description, description_format, image_uri, exhibitor_note, registration_start, registration_end, qr_enabled, exhibitor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
        `UPDATE exhibitions SET title=$2, venue=$3, time=$4, exhibition_date=$5, status=$6, category=$7, description=$8, description_format=$9, image_uri=$10, exhibitor_note=$11, registration_start=$12, registration_end=$13, qr_enabled=$14, updated_at=now() WHERE id=$1`,
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
