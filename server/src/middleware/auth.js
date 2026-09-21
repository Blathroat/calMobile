/**
 * 认证中间件：校验 JWT 并把用户挂到 `req.user`。
 *
 * 错误一律 `next(new ApiError(...))` 交给 index.js 的错误中间件统一序列化
 * （Express 4 不会自动捕获 async 中间件抛出的异常，因此不能直接 throw）。
 */

const jwt = require('jsonwebtoken');
const { query } = require('../config/pool');
const { accessSecret } = require('../config/auth');
const { ApiError } = require('../domain/errors');
const { capabilities } = require('../domain/permissions');

const USER_FIELDS = 'id, username, email, nickname, role, status';

/** 从请求头取令牌；没有令牌返回空串。 */
function tokenFrom(req) {
  const header = req?.headers?.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return '';
  }
  return header.slice('Bearer '.length).trim();
}

/** 解析令牌并查出用户；令牌无效返回 null。 */
async function resolveUser(token) {
  if (!token) {
    return null;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, accessSecret);
  } catch {
    return null;
  }
  const result = await query(
    `SELECT ${USER_FIELDS} FROM users WHERE id = $1`,
    [decoded.userId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
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
async function authenticate(req, res, next) {
  try {
    const user = await resolveUser(tokenFrom(req));
    if (!user) {
      throw new ApiError(401, '登录状态已失效，请重新登录');
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * 可选登录：带了令牌就解析，没带或无效也继续（页面在访客状态下也会调这些接口）。
 * 只有一种情况会中断：账号被封禁——那不该继续按访客处理。
 */
async function optionalAuth(req, res, next) {
  try {
    req.user = await resolveUser(tokenFrom(req));
    next();
  } catch (error) {
    next(error);
  }
}

/** 角色白名单；配合 authenticate 使用。 */
function authorize(roles) {
  return (req, res, next) => {
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

module.exports = {
  authenticate,
  authorize,
  optionalAuth,
  resolveUser,
  tokenFrom,
};
