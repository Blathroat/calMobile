import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from '../domain/errors.js';
import { resolveUser, tokenFrom, type AuthedUser } from '../middleware/auth.js';

export type HonoEnv = { Variables: { user: AuthedUser | null } };
export type HonoContext = Context<HonoEnv>;

/** Hono 认证中间件：统一复用令牌解析器。 */
export const authenticateHono: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const user = await resolveUser(tokenFrom({ headers: { authorization: c.req.header('authorization') } }));
  if (!user) {
    // 与 domain/session.ts 同一句文案、同一个码：前端按 code 本地化，不认时显示中文。
    throw new ApiError(401, '登录状态已失效，请重新登录', true, { code: 'session.expired' });
  }
  c.set('user', user);
  await next();
};

export const optionalAuthHono: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const user = await resolveUser(tokenFrom({ headers: { authorization: c.req.header('authorization') } }));
  c.set('user', user);
  await next();
};

export function userOf(c: HonoContext): AuthedUser | null {
  return c.get('user');
}
