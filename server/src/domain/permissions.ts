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
 *
 * 账号状态（`users.status`）在角色之上再收一层：
 * - `limited` **受限**：不能报名、不能发布 / 编辑 / 删除展会、不能改报名设置、不能核销，
 *   其余照旧可用（登录、浏览、查询、审核报名、通知偏好、改密码、撤销自己的报名）；
 * - `banned`  **封禁**：在认证层就被拒绝（见 `middleware/auth.ts`），不走这里；
 * - 管理员永远不受限 —— 否则没有任何人能解除限制。
 */

import { forbidden, unauthorized } from './errors.js';

export interface Actor {
  userId: string;
  role: string;
  status?: string;
}

export interface AuthedRequest {
  user?: Actor | null;
}

export interface ExhibitionOwner {
  exhibitor_id?: string | null;
}

export interface Capabilities {
  register: boolean;
  profile: boolean;
  exhibitor: boolean;
  admin: boolean;
  limited: boolean;
}

/**
 * 角色 + 状态能力：与前端 `user.can` 的五个键一致。
 *
 * `limited` 让前端能在按钮置灰时说明原因，因此**受限时 register / profile 为 false**
 * （服务端路由也按同一判定拦截，见 `assertNotLimited()`），两边不会说两套话。
 * `exhibitor` / `admin` 仍按角色给：受限的展商照样能进后台查看自己已有的展会、
 * 审核报名，只是所有展会写操作都会在路由层被 `assertNotLimited()` 拦成 403
 * （能力位保持角色口径，写操作的拦截以服务端为准）。
 */
export function capabilities(role: string, status?: string): Capabilities {
  const loggedIn = role === 'user' || role === 'exhibitor' || role === 'admin';
  const limited = isLimited({ role, status });
  return {
    register: loggedIn && !limited,
    profile: loggedIn && !limited,
    exhibitor: role === 'exhibitor' || role === 'admin',
    admin: role === 'admin',
    limited,
  };
}

/** 管理员包含展商的全部能力，因此也能开办私人会议、被预约。 */
export function canHostMeetings(role: string | null | undefined): boolean {
  return role === 'exhibitor' || role === 'admin';
}

/** 是不是「受限」账号。管理员不算（否则没人能解除限制）；缺 status 时按未受限处理。 */
export function isLimited(user: { role?: string; status?: string } | null | undefined): boolean {
  if (!user || user.role === 'admin') {
    return false;
  }
  return user.status === 'limited';
}

/**
 * 受限账号的统一拦截点：每个禁止的操作各给一句可展示的文案。
 *
 * 路由里只调用这里，不各写一遍 `status === 'limited'`，避免改规则时漏掉某一处。
 */
export const LIMITED_ACTIONS: Record<string, string> = {
  register: '账号已被限制，不能报名',
  exhibition: '账号已被限制，不能发布展会',
  exhibitionUpdate: '账号已被限制，不能修改展会',
  exhibitionDelete: '账号已被限制，不能删除展会',
  exhibitionStatus: '账号已被限制，不能修改报名设置',
  exhibitionFields: '账号已被限制，不能修改报名设置',
  checkin: '账号已被限制，不能核销',
  profile: '账号已被限制，不能编辑个人信息',
  meetingSettings: '账号已被限制，不能修改私人会议设置',
};

/** 受限账号执行被禁操作时抛出 403；返回当前用户便于串起来用。 */
export function assertNotLimited(user: Actor | null | undefined, action: string): Actor | null | undefined {
  if (!isLimited(user)) {
    return user;
  }
  const message = LIMITED_ACTIONS[action];
  if (!message) {
    throw new Error(`未知的受限操作：${action}`);
  }
  throw forbidden(message);
}

/** 要求已登录；返回当前用户行。 */
export function requireUser(req: AuthedRequest, message = '请先登录'): Actor {
  if (!req.user) {
    throw unauthorized(message);
  }
  return req.user;
}

/** 要求是指定角色之一。 */
export function requireRole(req: AuthedRequest, roles: string[], message = '无权执行此操作'): Actor {
  const user = requireUser(req);
  if (!roles.includes(user.role)) {
    throw forbidden(message);
  }
  return user;
}

/** 展商后台 / 报名管理 / 核销：展商与管理员可用。 */
export function requireExhibitor(req: AuthedRequest, message = '只有展商或管理员可以执行此操作'): Actor {
  return requireRole(req, ['exhibitor', 'admin'], message);
}

/** 服务器级设置：只有管理员可改。 */
export function requireAdmin(req: AuthedRequest, message = '只有管理员可以修改服务器设置'): Actor {
  return requireRole(req, ['admin'], message);
}

/**
 * 能否管理这场展会。
 *
 * 管理员不限；展商只能管理自己举办的展会（`exhibitor_id` 为空的历史数据
 * 视为公共数据，管理员以外不可改）。
 */
export function canManageExhibition(
  user: Actor | null | undefined,
  exhibition: ExhibitionOwner | null | undefined,
): boolean {
  if (!user) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  if (user.role !== 'exhibitor') {
    return false;
  }
  return Boolean(exhibition && exhibition.exhibitor_id && exhibition.exhibitor_id === user.userId);
}

/** 不能管理时抛出 403；返回展会行便于继续使用。 */
export function assertCanManageExhibition(
  user: Actor | null | undefined,
  exhibition: ExhibitionOwner | null | undefined,
): boolean {
  if (!exhibition) {
    return false;
  }
  if (!canManageExhibition(user, exhibition)) {
    throw forbidden('只能管理自己举办的展会');
  }
  return true;
}
