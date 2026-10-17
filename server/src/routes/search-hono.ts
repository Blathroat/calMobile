import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { EXHIBITION_COLUMNS, EXHIBITION_FROM, USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { exhibitionPayload, type ExhibitionRow, type UserRow } from '../domain/payloads.js';
import * as labels from '../domain/labels.js';
import { jsonResponse } from '../http/respond.js';
import { optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();
const RESULT_LIMIT = 50;
function likePattern(keyword: string) {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
function searchUserPayload(row: UserRow) {
  return {
    id: row.id,
    nickname: row.nickname,
    role: labels.ROLE_LABEL[row.role] || row.role,
    roleCode: row.role,
    email: row.email || '',
    avatar: row.avatar || '',
    status: labels.USER_STATUS[row.status || ''] || labels.USER_STATUS.active,
    registrationTime: row.registration_time || '',
    lastLoginTime: row.last_login_time || '',
  };
}

app.get('/', optionalAuthHono, async (c) => {
  const keyword = String(c.req.query('query') || '').trim();
  if (!keyword) return jsonResponse(c, { query: '', exhibitions: [], users: [], count: 0 });
  const pattern = likePattern(keyword);
  const exhibitions = (
    await query<ExhibitionRow>(
      `
    SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM}
    WHERE e.title ILIKE $1 ESCAPE '\\' OR e.venue ILIKE $1 ESCAPE '\\' OR e.category ILIKE $1 ESCAPE '\\' OR e.description ILIKE $1 ESCAPE '\\'
    ORDER BY e.exhibition_date LIMIT ${RESULT_LIMIT}
  `,
      [pattern],
    )
  ).rows.map(exhibitionPayload);
  const isAdmin = userOf(c)?.role === 'admin';
  const users = (
    await query<UserRow>(
      `
    SELECT ${USER_COLUMNS} ${USER_FROM}
    WHERE (u.nickname ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\')
      AND ($2::boolean OR u.status = 'active')
    ORDER BY u.nickname LIMIT ${RESULT_LIMIT}
  `,
      [pattern, isAdmin],
    )
  ).rows.map(searchUserPayload);
  return jsonResponse(c, { query: keyword, exhibitions, users, count: exhibitions.length + users.length });
});

export function createSearchRoutes() {
  return app;
}
export const SEARCH_ENDPOINTS: readonly [string, string][] = [['GET', '/']];
