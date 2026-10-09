/** JWT 认证共享解析器；Hono 中间件负责把结果写入 Context。 */

import { query } from '../config/pool.js';
import { loadProcessConfig } from '../config/env.js';
import { ApiError } from '../domain/errors.js';
import { capabilities, type Capabilities } from '../domain/permissions.js';
import { jwtVerify } from 'jose';

const { accessSecret } = loadProcessConfig().auth;

const USER_FIELDS = 'id, username, email, nickname, role, status';

export interface AuthedUser {
  userId: string;
  username: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
  /** JWT 会话 id；老版本令牌没有 sid，等自然过期后会统一升级。 */
  sessionId?: string;
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
    const verified = await jwtVerify<{ userId?: unknown; sid?: unknown }>(token, new TextEncoder().encode(accessSecret), {
      algorithms: ['HS256'],
    });
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
  return {
    userId: row.id,
    username: row.username,
    email: row.email,
    nickname: row.nickname,
    role: row.role,
    status: row.status,
    ...(sessionId ? { sessionId } : {}),
    can: capabilities(row.role, row.status),
  };
}
