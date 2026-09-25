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
  expires_at: string | Date;
  revoked_at: string | Date | null;
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
export async function signAccessToken(user: Pick<SessionUser, 'id' | 'username' | 'role'>): Promise<string> {
  return new SignJWT({ userId: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(accessExpiresIn)
    .sign(new TextEncoder().encode(accessSecret));
}

/**
 * 新建一个刷新令牌并落库。
 * 刷新令牌本身是随机串，不是 JWT：它必须能被撤销，落在数据库里才作数。
 */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
    `,
    [crypto.randomUUID(), userId, hashToken(token), String(refreshDays())],
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
export async function issueSession(user: SessionUser): Promise<{ token: string; refreshToken: string }> {
  return {
    token: await signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
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
        SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1
    `,
    [hash],
  );
  if (result.rows.length === 0) {
    throw unauthorized('登录状态已失效，请重新登录');
  }
  const row = result.rows[0];
  if (!row) {
    throw unauthorized('登录状态已失效，请重新登录');
  }
  if (row.revoked_at) {
    throw unauthorized('登录状态已失效，请重新登录');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw unauthorized('登录已过期，请重新登录');
  }
  const user = await query<SessionUser>('SELECT id, username, role, status FROM users WHERE id = $1', [row.user_id]);
  const account = user.rows[0];
  if (user.rows.length === 0 || !account || account.status === 'banned') {
    throw unauthorized('账号不可用，请重新登录');
  }
  const revoked = await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
    row.id,
  ]);
  if (revoked.rowCount !== 1) {
    // 并发重放：这一行已经被另一个请求撤销掉了，这个令牌不能再换令牌。
    throw unauthorized('登录状态已失效，请重新登录');
  }
  return {
    user: account,
    token: await signAccessToken(account),
    refreshToken: await issueRefreshToken(account.id),
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
