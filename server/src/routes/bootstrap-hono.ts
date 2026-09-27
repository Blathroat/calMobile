import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { readServerSettings, readUiMode } from '../domain/settings.js';
import { USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { userPayload, guestPayload, type UserRow } from '../domain/payloads.js';
import { capabilities } from '../domain/permissions.js';
import { jsonResponse } from '../http/respond.js';
import { optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();

interface LandingMonthRow {
  year: number;
  month: number;
}

async function landingMonth() {
  const result = await query<LandingMonthRow>(`
    SELECT EXTRACT(YEAR FROM exhibition_date)::int AS year,
           EXTRACT(MONTH FROM exhibition_date)::int AS month
    FROM exhibitions ORDER BY exhibition_date LIMIT 1
  `);
  const row = result.rows[0];
  if (row) return { year: row.year, month: row.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

app.get('/bootstrap', optionalAuthHono, async (c) => {
  const userOfRequest = userOf(c);
  const settings = await readServerSettings();
  const mode = await readUiMode(userOfRequest?.userId, settings);
  let user = guestPayload();
  if (userOfRequest) {
    const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [userOfRequest.userId]);
    const row = result.rows[0];
    if (row) user = userPayload(row, capabilities(row.role, row.status ?? undefined));
  }
  return jsonResponse(c, {
    user,
    theme: settings.theme,
    ui: { mode },
    capabilities: { ...settings.capabilities },
    categories: settings.categories,
    review: settings.review,
    media: settings.media,
    announcement: settings.announcement,
    brand: settings.brand,
    limits: settings.limits,
    server: settings.upload,
    calendar: { available: false, landing: await landingMonth() },
  });
});

export function createBootstrapRoutes() {
  return app;
}
export const BOOTSTRAP_ENDPOINTS: readonly [string, string][] = [['GET', '/bootstrap']];
