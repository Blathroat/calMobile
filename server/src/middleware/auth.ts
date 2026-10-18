/** JWT 认证共享解析器；Hono 中间件负责把结果写入 Context。 */

import { query } from '../config/pool.js';
import { loadProcessConfig } from '../config/env.js';
import { ApiError } from '../domain/errors.js';
import { capabilities, type Capabilities } from '../domain/permissions.js';
import { isPastExpiry, settleExpiredExhibitor } from '../domain/membership.js';
import { jwtVerify } from 'jose';

const { accessSecret } = loadProcessConfig().auth;

const USER_FIELDS = 'id, username, email, nickname, role, status, exhibitor_expires_at';

export interface AuthedUser {
  userId: string;
  username: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
  /** JWT 会话 id；老版本令牌没有 sid，等自然过期后会统一升级。 */
  sessionId?: string;
  /** 展商时长已经走完：本次请求按普通用户处理，写操作可据此给出「已到期」说明。 */
  exhibitorExpired?: boolean;
  can: Capabilities;
}

export interface AuthRequest {
  headers?: { authorization?: unknown };
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
  exhibitor_expires_at: string | Date | null;
}

/** 从请求头取令牌；没有令牌返回空串。 */
export function tokenFrom(req?: AuthRequest | null): string {
  const header = req?.headers?.authorization as string | undefined;
  if (!header || !header.startsWith('Bearer ')) {
    return '';
  }
  return header.slice('Bearer '.length).trim();
}

/** 解析令牌并查出用户；令牌无效返回 null。 */
export async function resolveUser(token: string): Promise<AuthedUser | null> {
  if (!token) {
    return null;
  }
  let decoded: { userId?: unknown; sid?: unknown };
  try {
    const verified = await jwtVerify<{ userId?: unknown; sid?: unknown }>(
      token,
      new TextEncoder().encode(accessSecret),
      {
        algorithms: ['HS256'],
      },
    );
    decoded = verified.payload;
  } catch {
    return null;
  }
  const sessionId = typeof decoded.sid === 'string' ? decoded.sid : '';
  if (sessionId) {
    const active = await query(
      `SELECT 1 FROM refresh_tokens
        WHERE user_id = $1 AND session_id = $2 AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [decoded.userId, sessionId],
    );
    // 撤销单台设备或全部设备后，旧访问令牌也立即失效；只保留没有 sid 的旧版 JWT 到期。
    if (active.rows.length === 0) return null;
  }
  const result = await query<UserRow>(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [decoded.userId]);
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  if (row.status === 'banned') {
    throw new ApiError(403, '账号已被封禁');
  }
  // 限时展商到期：在这里惰性结算。命中时把库里的角色改成普通用户，本次请求
  // 也按普通用户继续（不必等定时任务）；普通用户保留过去的到期时间，用于展示「已到期」。
  const expired = isPastExpiry(row.exhibitor_expires_at);
  let role = row.role;
  if (row.role === 'exhibitor' && expired) {
    await settleExpiredExhibitor(row.id);
    role = 'user';
  }
  const exhibitorExpired = expired && (row.role === 'exhibitor' || role === 'user');
  return {
    userId: row.id,
    username: row.username,
    email: row.email,
    nickname: row.nickname,
    role,
    status: row.status,
    ...(sessionId ? { sessionId } : {}),
    ...(exhibitorExpired ? { exhibitorExpired } : {}),
    can: capabilities(role, row.status),
  };
}
