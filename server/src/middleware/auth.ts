/**
 * 认证中间件：校验 JWT 并把用户挂到 `req.user`。
 *
 * 错误一律 `next(new ApiError(...))` 交给 index.js 的错误中间件统一序列化。
 */

import { query } from '../config/pool';
import auth = require('../config/auth');
import { ApiError } from '../domain/errors';
import { capabilities, type Capabilities } from '../domain/permissions';

const jwt = require('jsonwebtoken') as {
  verify(token: string, secret: string): { userId?: unknown };
};

const { accessSecret } = auth;

const USER_FIELDS = 'id, username, email, nickname, role, status';

export interface AuthedUser {
  userId: string;
  username: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
  can: Capabilities;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser | null;
    }
  }
}

export interface AuthRequest {
  headers?: { authorization?: unknown };
  user?: AuthedUser | null;
}

type NextFn = (error?: unknown) => void;

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
  let decoded: { userId?: unknown };
  try {
    decoded = jwt.verify(token, accessSecret);
  } catch {
    return null;
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
    can: capabilities(row.role, row.status),
  };
}

/** 必须登录。 */
export async function authenticate(req: AuthRequest, _res: unknown, next: NextFn): Promise<void> {
  try {
    const user = await resolveUser(tokenFrom(req));
    if (!user) {
      throw new ApiError(401, '登录状态已失效，请重新登录');
    }
    req.user = user;
    next();
  } catch (error: unknown) {
    next(error);
  }
}

/**
 * 可选登录：带了令牌就解析，没带或无效也继续（页面在访客状态下也会调这些接口）。
 * 只有一种情况会中断：账号被封禁——那不该继续按访客处理。
 */
export async function optionalAuth(req: AuthRequest, _res: unknown, next: NextFn): Promise<void> {
  try {
    req.user = await resolveUser(tokenFrom(req));
    next();
  } catch (error: unknown) {
    next(error);
  }
}

/** 角色白名单；配合 authenticate 使用。 */
export function authorize(roles: string[]) {
  return (req: AuthRequest, _res: unknown, next: NextFn): void => {
    if (!req.user) {
      next(new ApiError(401, '请先登录'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ApiError(403, '无权执行此操作'));
      return;
    }
    next();
  };
}
