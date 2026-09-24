/**
 * 个人资料、安全设置与通知偏好 Hono 路由。
 *
 * 资料写入只更新请求体中出现的字段；邮箱、两步验证和备用码都沿用原有领域服务，
 * 路由迁移只改变 HTTP 承载方式，不改变数据或安全规则。
 */

import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import type { TrustProxy } from '../config/runtime.js';
import { query } from '../config/pool.js';
import { USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { userPayload, type UserRow } from '../domain/payloads.js';
import { capabilities, assertNotLimited, requireUser } from '../domain/permissions.js';
import { limits, bool } from '../domain/validation.js';
import { badRequest, notFound } from '../domain/errors.js';
import { issueCode, consumeCode, isCodeRejected, maskEmail } from '../domain/otp.js';
import {
  secondFactorState,
  beginTotpSetup,
  confirmTotpSetup,
  regenerateBackupCodes,
  clearSecondFactors,
} from '../domain/two-factor.js';
import { readNotificationPreferences, saveNotificationPreferences, readServerSettings } from '../domain/settings.js';
import { revokeAllForUser } from '../domain/session.js';
import { readJsonBody } from '../http/body-limit.js';
import { clientIp } from '../http/client-ip.js';
import { jsonResponse, mutate } from '../http/respond.js';
import type { NodeEnv } from '../server/node-middleware.js';
import { authenticateHono, userOf, type HonoContext, type HonoEnv } from './hono-utils.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PasswordHashRow {
  password_hash: string;
}

interface PasswordFactorRow {
  password_hash: string;
  two_factor_enabled?: boolean | null;
}

interface VerifiedAtRow {
  email_verified_at?: string | Date | null;
}

interface FactorToggleRow {
  email: string;
  email_verified?: boolean | null;
  two_factor_enabled?: boolean | null;
}

interface EmailOnlyRow {
  email: string;
}

interface TotpAccountRow {
  id: string;
  username: string;
  email: string;
}

function bodyRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function requestIp(c: HonoContext, trustProxy: TrustProxy): string {
  const env = c.env as NodeEnv | undefined;
  return clientIp(
    { remoteAddress: env?.incoming?.socket?.remoteAddress, forwardedFor: c.req.header('x-forwarded-for') },
    trustProxy,
  );
}

async function loadUser(id: string) {
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound('用户不存在或已删除');
  return userPayload(row, capabilities(row.role, row.status as string | undefined));
}

async function verifiedAt(userId: string) {
  const result = await query<VerifiedAtRow>('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
  const value = result.rows[0]?.email_verified_at;
  return value ? new Date(value).toISOString() : '';
}

/** 创建个人资料路由；IP 信任策略从服务骨架传入，和认证路由使用同一配置。 */
export function createProfileRoutes(options: { trustProxy: TrustProxy }) {
  const app = new Hono<HonoEnv>();

  app.get('/', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    return jsonResponse(c, await loadUser(user.userId));
  });

  app.put('/', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    assertNotLimited(user, 'profile');
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const bounds = await limits();
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };

      if (has(body, 'nickname')) {
        const nickname = String(body.nickname === undefined ? '' : body.nickname).trim();
        if (!nickname) throw badRequest('昵称不能为空');
        if (bounds.nickname && nickname.length > bounds.nickname)
          throw badRequest(`昵称最多 ${bounds.nickname} 个字符`);
        set('nickname', nickname);
      }
      if (has(body, 'email')) throw badRequest('邮箱需要通过「验证新邮箱」修改');
      if (has(body, 'bio')) {
        const bio = String(body.bio === undefined ? '' : body.bio).trim();
        if (bounds.bio && bio.length > bounds.bio) throw badRequest(`个人简介最多 ${bounds.bio} 个字符`);
        set('bio', bio);
      }
      if (has(body, 'region')) {
        const region = String(body.region === undefined ? '' : body.region).trim();
        if (bounds.region && region.length > bounds.region) throw badRequest(`地区最多 ${bounds.region} 个字符`);
        set('region', region);
      }
      if (has(body, 'socialMedia'))
        set('social_media', String(body.socialMedia === undefined ? '' : body.socialMedia).trim());
      if (has(body, 'avatar')) set('avatar', String(body.avatar === undefined ? '' : body.avatar).trim());
      if (has(body, 'showRegistrations')) set('show_registrations', bool(body.showRegistrations, false));

      if (assignments.length > 0) {
        values.push(user.userId);
        await query(
          `UPDATE users SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
          values,
        );
      }
      return { user: await loadUser(user.userId) };
    });
  });

  app.post('/password', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const current = String(body.currentPassword === undefined ? '' : body.currentPassword);
      const nextPassword = String(body.newPassword === undefined ? '' : body.newPassword);
      const confirm = String(body.confirmPassword === undefined ? '' : body.confirmPassword);
      if (!current || !nextPassword) throw badRequest('请填写完整密码');
      if (nextPassword !== confirm) throw badRequest('两次输入的新密码不一致');
      const bounds = await limits();
      if (bounds.passwordMin && nextPassword.length < bounds.passwordMin)
        throw badRequest(`密码至少需要 ${bounds.passwordMin} 个字符`);
      if (bounds.passwordMax && nextPassword.length > bounds.passwordMax)
        throw badRequest(`密码最多 ${bounds.passwordMax} 个字符`);
      const found = await query<PasswordHashRow>('SELECT password_hash FROM users WHERE id = $1', [user.userId]);
      const row = found.rows[0];
      if (!row || !(await bcrypt.compare(current, row.password_hash))) throw badRequest('当前密码不正确');
      await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        user.userId,
        await bcrypt.hash(nextPassword, 10),
      ]);
      await revokeAllForUser(user.userId);
      return {};
    });
  });

  app.get('/security', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const factors = await secondFactorState(user.userId);
    if (!factors) throw notFound('用户不存在或已删除');
    return jsonResponse(c, {
      email: factors.email,
      emailVerified: factors.emailVerified,
      emailVerifiedAt: await verifiedAt(user.userId),
      twoFactorEnabled: factors.enabled,
      totpEnabled: factors.totpBound,
      backupCodesLeft: factors.backupCodesLeft,
      canEnable: factors.emailVerified && factors.email !== '',
    });
  });

  app.post('/2fa/enable', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const found = await query<FactorToggleRow>(
      'SELECT email, email_verified, two_factor_enabled FROM users WHERE id = $1',
      [user.userId],
    );
    const row = found.rows[0];
    if (!row) throw notFound('用户不存在或已删除');
    if (row.two_factor_enabled === true) return jsonResponse(c, { ok: true, error: '', alreadyEnabled: true });
    if (row.email_verified !== true || !row.email) throw badRequest('请先验证邮箱，再开启两步验证');
    const sent = await issueCode({
      purpose: 'enable2fa',
      email: row.email,
      userId: user.userId,
      ip: requestIp(c, options.trustProxy),
    });
    return jsonResponse(c, { ok: true, error: '', ...sent, maskedEmail: maskEmail(row.email) });
  });

  app.post('/2fa/enable/verify', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    const found = await query<EmailOnlyRow>('SELECT email FROM users WHERE id = $1', [user.userId]);
    const emailRow = found.rows[0];
    if (!emailRow) throw notFound('用户不存在或已删除');
    let consumed;
    try {
      consumed = await consumeCode({
        purpose: 'enable2fa',
        email: emailRow.email,
        code: String(body.code || '').trim(),
      });
    } catch (error: unknown) {
      if (isCodeRejected(error)) return jsonResponse(c, { ok: false, error: error.message });
      throw error;
    }
    if (consumed.userId !== user.userId) return jsonResponse(c, { ok: false, error: '验证码不正确或已失效' });
    await query('UPDATE users SET two_factor_enabled = true, updated_at = now() WHERE id = $1', [user.userId]);
    return jsonResponse(c, {
      ok: true,
      error: '',
      twoFactorEnabled: true,
      backupCodes: await regenerateBackupCodes(user.userId),
    });
  });

  app.post('/2fa/totp/setup', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const found = await query<TotpAccountRow>('SELECT id, username, email FROM users WHERE id = $1', [user.userId]);
    const account = found.rows[0];
    if (!account) throw notFound('用户不存在或已删除');
    const settings = await readServerSettings();
    const issuer = String((settings.brand && (settings.brand.zh || settings.brand.en)) || 'calMobile');
    const setup = await beginTotpSetup(account, issuer);
    return jsonResponse(c, { ok: true, error: '', issuer, ...setup });
  });

  app.post('/2fa/totp/enable', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    try {
      const result = await confirmTotpSetup(user.userId, String(body.code || '').trim());
      return jsonResponse(c, { ok: true, error: '', twoFactorEnabled: true, ...result });
    } catch (error: unknown) {
      if (isCodeRejected(error)) return jsonResponse(c, { ok: false, error: error.message });
      throw error;
    }
  });

  app.post('/2fa/backup-codes', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const password = String(body.password || '');
      if (!password) throw badRequest('请输入当前密码');
      const found = await query<PasswordFactorRow>(
        'SELECT password_hash, two_factor_enabled FROM users WHERE id = $1',
        [user.userId],
      );
      const row = found.rows[0];
      if (!row || !(await bcrypt.compare(password, row.password_hash))) throw badRequest('当前密码不正确');
      if (row.two_factor_enabled !== true) throw badRequest('请先开启两步验证，再生成备用码');
      return { backupCodes: await regenerateBackupCodes(user.userId) };
    });
  });

  app.post('/2fa/disable', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const password = String(body.password || '');
      if (!password) throw badRequest('请输入当前密码');
      const found = await query<PasswordHashRow>('SELECT password_hash FROM users WHERE id = $1', [user.userId]);
      const row = found.rows[0];
      if (!row || !(await bcrypt.compare(password, row.password_hash))) throw badRequest('当前密码不正确');
      await clearSecondFactors(user.userId);
      return { twoFactorEnabled: false };
    });
  });

  app.post('/email', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    const email = String(body.email || '').trim();
    if (!EMAIL_PATTERN.test(email) || email.length > 120) throw badRequest('邮箱格式不正确');
    const current = await query<EmailOnlyRow>('SELECT email FROM users WHERE id = $1', [user.userId]);
    if (String(current.rows[0]?.email || '').toLowerCase() === email.toLowerCase())
      throw badRequest('新邮箱与当前邮箱相同');
    const taken = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (taken.rows.length > 0) return jsonResponse(c, { ok: false, error: '该邮箱已被其他账号使用' });
    const sent = await issueCode({
      purpose: 'email',
      email,
      userId: user.userId,
      ip: requestIp(c, options.trustProxy),
    });
    return jsonResponse(c, { ok: true, error: '', ...sent });
  });

  app.post('/email/verify', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    const email = String(body.email || '').trim();
    const code = String(body.code || '').trim();
    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'email', email, code });
    } catch (error: unknown) {
      if (isCodeRejected(error)) return jsonResponse(c, { ok: false, error: error.message });
      throw error;
    }
    if (consumed.userId !== user.userId) return jsonResponse(c, { ok: false, error: '验证码不正确或已失效' });
    try {
      await query(
        `UPDATE users SET email = $2, email_verified = true, email_verified_at = now(), updated_at = now() WHERE id = $1`,
        [user.userId, consumed.email],
      );
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        return jsonResponse(c, { ok: false, error: '该邮箱已被其他账号使用' });
      throw error;
    }
    return jsonResponse(c, { ok: true, error: '', user: await loadUser(user.userId) });
  });

  app.get('/notifications', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    return jsonResponse(c, await readNotificationPreferences(user.userId));
  });

  app.put('/notifications', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => ({ notify: await saveNotificationPreferences(user.userId, body) }));
  });

  return app;
}

export const PROFILE_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['PUT', '/'],
  ['POST', '/password'],
  ['GET', '/security'],
  ['POST', '/2fa/enable'],
  ['POST', '/2fa/enable/verify'],
  ['POST', '/2fa/totp/setup'],
  ['POST', '/2fa/totp/enable'],
  ['POST', '/2fa/backup-codes'],
  ['POST', '/2fa/disable'],
  ['POST', '/email'],
  ['POST', '/email/verify'],
  ['GET', '/notifications'],
  ['PUT', '/notifications'],
];
