/**
 * 权限判定。
 *
 * 页面（`bootstrap` 下发的 `user.can`）与路由用的是同一套判定，避免出现
 * 「按钮显示出来了但接口拒绝」或者反过来的情况。
 *
 * 角色规则（沿用原型的四角色）：
 * - `guest`   访客：只能看，不能报名、不能编辑；
 * - `user`    普通用户：可以报名、维护个人资料；
 * - `exhibitor` 展商：额外可以管理自己举办的展会与报名审核、现场核销；
 * - `admin`   管理员：全部权限，并且不受用户隐私开关限制。
 */

const { forbidden, unauthorized } = require('./errors');

/** 角色能力：与前端 `user.can` 的四个键一致。 */
function capabilities(role) {
  const loggedIn = role === 'user' || role === 'exhibitor' || role === 'admin';
  return {
    register: loggedIn,
    profile: loggedIn,
    exhibitor: role === 'exhibitor' || role === 'admin',
    admin: role === 'admin',
  };
}

/** 要求已登录；返回当前用户行。 */
function requireUser(req, message = '请先登录') {
  if (!req.user) {
    throw unauthorized(message);
  }
  return req.user;
}

/** 要求是指定角色之一。 */
function requireRole(req, roles, message = '无权执行此操作') {
  const user = requireUser(req);
  if (!roles.includes(user.role)) {
    throw forbidden(message);
  }
  return user;
}

/** 展商后台 / 报名管理 / 核销：展商与管理员可用。 */
function requireExhibitor(req, message = '只有展商或管理员可以执行此操作') {
  return requireRole(req, ['exhibitor', 'admin'], message);
}

/** 服务器级设置：只有管理员可改。 */
function requireAdmin(req, message = '只有管理员可以修改服务器设置') {
  return requireRole(req, ['admin'], message);
}

/**
 * 能否管理这场展会。
 *
 * 管理员不限；展商只能管理自己举办的展会（`exhibitor_id` 为空的历史数据
 * 视为公共数据，管理员以外不可改）。
 */
function canManageExhibition(user, exhibition) {
  if (!user) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  if (user.role !== 'exhibitor') {
    return false;
  }
  return Boolean(exhibition && exhibition.exhibitor_id) && exhibition.exhibitor_id === user.userId;
}

/** 不能管理时抛出 403；返回展会行便于继续使用。 */
function assertCanManageExhibition(user, exhibition) {
  if (!exhibition) {
    return false;
  }
  if (!canManageExhibition(user, exhibition)) {
    throw forbidden('只能管理自己举办的展会');
  }
  return true;
}

module.exports = {
  capabilities,
  requireUser,
  requireRole,
  requireExhibitor,
  requireAdmin,
  canManageExhibition,
  assertCanManageExhibition,
};
