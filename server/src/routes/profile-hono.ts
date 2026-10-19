/**
 * 个人资料、安全设置与通知偏好 Hono 路由。
 *
 * 资料写入只更新请求体中出现的字段；邮箱、两步验证和备用码都沿用原有领域服务，
 * 路由迁移只改变 HTTP 承载方式，不改变数据或安全规则。
 */

import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import type { TrustProxy } from '../config/runtime.js';
import { query, transaction } from '../config/pool.js';
import { USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { userPayload, type UserRow } from '../domain/payloads.js';
import { capabilities, assertNotLimited, requireUser } from '../domain/permissions.js';
import { limits, parseSchema } from '../domain/validation.js';
import {
  profilePatchSchema,
  passwordChangeSchema,
  passwordOnlySchema,
  emailSchema,
  codeSchema,
  securityIdentitySchema,
  emailVerifyLooseSchema,
  notifySchema,
  inviteRedeemSchema,
} from '../domain/schemas.js';
import { consumeInvite } from '../domain/invites.js';
import { settleExpiredExhibitor } from '../domain/membership.js';
import { badRequest, errorDetailFields, notFound } from '../domain/errors.js';
import { issueCode, consumeCode, isCodeRejected, maskEmail } from '../domain/otp.js';
import {
  secondFactorState,
  beginTotpSetup,
  confirmTotpSetup,
  verifyBoundTotp,
  activateBoundTotp,
  regenerateBackupCodes,
  disableSecondFactor,
} from '../domain/two-factor.js';
import {
  clearSecurityStepUpFailures,
  consumeSecurityStepUp,
  issueSecurityStepUp,
  reserveSecurityStepUpAttempt,
  type SecurityStepUpScope,
} from '../domain/security-stepup.js';
import {
  readNotificationPreferences,
  saveNotificationPreferences,
  readServerSettings,
  saveSeenHint,
} from '../domain/settings.js';
import { resolveUploadConfig } from '../config/upload.js';
import {
  deleteStoredAvatar,
  formatAllowed,
  inspectAvatar,
  readCappedBytes,
  storedAvatarUrl,
  writeAvatarFile,
} from '../services/avatar-store.js';
import { ensureRoom } from '../services/media-gc.js';
import { hashToken, revokeAllDevicesForUser, revokeDeviceForUser } from '../domain/session.js';
import { readJsonBody } from '../http/body-limit.js';
import { clientIp } from '../http/client-ip.js';
import { jsonResponse, mutate } from '../http/respond.js';
import type { NodeEnv } from '../server/node-middleware.js';
import { tokenFrom } from '../middleware/auth.js';
import { authenticateHono, userOf, type HonoContext, type HonoEnv } from './hono-utils.js';

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

async function currentAvatar(userId: string): Promise<string> {
  const result = await query<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.avatar || '';
}

async function loadUser(id: string) {
  // 到期结算先于拼 payload：资料页、兑换结果与导航能力位都按结算后的角色下发。
  await settleExpiredExhibitor(id);
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
  return userPayload(row, capabilities(row.role, row.status as string | undefined));
}

async function verifiedAt(userId: string) {
  const result = await query<VerifiedAtRow>('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
  const value = result.rows[0]?.email_verified_at;
  return value ? new Date(value).toISOString() : '';
}

/** 新版 JWT 的 sid 跨续期保持稳定；旧版 JWT 用当前 bearer 的哈希作临时会话标识。 */
function stepUpSessionId(c: HonoContext, user: { userId: string; sessionId?: string }): string {
  if (user.sessionId) return user.sessionId;
  const token = tokenFrom({ headers: { authorization: c.req.header('authorization') } });
  return `legacy:${hashToken(token)}`;
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
      const parsed = parseSchema(profilePatchSchema(bounds), body);
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };

      if (has(parsed, 'nickname')) {
        set('nickname', parsed.nickname);
      }
      if (has(parsed, 'email'))
        throw badRequest('邮箱需要通过「验证新邮箱」修改', { code: 'validation.emailChangeViaFlow' });
      if (has(parsed, 'bio')) {
        set('bio', parsed.bio);
      }
      if (has(parsed, 'region')) {
        set('region', parsed.region);
      }
      if (has(parsed, 'socialMedia')) set('social_media', parsed.socialMedia);
      let removedAvatar = '';
      if (has(parsed, 'avatar')) {
        const nextAvatar = String(parsed.avatar ?? '');
        const previous = await currentAvatar(user.userId);
        if (nextAvatar !== previous) {
          // 新头像只能走上传接口，避免再把设备私有路径写进库。清空仍然允许。
          if (nextAvatar !== '') throw badRequest('头像请通过上传更新', { code: 'profile.avatarUploadOnly' });
          set('avatar', '');
          removedAvatar = previous;
        }
      }
      if (has(parsed, 'showRegistrations')) set('show_registrations', parsed.showRegistrations);

      if (assignments.length > 0) {
        values.push(user.userId);
        await query(
          `UPDATE users SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
          values,
        );
      }
      if (removedAvatar) await deleteStoredAvatar(removedAvatar, resolveUploadConfig());
      return { user: await loadUser(user.userId) };
    });
  });

  app.post('/avatar', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    assertNotLimited(user, 'profile');
    return mutate(c, async () => {
      const settings = await readServerSettings();
      const config = resolveUploadConfig();
      const limitMb = Math.min(settings.upload.avatarSizeMb, config.maxMb);
      const maxBytes = limitMb * 1024 * 1024;
      const declared = Number(c.req.header('content-length'));
      const read = await readCappedBytes(c.req.raw.body, maxBytes, Number.isFinite(declared) ? declared : undefined);
      if (!read.ok)
        throw badRequest(`头像超过 ${limitMb} MB 限制`, {
          code: 'profile.avatarTooLarge',
          params: { max: limitMb },
        });
      const inspected = inspectAvatar(read.bytes);
      if (!inspected.ok) {
        const tooLarge = inspected.reason === 'too-large';
        throw badRequest(tooLarge ? '图片尺寸过大' : '无法识别的图片', {
          code: tooLarge ? 'media.imageDimensionsTooLarge' : 'media.imageUnreadable',
        });
      }
      if (!formatAllowed(inspected.image.extension, settings.upload.avatarFormats)) {
        throw badRequest(
          `服务器设置不允许上传 .${inspected.image.extension} 格式，允许：${settings.upload.avatarFormats.join('、')}`,
          {
            code: 'profile.avatarFormatRejected',
            params: { ext: inspected.image.extension, formats: settings.upload.avatarFormats.join('、') },
          },
        );
      }
      await ensureRoom(read.bytes.byteLength);
      const previous = await currentAvatar(user.userId);
      const fileName = await writeAvatarFile(read.bytes, inspected.image.extension, config);
      const url = storedAvatarUrl(fileName, config);
      try {
        await query('UPDATE users SET avatar = $2, updated_at = now() WHERE id = $1', [user.userId, url]);
      } catch (error) {
        await deleteStoredAvatar(url, config);
        throw error;
      }
      await deleteStoredAvatar(previous, config);
      return { url, user: await loadUser(user.userId) };
    });
  });

  app.delete('/avatar', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    assertNotLimited(user, 'profile');
    return mutate(c, async () => {
      const previous = await currentAvatar(user.userId);
      await query("UPDATE users SET avatar = '', updated_at = now() WHERE id = $1", [user.userId]);
      await deleteStoredAvatar(previous, resolveUploadConfig());
      return { url: '', user: await loadUser(user.userId) };
    });
  });

  app.post('/password', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const bounds = await limits();
      const { newPassword: nextPassword } = parseSchema(passwordChangeSchema(bounds), body);
      await consumeSecurityStepUp(body.stepUpToken, user.userId, stepUpSessionId(c, user), 'password');
      await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        user.userId,
        await bcrypt.hash(nextPassword, 10),
      ]);
      await revokeAllDevicesForUser(user.userId);
      return {};
    });
  });

  app.get('/security', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const factors = await secondFactorState(user.userId);
    if (!factors) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
    return jsonResponse(c, {
      email: factors.email,
      emailVerified: factors.emailVerified,
      emailVerifiedAt: await verifiedAt(user.userId),
      twoFactorEnabled: factors.enabled,
      twoFactorMethod: factors.method,
      totpEnabled: factors.totpBound,
      backupCodesLeft: factors.backupCodesLeft,
      canEnable: factors.emailVerified && factors.email !== '',
    });
  });

  app.post('/security/email-code', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const factors = await secondFactorState(user.userId);
    if (!factors) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
    if (!factors.emailVerified || !factors.email)
      throw badRequest('请先验证当前邮箱', { code: 'security.verifyCurrentEmailFirst' });
    const sent = await issueCode({
      purpose: 'security',
      email: factors.email,
      userId: user.userId,
      ip: requestIp(c, options.trustProxy),
    });
    return jsonResponse(c, { ok: true, error: '', ...sent, maskedEmail: maskEmail(factors.email) });
  });

  app.post('/security/verify', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    const { method, scope, code } = parseSchema(securityIdentitySchema, body);
    const factors = await secondFactorState(user.userId);
    if (!factors) throw notFound('用户不存在或已删除', { code: 'users.notFound' });

    if (method === 'totp') {
      if (!factors.totpBound)
        return jsonResponse(c, { ok: false, error: '此账号尚未配置验证器', errorCode: 'security.totpNotConfigured' });
      const currentSessionId = stepUpSessionId(c, user);
      await reserveSecurityStepUpAttempt(user.userId, currentSessionId);
      try {
        if (!(await verifyBoundTotp(user.userId, code))) {
          return jsonResponse(c, { ok: false, error: '验证器验证码不正确', errorCode: 'security.totpCodeInvalid' });
        }
        await clearSecurityStepUpFailures(user.userId, currentSessionId);
      } catch (error: unknown) {
        if (isCodeRejected(error))
          return jsonResponse(c, { ok: false, error: error.message, ...errorDetailFields(error.errorDetail) });
        throw error;
      }
    } else {
      if (!factors.emailVerified || !factors.email) {
        return jsonResponse(c, {
          ok: false,
          error: '当前邮箱尚未验证，无法使用邮箱验证码复核身份',
          errorCode: 'security.emailNotVerified',
        });
      }
      try {
        const consumed = await consumeCode({ purpose: 'security', email: factors.email, code });
        if (consumed.userId !== user.userId) {
          return jsonResponse(c, { ok: false, error: '验证码不正确或已失效', errorCode: 'security.codeInvalid' });
        }
      } catch (error: unknown) {
        if (isCodeRejected(error))
          return jsonResponse(c, { ok: false, error: error.message, ...errorDetailFields(error.errorDetail) });
        throw error;
      }
    }

    const stepUpToken = await issueSecurityStepUp(user.userId, stepUpSessionId(c, user), scope as SecurityStepUpScope);
    return jsonResponse(c, { ok: true, error: '', stepUpToken, expiresInSec: 300 });
  });

  app.post('/2fa/enable', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    await consumeSecurityStepUp(body.stepUpToken, user.userId, stepUpSessionId(c, user), 'factor');
    const found = await query<FactorToggleRow>(
      'SELECT email, email_verified, two_factor_enabled FROM users WHERE id = $1',
      [user.userId],
    );
    const row = found.rows[0];
    if (!row) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
    if (row.email_verified !== true || !row.email)
      throw badRequest('请先验证邮箱，再开启两步验证', { code: 'security.verifyEmailBeforeTwoFactor' });
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
    const { code } = parseSchema(codeSchema, body);
    const found = await query<FactorToggleRow>('SELECT email, two_factor_enabled FROM users WHERE id = $1', [
      user.userId,
    ]);
    const emailRow = found.rows[0];
    if (!emailRow) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
    let consumed;
    try {
      consumed = await consumeCode({
        purpose: 'enable2fa',
        email: emailRow.email,
        code,
      });
    } catch (error: unknown) {
      if (isCodeRejected(error))
        return jsonResponse(c, { ok: false, error: error.message, ...errorDetailFields(error.errorDetail) });
      throw error;
    }
    if (consumed.userId !== user.userId)
      return jsonResponse(c, { ok: false, error: '验证码不正确或已失效', errorCode: 'security.codeInvalid' });
    await query(
      "UPDATE users SET two_factor_enabled = true, two_factor_method = 'email', updated_at = now() WHERE id = $1",
      [user.userId],
    );
    return jsonResponse(c, {
      ok: true,
      error: '',
      twoFactorEnabled: true,
      twoFactorMethod: 'email',
      backupCodes: emailRow.two_factor_enabled === true ? [] : await regenerateBackupCodes(user.userId),
    });
  });

  app.post('/2fa/totp/setup', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    await consumeSecurityStepUp(body.stepUpToken, user.userId, stepUpSessionId(c, user), 'totp');
    const found = await query<TotpAccountRow>('SELECT id, username, email FROM users WHERE id = $1', [user.userId]);
    const account = found.rows[0];
    if (!account) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
    const settings = await readServerSettings();
    const issuer = String((settings.brand && (settings.brand.zh || settings.brand.en)) || 'calMobile');
    const setup = await beginTotpSetup(account, issuer);
    const confirmToken = await issueSecurityStepUp(user.userId, stepUpSessionId(c, user), 'totp-confirm');
    return jsonResponse(c, { ok: true, error: '', issuer, ...setup, stepUpToken: confirmToken });
  });

  app.post('/2fa/totp/activate', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    if (!(await activateBoundTotp(user.userId)))
      throw badRequest('请先配置验证器并验证邮箱', { code: 'security.configureTotpFirst' });
    return jsonResponse(c, { ok: true, error: '', twoFactorEnabled: true, twoFactorMethod: 'totp' });
  });

  app.post('/2fa/totp/enable', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    const { code } = parseSchema(codeSchema, body);
    const currentSessionId = stepUpSessionId(c, user);
    await reserveSecurityStepUpAttempt(user.userId, currentSessionId);
    try {
      const result = await confirmTotpSetup(user.userId, code, body.stepUpToken, currentSessionId);
      await clearSecurityStepUpFailures(user.userId, currentSessionId);
      return jsonResponse(c, { ok: true, error: '', twoFactorEnabled: true, ...result });
    } catch (error: unknown) {
      if (isCodeRejected(error)) {
        return jsonResponse(c, { ok: false, error: error.message, ...errorDetailFields(error.errorDetail) });
      }
      throw error;
    }
  });

  app.post('/2fa/backup-codes', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const { password } = parseSchema(passwordOnlySchema, body);
      const found = await query<PasswordFactorRow>(
        'SELECT password_hash, two_factor_enabled FROM users WHERE id = $1',
        [user.userId],
      );
      const row = found.rows[0];
      if (!row || !(await bcrypt.compare(password, row.password_hash)))
        throw badRequest('当前密码不正确', { code: 'security.currentPasswordWrong' });
      if (row.two_factor_enabled !== true)
        throw badRequest('请先开启两步验证，再生成备用码', { code: 'security.twoFactorRequiredForBackup' });
      return { backupCodes: await regenerateBackupCodes(user.userId) };
    });
  });

  app.post('/2fa/disable', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      await consumeSecurityStepUp(body.stepUpToken, user.userId, stepUpSessionId(c, user), 'factor');
      await disableSecondFactor(user.userId);
      return { twoFactorEnabled: false };
    });
  });

  app.get('/sessions', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const result = await query<{
      id: string;
      device_name: string;
      first_seen: string | Date;
      last_active: string | Date;
      current: boolean;
      active_sessions: number;
    }>(
      `
        SELECT COALESCE(NULLIF(device_hash, ''), session_id) AS id,
               max(device_name) AS device_name,
               min(created_at) AS first_seen,
               max(created_at) AS last_active,
               bool_or(session_id = $2) AS current,
               count(DISTINCT session_id)::int AS active_sessions
          FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
         GROUP BY COALESCE(NULLIF(device_hash, ''), session_id)
         ORDER BY max(created_at) DESC
      `,
      [user.userId, userOf(c)?.sessionId || ''],
    );
    return jsonResponse(c, {
      sessions: result.rows.map((row) => ({
        id: row.id,
        deviceName: row.device_name || '',
        firstSeen: new Date(row.first_seen).toISOString(),
        lastActive: new Date(row.last_active).toISOString(),
        current: row.current === true,
        activeSessions: Number(row.active_sessions) || 1,
      })),
    });
  });

  app.delete('/sessions/:id', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const id = c.req.param('id').trim();
    if (!id || id.length > 128) throw badRequest('设备标识无效', { code: 'security.deviceIdInvalid' });
    await revokeDeviceForUser(user.userId, id);
    return jsonResponse(c, { ok: true, error: '' });
  });

  app.post('/sessions/revoke-all', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    await revokeAllDevicesForUser(user.userId);
    return jsonResponse(c, { ok: true, error: '' });
  });

  app.post('/email', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    const { email } = parseSchema(emailSchema, body);
    const current = await query<EmailOnlyRow>('SELECT email FROM users WHERE id = $1', [user.userId]);
    if (String(current.rows[0]?.email || '').toLowerCase() === email.toLowerCase())
      throw badRequest('新邮箱与当前邮箱相同', { code: 'profile.emailUnchanged' });
    await consumeSecurityStepUp(body.stepUpToken, user.userId, stepUpSessionId(c, user), 'email');
    const taken = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (taken.rows.length > 0)
      return jsonResponse(c, { ok: false, error: '该邮箱已被其他账号使用', errorCode: 'profile.emailTaken' });
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
    const { email, code } = parseSchema(emailVerifyLooseSchema, body);
    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'email', email, code });
    } catch (error: unknown) {
      if (isCodeRejected(error))
        return jsonResponse(c, { ok: false, error: error.message, ...errorDetailFields(error.errorDetail) });
      throw error;
    }
    if (consumed.userId !== user.userId)
      return jsonResponse(c, { ok: false, error: '验证码不正确或已失效', errorCode: 'security.codeInvalid' });
    try {
      await query(
        `UPDATE users SET email = $2, email_verified = true, email_verified_at = now(), updated_at = now() WHERE id = $1`,
        [user.userId, consumed.email],
      );
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        return jsonResponse(c, { ok: false, error: '该邮箱已被其他账号使用', errorCode: 'profile.emailTaken' });
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
    const rawBody = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => ({
      notify: await saveNotificationPreferences(user.userId, parseSchema(notifySchema, rawBody)),
    }));
  });

  /**
   * 记下一条「看过的提示」。
   *
   * 一次性提示（首页滑动日历、展商核销说明）看过就与账号绑定：换设备、重装都还在，
   * 因此落在 `users.seen_hints` 而不是本机存储。幂等，重复提交同一条不会报错。
   */
  app.put('/hints', authenticateHono, async (c) => {
    const user = requireUser({ user: userOf(c) });
    const body = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => ({ seenHints: await saveSeenHint(user.userId, body.hint) }));
  });

  app.post('/invite', authenticateHono, async (c) => {
    const actor = requireUser({ user: userOf(c) });
    assertNotLimited(actor, 'invite');
    const rawBody = bodyRecord(await readJsonBody(c));
    return mutate(c, async () => {
      const body = parseSchema(inviteRedeemSchema, rawBody);
      // 以库里的角色为准：认证中间件可能刚把到期的展商结算成普通用户。
      const current = await query<{ role: string; exhibitor_expires_at: string | Date | null }>(
        'SELECT role, exhibitor_expires_at FROM users WHERE id = $1',
        [actor.userId],
      );
      const row = current.rows[0];
      if (!row) throw notFound('用户不存在或已删除', { code: 'users.notFound' });
      if (row.role === 'admin') throw badRequest('你已经是管理员', { code: 'profile.alreadyAdmin' });
      // 永久展商没有可续的时长；限时展商可以续期，普通用户（含已到期的）直接开通。
      if (row.role === 'exhibitor' && !row.exhibitor_expires_at)
        throw badRequest('你已经是展商', { code: 'profile.alreadyExhibitor' });
      if (row.role !== 'user' && row.role !== 'exhibitor')
        throw badRequest('当前身份不能使用邀请码', { code: 'profile.inviteRoleInvalid' });
      await transaction(async (client) => {
        const { durationDays } = await consumeInvite(client, body.code);
        await client.query(
          `UPDATE users
              SET role = 'exhibitor',
                  exhibitor_expires_at = CASE
                    WHEN $2::int = 0 THEN NULL
                    ELSE GREATEST(now(), COALESCE(exhibitor_expires_at, now())) + make_interval(days => $2::int)
                  END,
                  updated_at = now()
            WHERE id = $1`,
          [actor.userId, durationDays],
        );
      });
      return { user: await loadUser(actor.userId) };
    });
  });

  return app;
}

export const PROFILE_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['PUT', '/'],
  ['POST', '/avatar'],
  ['DELETE', '/avatar'],
  ['POST', '/password'],
  ['GET', '/security'],
  ['POST', '/security/email-code'],
  ['POST', '/security/verify'],
  ['GET', '/sessions'],
  ['DELETE', '/sessions/:id'],
  ['POST', '/sessions/revoke-all'],
  ['POST', '/2fa/enable'],
  ['POST', '/2fa/enable/verify'],
  ['POST', '/2fa/totp/setup'],
  ['POST', '/2fa/totp/activate'],
  ['POST', '/2fa/totp/enable'],
  ['POST', '/2fa/backup-codes'],
  ['POST', '/2fa/disable'],
  ['POST', '/email'],
  ['POST', '/email/verify'],
  ['PUT', '/hints'],
  ['POST', '/invite'],
  ['GET', '/notifications'],
  ['PUT', '/notifications'],
];
