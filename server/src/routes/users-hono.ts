import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { USER_COLUMNS, USER_FROM, REGISTRATION_COLUMNS, REGISTRATION_FROM } from '../domain/queries.js';
import {
  adminUserPayload,
  publicRegistrationPayload,
  type AdminUserRow,
  type RegistrationRow,
  type UserRow,
} from '../domain/payloads.js';
import * as labels from '../domain/labels.js';
import { requireAdmin, type Actor } from '../domain/permissions.js';
import { badRequest, notFound } from '../domain/errors.js';
import { revokeAllForUser } from '../domain/session.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { authenticateHono, optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';
import { readJsonBody } from '../http/body-limit.js';
import { parseSchema } from '../domain/validation.js';
import { adminTwoFactorSchema, userStatusSchema } from '../domain/schemas.js';

const app = new Hono<HonoEnv>();
const USER_ORDER = 'ORDER BY u.registration_time, u.id';
function likePattern(keyword: string) {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
async function findUserById(id: string) {
  return (await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id])).rows[0] || null;
}
function statusPayload(row: UserRow) {
  return {
    id: row.id,
    nickname: row.nickname,
    role: labels.ROLE_LABEL[row.role] || row.role,
    roleCode: row.role,
    status: labels.USER_STATUS[row.status as string] || labels.USER_STATUS.active,
  };
}
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
async function publicTarget(id: string, nickname: string) {
  if (id) return findUserById(id);
  if (!nickname) return null;
  return (
    (
      await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.nickname = $1 ${USER_ORDER} LIMIT 1`, [
        nickname,
      ])
    ).rows[0] || null
  );
}
async function publicProfile(viewer: Actor | null, target: UserRow | null) {
  if (!target) return { found: false, error: '用户不存在或未公开' };
  const viewedAsAdmin = viewer?.role === 'admin';
  const isSelf = viewer?.userId === target.id;
  const showRegistrations = target.show_registrations === true;
  let registrations: ReturnType<typeof publicRegistrationPayload>[] = [];
  if (viewedAsAdmin || isSelf || showRegistrations) {
    const result = await query<RegistrationRow>(
      `SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.visitor_id = $1 AND r.status IN ('approved', 'attended') ORDER BY e.exhibition_date DESC, r.created_at DESC`,
      [target.id],
    );
    registrations = result.rows.map(publicRegistrationPayload);
  }
  const profile = {
    nickname: target.nickname,
    role: labels.ROLE_LABEL[target.role] || target.role,
    bio: target.bio || '',
    region: target.region || '',
    avatar: target.avatar || '',
    socialMedia: target.social_media || '',
    registrationTime: target.registration_time || '',
  };
  return { found: true, ...profile, profile, viewedAsAdmin, showRegistrations, registrations };
}
app.get('/', authenticateHono, async (c) => {
  requireAdmin({ user: userOf(c) });
  const keyword = String(c.req.query('query') || '').trim();
  const result = keyword
    ? await query<AdminUserRow>(
        `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.nickname ILIKE $1 ESCAPE '\\' OR u.username ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\' ${USER_ORDER}`,
        [likePattern(keyword)],
      )
    : await query<AdminUserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} ${USER_ORDER}`);
  return jsonResponse(
    c,
    result.rows.map((row, index) => adminUserPayload(row, index)),
  );
});
app.get('/public', optionalAuthHono, async (c) =>
  jsonResponse(
    c,
    await publicProfile(
      userOf(c),
      await publicTarget(String(c.req.query('userId') || '').trim(), String(c.req.query('nickname') || '').trim()),
    ),
  ),
);
app.get('/:id', authenticateHono, async (c) => {
  requireAdmin({ user: userOf(c) });
  const row = await findUserById(c.req.param('id'));
  return jsonResponse(
    c,
    row
      ? { found: true, user: { id: row.id, nickname: row.nickname, role: labels.ROLE_LABEL[row.role] || row.role } }
      : { found: false, user: null },
  );
});
app.put('/:id/status', authenticateHono, async (c) => {
  const actor = requireAdmin({ user: userOf(c) });
  const rawBody = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const id = c.req.param('id');
    if (id === actor.userId) throw badRequest('不能修改自己的账号状态');
    const body = parseSchema(userStatusSchema, rawBody);
    const status = body.status;
    const row = await findUserById(id);
    if (!row) throw notFound('用户不存在或已删除');
    await query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
    if (status === 'banned') await revokeAllForUser(id);
    return { user: statusPayload((await findUserById(id)) || row) };
  });
});
app.put('/:id/two-factor', authenticateHono, async (c) => {
  requireAdmin({ user: userOf(c) });
  const rawBody = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    parseSchema(adminTwoFactorSchema, rawBody);
    const id = c.req.param('id');
    const row = await findUserById(id);
    if (!row) throw notFound('用户不存在或已删除');
    await query('UPDATE users SET two_factor_enabled = false, updated_at = now() WHERE id = $1', [id]);
    return { user: statusPayload(row), twoFactorEnabled: false };
  });
});
export function createUsersRoutes() {
  return app;
}
export const USERS_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['GET', '/public'],
  ['GET', '/:id'],
  ['PUT', '/:id/status'],
  ['PUT', '/:id/two-factor'],
];
