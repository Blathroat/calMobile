/** Hono 认证路由：复用既有领域服务与响应约定。 */

import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { TrustProxy } from '../config/runtime.js';
import { query } from '../config/pool.js';
import { USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { userPayload, guestPayload, type UserRow } from '../domain/payloads.js';
import { capabilities } from '../domain/permissions.js';
import { limits, parseSchema, safeParseSchema } from '../domain/validation.js';
import {
  loginSchema,
  loginVerifySchema,
  registerSchema,
  registerVerifySchema,
  resetPasswordSchema,
  ticketSchema,
  emailSchema,
  refreshSchema,
  logoutSchema,
} from '../domain/schemas.js';
import {
  issueSession,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllDevicesForUser,
  hashDeviceToken,
  rememberTrustedDevice,
  useTrustedDevice,
  type SessionDevice,
} from '../domain/session.js';
import { issueCode, consumeCode, isCodeRejected, maskEmail } from '../domain/otp.js';
import { secondFactorState, verifySecondFactor, type SecondFactorUser } from '../domain/two-factor.js';
import { issueTicket, findTicket, consumeTicket, countTicketFailure } from '../domain/preauth.js';
import { badRequest, unauthorized } from '../domain/errors.js';
import { failureResponse, jsonResponse, okResponse } from '../http/respond.js';
import { clientIp } from '../http/client-ip.js';
import { honoRateLimit } from '../middleware/rate-limit.js';
import type { NodeEnv } from '../server/node-middleware.js';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(`missing-${Date.now()}`, 10);

interface LoginAccountRow {
  id: string;
  username: string;
  email: string | null;
  email_verified: boolean | null;
  two_factor_enabled: boolean | null;
  password_hash: string;
  status: string;
}
interface LoginFactorRow {
  id: string;
  username: string;
  role: string;
  email: string | null;
  email_verified: boolean | null;
  totp_secret: string | null;
  two_factor_method: string | null;
  status: string;
}
interface LoginCodeRow {
  id: string;
  email: string | null;
  email_verified: boolean | null;
  two_factor_enabled?: boolean | null;
  two_factor_method?: string | null;
}
interface RegistrationNameRow {
  username: string | null;
  email: string | null;
}
interface RegisterPayload {
  username?: string;
  passwordHash?: string;
  nickname?: string;
}
interface IdRow {
  id: string;
}

function bodyError(c: Context): unknown {
  return c.get('authBodyError');
}

async function bodyOf(c: Context): Promise<Record<string, any>> {
  const cached = c.get('authBody');
  if (cached !== undefined) {
    if (bodyError(c)) {
      throw bodyError(c);
    }
    return (cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : {}) as Record<string, any>;
  }
  const contentType = c.req.header('content-type') || '';
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || (!contentType && !c.req.header('content-length'))) {
    c.set('authBody', {});
    return {};
  }
  try {
    const raw = await c.req.text();
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    c.set('authBody', parsed);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as Record<string, any>;
  } catch {
    c.set('authBodyError', badRequest('请求体不是合法的 JSON'));
    throw c.get('authBodyError');
  }
}

function requestIp(c: Context, trustProxy: TrustProxy): string {
  const env = c.env as NodeEnv | undefined;
  return clientIp(
    { remoteAddress: env?.incoming?.socket?.remoteAddress, forwardedFor: c.req.header('x-forwarded-for') },
    trustProxy,
  );
}

function sessionDevice(token: unknown, name: unknown): SessionDevice {
  return {
    deviceHash: hashDeviceToken(token),
    deviceName: String(name ?? '')
      .trim()
      .slice(0, 80),
  };
}

function authLimiter(trustProxy: TrustProxy) {
  return honoRateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: '尝试过于频繁，请稍后再试',
    ip: (c) => requestIp(c, trustProxy),
    identity: async (c) => {
      try {
        const body = await bodyOf(c);
        return String(body.username || body.email || '');
      } catch {
        return '';
      }
    },
  });
}

async function loadUser(id: string) {
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  const row = result.rows[0];
  return row ? userPayload(row, capabilities(row.role, row.status ?? undefined)) : null;
}

async function registrationConflict(username: string, email: string) {
  if (!email) return '请输入有效的邮箱地址';
  const existing = await query<RegistrationNameRow>(
    `SELECT lower(username) AS username, lower(email) AS email FROM users
       WHERE lower(username) = lower($1) OR lower(email) = lower($2)`,
    [username, email],
  );
  if (existing.rows.some((row) => row.username === username.toLowerCase())) return '该用户名已被注册';
  if (existing.rows.some((row) => row.email === email.toLowerCase())) return '该邮箱已被注册';
  return '';
}

async function requireUser(c: Context) {
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const { resolveUser } = await import('../middleware/auth.js');
  const user = await resolveUser(token);
  if (!user) throw unauthorized('登录状态已失效，请重新登录');
  c.set('authUser', user);
  return user;
}

export function createAuthRoutes(options: { trustProxy: TrustProxy }): Hono {
  const app = new Hono();
  const limited = authLimiter(options.trustProxy);

  app.post('/login', limited, async (c) => {
    const parsed = safeParseSchema(loginSchema, await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { username, password, deviceToken, deviceName } = parsed.data;
    const device = sessionDevice(deviceToken, deviceName);
    const result = await query<LoginAccountRow>(
      `SELECT id, username, email, email_verified, two_factor_enabled, password_hash, status
         FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)
         ORDER BY (lower(username) = lower($1)) DESC LIMIT 1`,
      [username],
    );
    const account = result.rows[0];
    const matched = await bcrypt.compare(password, account?.password_hash || DUMMY_PASSWORD_HASH);
    if (!account || !matched) return failureResponse(c, '账号或密码不正确');
    if (account.status === 'banned') return failureResponse(c, '账号已被封禁，请联系管理员');
    if (account.two_factor_enabled === true) {
      if (account.email_verified !== true || !account.email) {
        return failureResponse(c, '两步验证邮箱不可用，请联系管理员关闭两步验证');
      }
      if (await useTrustedDevice(account.id, device.deviceHash)) {
        await query('UPDATE users SET last_login_time = now() WHERE id = $1', [account.id]);
        const session = await issueSession(account as unknown as Parameters<typeof issueSession>[0], device);
        return jsonResponse(c, {
          ok: true,
          error: '',
          ...session,
          user: await loadUser(account.id),
          trustedDevice: true,
        });
      }
      const ticket = await issueTicket(account.id);
      const factors = await secondFactorState(account.id);
      const emailUsable = Boolean(factors && factors.method === 'email' && factors.emailVerified && factors.email);
      const sent = emailUsable
        ? await issueCode({
            purpose: 'login',
            email: account.email,
            userId: account.id,
            ip: requestIp(c, options.trustProxy),
          })
        : null;
      return jsonResponse(c, {
        ok: true,
        error: '',
        twoFactorRequired: true,
        ticket: ticket.ticket,
        expiresInSec: ticket.expiresInSec,
        resendAfterSec: sent ? sent.resendAfterSec : 0,
        emailSent: Boolean(sent),
        maskedEmail: maskEmail(account.email),
        methods: {
          totp: Boolean(factors && factors.method === 'totp' && factors.totpBound),
          email: emailUsable,
          backup: Boolean(factors && factors.backupCodesLeft > 0),
        },
      });
    }
    await query('UPDATE users SET last_login_time = now() WHERE id = $1', [account.id]);
    const session = await issueSession(account as unknown as Parameters<typeof issueSession>[0], device);
    return jsonResponse(c, { ok: true, error: '', ...session, user: await loadUser(account.id) });
  });

  app.post('/login/verify', limited, async (c) => {
    const parsed = safeParseSchema(loginVerifySchema, await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { ticket, code, deviceToken, deviceName, trustDevice } = parsed.data;
    const device = sessionDevice(deviceToken, deviceName);
    const found = await findTicket(ticket);
    if (!found) return failureResponse(c, '验证已过期，请重新登录');
    const account = await query<LoginFactorRow>(
      'SELECT id, username, role, email, email_verified, totp_secret, two_factor_method, status FROM users WHERE id = $1',
      [found.userId],
    );
    const row = account.rows[0];
    if (!row || row.status === 'banned') return failureResponse(c, '账号不可用，请联系管理员');
    try {
      await verifySecondFactor(row as SecondFactorUser, code);
    } catch (error: unknown) {
      if (isCodeRejected(error)) {
        await countTicketFailure(found.id);
        return failureResponse(c, error.message);
      }
      throw error;
    }
    if (!(await consumeTicket(found.id))) return failureResponse(c, '验证已使用，请重新登录');
    if (trustDevice === true) await rememberTrustedDevice(row.id, device);
    await query('UPDATE users SET last_login_time = now() WHERE id = $1', [row.id]);
    const session = await issueSession(row, device);
    return jsonResponse(c, { ok: true, error: '', ...session, user: await loadUser(row.id) });
  });

  app.post('/login/code', limited, async (c) => {
    const parsed = safeParseSchema(ticketSchema, await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { ticket } = parsed.data;
    const found = await findTicket(ticket);
    if (!found) return failureResponse(c, '验证已过期，请重新登录');
    const account = await query<LoginCodeRow>(
      'SELECT id, email, email_verified, two_factor_enabled, two_factor_method FROM users WHERE id = $1',
      [found.userId],
    );
    const row = account.rows[0];
    if (!row || row.email_verified !== true || !row.email)
      return failureResponse(c, '两步验证邮箱不可用，请联系管理员关闭两步验证');
    if (row.two_factor_enabled === true && row.two_factor_method === 'totp') {
      return failureResponse(c, '当前启用的是验证器方式，不能发送邮箱验证码');
    }
    const sent = await issueCode({
      purpose: 'login',
      email: row.email,
      userId: row.id,
      ip: requestIp(c, options.trustProxy),
    });
    return jsonResponse(c, { ok: true, error: '', ...sent, maskedEmail: maskEmail(row.email) });
  });

  app.post('/register', limited, async (c) => {
    const textLimits = await limits();
    const parsed = safeParseSchema(registerSchema(textLimits), await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { username, password, email } = parsed.data;
    const conflict = await registrationConflict(username, email);
    if (conflict) return failureResponse(c, conflict);
    const ticket = await issueCode({
      purpose: 'register',
      email,
      payload: { username, passwordHash: await bcrypt.hash(password, 10), nickname: username },
      ip: requestIp(c, options.trustProxy),
    });
    return jsonResponse(c, { ok: true, error: '', ...ticket });
  });

  app.post('/register/verify', limited, async (c) => {
    const parsed = safeParseSchema(registerVerifySchema, await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { email, code, deviceToken, deviceName } = parsed.data;
    let consumed;
    try {
      consumed = await consumeCode({
        purpose: 'register',
        email,
        code,
      });
    } catch (error: unknown) {
      if (isCodeRejected(error)) return failureResponse(c, error.message);
      throw error;
    }
    const pending = (consumed.payload || {}) as RegisterPayload;
    const username = String(pending.username || '').trim();
    if (!username || !pending.passwordHash) return failureResponse(c, '注册信息已失效，请重新填写');
    const conflict = await registrationConflict(username, consumed.email);
    if (conflict) return failureResponse(c, conflict);
    const id = `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await query(
        `INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, 'user', true, now())`,
        [id, username, pending.passwordHash, consumed.email, pending.nickname || username],
      );
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        return failureResponse(c, '该用户名或邮箱已被注册');
      throw error;
    }
    const device = sessionDevice(deviceToken, deviceName);
    await rememberTrustedDevice(id, device);
    const session = await issueSession({ id, username, role: 'user' }, device);
    return jsonResponse(c, { ok: true, error: '', ...session, user: await loadUser(id) });
  });

  app.post('/password/forgot', limited, async (c) => {
    const parsed = safeParseSchema(emailSchema, await bodyOf(c));
    if (!parsed.success) return failureResponse(c, '请输入有效的邮箱地址');
    const { email } = parsed.data;
    const found = await query<IdRow>(
      `SELECT id FROM users WHERE lower(email) = lower($1) AND email_verified = true AND status <> 'banned'`,
      [email],
    );
    const account = found.rows[0] || null;
    const ticket = await issueCode({
      purpose: 'reset',
      email,
      userId: account ? account.id : null,
      silent: !account,
      ip: requestIp(c, options.trustProxy),
    });
    return jsonResponse(c, { ok: true, error: '', ...ticket });
  });

  app.post('/password/reset', limited, async (c) => {
    const bounds = await limits();
    const parsed = safeParseSchema(resetPasswordSchema(bounds), await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { email, code, newPassword } = parsed.data;
    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'reset', email, code });
    } catch (error: unknown) {
      if (isCodeRejected(error)) return failureResponse(c, error.message);
      throw error;
    }
    const found = await query<IdRow>('SELECT id FROM users WHERE lower(email) = lower($1) AND status <> $2', [
      consumed.email,
      'banned',
    ]);
    const userRow = found.rows[0];
    if (!userRow) return failureResponse(c, '账号不存在或已停用，请联系管理员');
    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
      userRow.id,
      await bcrypt.hash(newPassword, 10),
    ]);
    await revokeAllDevicesForUser(userRow.id);
    return okResponse(c);
  });

  app.post('/guest', async (c) => jsonResponse(c, { ok: true, error: '', user: guestPayload() }));

  app.post('/logout', async (c) => {
    const parsed = safeParseSchema(logoutSchema, await bodyOf(c));
    if (!parsed.success) return failureResponse(c, parsed.error);
    const { refreshToken } = parsed.data;
    await revokeRefreshToken(refreshToken);
    return okResponse(c);
  });

  app.post('/refresh', async (c) => {
    const { refreshToken: token } = parseSchema(refreshSchema, await bodyOf(c));
    if (!token) throw badRequest('缺少刷新令牌');
    const rotated = await rotateRefreshToken(token);
    return jsonResponse(c, {
      ok: true,
      error: '',
      token: rotated.token,
      refreshToken: rotated.refreshToken,
      user: await loadUser(rotated.user.id),
    });
  });

  app.post('/logout-all', async (c) => {
    const user = await requireUser(c);
    await revokeAllDevicesForUser(user.userId);
    return okResponse(c);
  });

  return app;
}

/** 从 Hono 的真实注册表生成清单，供状态页与契约测试使用。 */
export const AUTH_ENDPOINTS = createAuthRoutes({ trustProxy: false })
  .routes.filter((route) => route.method === 'POST')
  .map((route) => [route.method, `/api/v1/auth${route.path}`] as const)
  .filter((entry, index, all) => all.findIndex((candidate) => candidate.join(' ') === entry.join(' ')) === index);
