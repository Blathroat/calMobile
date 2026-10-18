import { Hono } from 'hono';
import { query } from '../config/pool.js';
import {
  USER_COLUMNS,
  USER_FROM,
  REGISTRATION_COLUMNS,
  REGISTRATION_FROM,
  EXHIBITION_COLUMNS,
  EXHIBITION_FROM,
} from '../domain/queries.js';
import {
  adminUserPayload,
  exhibitionPayload,
  publicRegistrationPayload,
  type AdminUserRow,
  type ExhibitionRow,
  type RegistrationRow,
  type UserRow,
} from '../domain/payloads.js';
import * as labels from '../domain/labels.js';
import { canHostMeetings, requireAdmin, type Actor } from '../domain/permissions.js';
import { effectiveRole, isPastExpiry, settleExpiredExhibitor, settleExpiredExhibitors } from '../domain/membership.js';
import { badRequest, notFound } from '../domain/errors.js';
import { revokeAllDevicesForUser } from '../domain/session.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { authenticateHono, optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';
import { readJsonBody } from '../http/body-limit.js';
import { parseSchema } from '../domain/validation.js';
import { adminTwoFactorSchema, userRoleSchema, userStatusSchema } from '../domain/schemas.js';

const app = new Hono<HonoEnv>();
const USER_ORDER = 'ORDER BY u.registration_time, u.id';
function likePattern(keyword: string) {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
async function findUserById(id: string) {
  return (await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id])).rows[0] || null;
}
/** 时间戳（Date 或 ISO 字符串）→ ISO 字符串；空值返回空串。 */
function iso(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function statusPayload(row: UserRow) {
  return {
    id: row.id,
    nickname: row.nickname,
    role: labels.ROLE_LABEL[row.role] || row.role,
    roleCode: row.role,
    status: labels.USER_STATUS[row.status as string] || labels.USER_STATUS.active,
    exhibitorExpiresAt: iso(row.exhibitor_expires_at),
    exhibitorExpired: isPastExpiry(row.exhibitor_expires_at),
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
  // 限时展商到期后先结算：公开页的角色和会议入口不能还停在过期身份上。
  await settleExpiredExhibitor(target.id);
  const roleCode = effectiveRole(target.role, target.exhibitor_expires_at);
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
  // 已参加场数不受「展示我的报名」影响：它是公开事实，开关只决定下方报名记录列表。
  const attended = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM registrations WHERE visitor_id = $1 AND status = 'attended'`,
    [target.id],
  );
  const profile = {
    id: target.id,
    nickname: target.nickname,
    role: labels.ROLE_LABEL[roleCode] || roleCode,
    roleCode,
    meetingsOpen: canHostMeetings(roleCode) && target.status === 'active' && target.accept_meetings === true,
    bio: target.bio || '',
    region: target.region || '',
    avatar: target.avatar || '',
    socialMedia: target.social_media || '',
    registrationTime: target.registration_time || '',
  };
  // 这个用户自己开办的展会（展商公开页要展示）：与 `/exhibitions` 同一份公开字段，
  // 顺序按举办日期倒序，和「已参加展会」保持一致。普通用户没有展会，返回空数组。
  const hosted = await query<ExhibitionRow>(
    `SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM} WHERE e.exhibitor_id = $1 ORDER BY e.exhibition_date DESC, e.id`,
    [target.id],
  );
  return {
    found: true,
    ...profile,
    profile,
    viewedAsAdmin,
    showRegistrations,
    attendedCount: Number(attended.rows[0]?.count) || 0,
    registrations,
    exhibitions: hosted.rows.map(exhibitionPayload),
  };
}
app.get('/', authenticateHono, async (c) => {
  requireAdmin({ user: userOf(c) });
  // 管理员看用户列表前批量结算：列表里不再出现已经到期的展商。
  await settleExpiredExhibitors();
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
    // 受限或封禁不能再接受新的私人会议，开关一并关掉，避免状态恢复前仍有人能提交。
    await query(
      `UPDATE users SET status = $2,
              accept_meetings = CASE WHEN $2 IN ('limited', 'banned') THEN false ELSE accept_meetings END,
              updated_at = now()
        WHERE id = $1`,
      [id, status],
    );
    if (status === 'banned') await revokeAllDevicesForUser(id);
    return { user: statusPayload((await findUserById(id)) || row) };
  });
});
app.put('/:id/role', authenticateHono, async (c) => {
  const actor = requireAdmin({ user: userOf(c) });
  const rawBody = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const id = c.req.param('id');
    if (id === actor.userId) throw badRequest('不能修改自己的权限');
    const body = parseSchema(userRoleSchema, rawBody);
    const role = body.role;
    const row = await findUserById(id);
    if (!row) throw notFound('用户不存在或已删除');
    if (row.role === 'admin' && role !== 'admin') {
      // 调用者自己已是另一位管理员，正常请求里这里至少还能数到一位。
      // 仍然先数一遍，避免以后放宽「不能改自己」时把最后一位管理员降掉。
      const others = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND id <> $1`,
        [id],
      );
      if (Number(others.rows[0]?.n ?? 0) < 1) throw badRequest('至少保留一位管理员');
    }
    // 管理员改角色：设成展商视为永久（清掉到期时间）；降成普通用户/管理员也清掉，
    // 避免把管理员降级误显示成「展商已到期」。
    await query(
      `UPDATE users SET role = $2,
              exhibitor_expires_at = NULL,
              accept_meetings = CASE WHEN $2 = 'user' THEN false ELSE accept_meetings END,
              updated_at = now()
        WHERE id = $1`,
      [id, role],
    );
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
  ['PUT', '/:id/role'],
  ['PUT', '/:id/two-factor'],
];
