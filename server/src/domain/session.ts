/**
 * 会话与令牌。
 *
 * - **访问令牌**是短时效 JWT（默认 15 分钟），放在 `Authorization: Bearer`；
 * - **刷新令牌**是随机串，只把 sha256 哈希落库，可撤销、可轮换；
 * - 登录、刷新、退出都会更新 `refresh_tokens`，因此「退出登录」是真的失效
 *   （令牌在数据库里被撤销），不只是客户端把本地缓存丢掉。
 */

import crypto from 'node:crypto';
import { query } from '../config/pool.js';
import { loadProcessConfig } from '../config/env.js';
import { unauthorized } from './errors.js';
import { SignJWT } from 'jose';

const { accessSecret, accessExpiresIn, refreshTokenTtl } = loadProcessConfig().auth;

interface SessionUser {
  id: string;
  username: string;
  role: string;
  status?: string;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  session_id: string;
  device_hash: string;
  device_name: string;
  expires_at: string | Date;
  revoked_at: string | Date | null;
}

export interface SessionDevice {
  deviceHash: string;
  deviceName: string;
}

/** 刷新令牌的有效期（天）：从 REFRESH_TOKEN_TTL（如 7d）解析。 */
function refreshDays(): number {
  const match = /^(\d+)d$/.exec(String(refreshTokenTtl));
  return match ? Number(match[1]) : 7;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 签发访问令牌；访问令牌只允许 HS256。 */
export async function signAccessToken(
  user: Pick<SessionUser, 'id' | 'username' | 'role'>,
  sessionId?: string,
): Promise<string> {
  return new SignJWT({
    userId: user.id,
    username: user.username,
    role: user.role,
    ...(sessionId ? { sid: sessionId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(accessExpiresIn)
    .sign(new TextEncoder().encode(accessSecret));
}

/**
 * 新建一个刷新令牌并落库。
 * 刷新令牌本身是随机串，不是 JWT：它必须能被撤销，落在数据库里才作数。
 */
export async function issueRefreshToken(
  userId: string,
  sessionId: string,
  device: SessionDevice = { deviceHash: '', deviceName: '' },
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, session_id, device_hash, device_name)
        VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6, $7)
    `,
    [
      crypto.randomUUID(),
      userId,
      hashToken(token),
      String(refreshDays()),
      sessionId,
      device.deviceHash,
      device.deviceName,
    ],
  );
  // 顺手清掉过期与已撤销的：不清的话这张表会随每次登录一直长。
  void purgeStaleTokens();
  return token;
}

/** 清理已经过期或已撤销的刷新令牌（失败不影响登录）。 */
export function purgeStaleTokens(): Promise<unknown> {
  return query(`
        DELETE FROM refresh_tokens
        WHERE expires_at < now() - interval '1 day'
           OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')
    `).catch((error: unknown) => {
    console.warn('清理过期刷新令牌失败：', errorMessage(error));
  });
}

/** 登录成功后一次性签发两个令牌。 */
export async function issueSession(
  user: SessionUser,
  device: SessionDevice = { deviceHash: '', deviceName: '' },
): Promise<{ token: string; refreshToken: string }> {
  const sessionId = crypto.randomUUID();
  return {
    token: await signAccessToken(user, sessionId),
    refreshToken: await issueRefreshToken(user.id, sessionId, device),
  };
}

/**
 * 用刷新令牌换一套新令牌（轮换：旧的立即作废）。
 * 校验顺序：存在 → 未撤销 → 未过期，任何一步不通过都按「登录已失效」处理。
 *
 * **撤销必须是原子的**：`SELECT` 出来的 `revoked_at` 只是给人看的快速路径，
 * 真正说了算的是 `UPDATE … WHERE revoked_at IS NULL` 的 `rowCount`。以前是
 * 「先 SELECT 判断、再按 id UPDATE」，同一个刷新令牌并发用两次时两个请求都会通过
 * 判断、各换一套新令牌（TOCTOU）；现在只有把这一行从「未撤销」改成「已撤销」的那个
 * 请求能拿到新令牌，另一个按重放处理。
 */
export async function rotateRefreshToken(token: string): Promise<{
  user: SessionUser;
  token: string;
  refreshToken: string;
}> {
  const hash = hashToken(token);
  const result = await query<RefreshTokenRow>(
    `
        SELECT id, user_id, session_id, device_hash, device_name, expires_at, revoked_at
          FROM refresh_tokens WHERE token_hash = $1
    `,
    [hash],
  );
  if (result.rows.length === 0) {
    throw unauthorized('登录状态已失效，请重新登录', { code: 'session.expired' });
  }
  const row = result.rows[0];
  if (!row) {
    throw unauthorized('登录状态已失效，请重新登录', { code: 'session.expired' });
  }
  if (row.revoked_at) {
    throw unauthorized('登录状态已失效，请重新登录', { code: 'session.expired' });
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw unauthorized('登录已过期，请重新登录', { code: 'session.loginExpired' });
  }
  const user = await query<SessionUser>('SELECT id, username, role, status FROM users WHERE id = $1', [row.user_id]);
  const account = user.rows[0];
  if (user.rows.length === 0 || !account || account.status === 'banned') {
    throw unauthorized('账号不可用，请重新登录', { code: 'session.accountUnavailable' });
  }
  const revoked = await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
    row.id,
  ]);
  if (revoked.rowCount !== 1) {
    // 并发重放：这一行已经被另一个请求撤销掉了，这个令牌不能再换令牌。
    throw unauthorized('登录状态已失效，请重新登录', { code: 'session.expired' });
  }
  return {
    user: account,
    token: await signAccessToken(account, row.session_id || row.id),
    refreshToken: await issueRefreshToken(account.id, row.session_id || row.id, {
      deviceHash: row.device_hash || '',
      deviceName: row.device_name || '',
    }),
  };
}

/** 退出登录：撤销该刷新令牌；访问令牌等它自然过期。 */
export async function revokeRefreshToken(token: unknown): Promise<boolean> {
  if (!token) {
    return false;
  }
  const result = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(String(token))],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 撤销某个用户的全部刷新令牌（改密码、封禁账号时用）。 */
export async function revokeAllForUser(userId: string): Promise<void> {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/** 把设备令牌变成不可逆哈希；空令牌表示旧版客户端，没有设备身份。 */
export function hashDeviceToken(token: unknown): string {
  const value = String(token ?? '').trim();
  return value ? hashToken(`trusted-device:${value}`) : '';
}

/** 只在两步验证通过或注册完成后调用；同一设备重复记住时更新名称和最后使用时间。 */
export async function rememberTrustedDevice(userId: string, device: SessionDevice): Promise<void> {
  if (!device.deviceHash) return;
  await query(
    `
        INSERT INTO trusted_devices (id, user_id, token_hash, name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, token_hash) DO UPDATE
            SET name = EXCLUDED.name, last_used_at = now()
    `,
    [crypto.randomUUID(), userId, device.deviceHash, device.deviceName],
  );
}

/** 密码正确时检查本设备是否已被本人记住；命中后更新活跃时间。 */
export async function useTrustedDevice(userId: string, deviceHash: string): Promise<boolean> {
  if (!deviceHash) return false;
  const result = await query(
    'UPDATE trusted_devices SET last_used_at = now() WHERE user_id = $1 AND token_hash = $2 RETURNING id',
    [userId, deviceHash],
  );
  return result.rowCount === 1;
}

/** 下线一个设备：撤销它的全部活动会话，并忘记它的可信状态。 */
export async function revokeDeviceForUser(userId: string, deviceId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND (device_hash = $2 OR session_id = $2)`,
    [userId, deviceId],
  );
  await query('DELETE FROM trusted_devices WHERE user_id = $1 AND token_hash = $2', [userId, deviceId]);
}

/** 全部下线也清掉可信设备，避免撤销会话后旧设备只凭密码就能绕过二步验证。 */
export async function revokeAllDevicesForUser(userId: string): Promise<void> {
  await revokeAllForUser(userId);
  await query('DELETE FROM trusted_devices WHERE user_id = $1', [userId]);
}
