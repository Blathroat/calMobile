/**
 * users：用户管理（列表 / 单个 / 账号状态）与用户公开页。
 *
 * 权限（见 domain/permissions.js）：列表、单个用户、改状态都是管理员专属，
 * 判定写在 `mutate()` 外面或 try 里直接抛，让前端拿到 403 而不是 200 + `{ ok:false }`；
 * 用户公开页访客也能看（`optionalAuth`），报名记录按用户隐私开关过滤。
 *
 * 字段一律取 `queries.js` 的 `USER_COLUMNS`，它不含 `password_hash`。
 */

const express = require('express');
const { query } = require('../config/pool');
const { USER_COLUMNS, USER_FROM, REGISTRATION_COLUMNS, REGISTRATION_FROM } = require('../domain/queries');
const { adminUserPayload, publicRegistrationPayload } = require('../domain/payloads');
const labels = require('../domain/labels');
const { requireAdmin } = require('../domain/permissions');
const { normalizeUserStatus } = require('../domain/settings');
const { mutate } = require('../domain/respond');
const { badRequest, notFound } = require('../domain/errors');
const { revokeAllForUser } = require('../domain/session');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/** 用户列表 / 公开页的统一排序：先注册的在前，id 兜底保证顺序稳定。 */
const USER_ORDER = 'ORDER BY u.registration_time, u.id';

/** ILIKE 的转义：把 % _ \ 变成字面量，避免用户输入被当成通配符。 */
function likePattern(keyword) {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** 读一行用户（对外字段，不带密码哈希）；不存在返回 null。 */
async function findUserById(id) {
  const result = await query(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  return result.rows[0] || null;
}

/** 改状态后回给页面的用户摘要（`role` / `status` 都是中文标签）。 */
function statusPayload(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    role: labels.ROLE_LABEL[row.role] || row.role,
    roleCode: row.role,
    status: labels.USER_STATUS[row.status] || labels.USER_STATUS.active,
  };
}

/**
 * GET /api/v1/users
 * 用户列表（管理员）。可选 `?query=` 按昵称 / 用户名 / 邮箱模糊匹配。
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req, '只有管理员可以查看用户列表');
    const keyword = String(req.query.query === undefined ? '' : req.query.query).trim();
    const result = keyword
      ? await query(
          `
                SELECT ${USER_COLUMNS} ${USER_FROM}
                WHERE u.nickname ILIKE $1 ESCAPE '\\'
                   OR u.username ILIKE $1 ESCAPE '\\'
                   OR u.email ILIKE $1 ESCAPE '\\'
                ${USER_ORDER}
            `,
          [likePattern(keyword)],
        )
      : await query(`SELECT ${USER_COLUMNS} ${USER_FROM} ${USER_ORDER}`);
    res.json(result.rows.map((row, index) => adminUserPayload(row, index)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/users/public?userId=&nickname=
 * 用户公开页（访客可读）：前端 `core/api.js` 的 `users.public` 打的就是这里。
 *
 * 一个入口同时支持两种定位方式，不再另设 `/:id/public`——同一份实现的两种写法
 * 只会让「哪个才是真的」变成下一个人的疑问；`?userId=` 与 `/:id` 的语义完全等价。
 * 注意本路由必须声明在 `/:id` 之前，否则 `public` 会被当成一个 id。
 *
 * 隐私规则：**本人或管理员**总能看报名记录，其余访问者只在用户打开了
 * `show_registrations` 时才能看；管理员视角由 `viewedAsAdmin` 标记，
 * 页面据此说明「当前是管理视角」。
 */
router.get('/public', optionalAuth, async (req, res, next) => {
  try {
    const id = String(req.query.userId === undefined ? '' : req.query.userId).trim();
    const nickname = String(req.query.nickname === undefined ? '' : req.query.nickname).trim();
    res.json(await publicProfile(req, await findPublicTarget({ id, nickname })));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/users/:id
 * 单个用户（管理员）；页面只用到 id / 昵称 / 角色。
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req, '只有管理员可以查看用户资料');
    const row = await findUserById(req.params.id);
    res.json(
      row
        ? {
            found: true,
            user: {
              id: row.id,
              nickname: row.nickname,
              role: labels.ROLE_LABEL[row.role] || row.role,
            },
          }
        : { found: false, user: null },
    );
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/users/:id/status
 * 改账号状态：接受中文标签（正常 / 受限 / 封禁）或代码。
 * 管理员不能改自己的状态（避免把自己锁在门外）；封禁后立即撤销其刷新令牌。
 */
router.put('/:id/status', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req, '只有管理员可以修改账号状态');
    await mutate(res, next, async () => {
      const status = normalizeUserStatus((req.body || {}).status);
      if (req.params.id === req.user.userId) {
        throw badRequest('不能修改自己的账号状态');
      }
      const row = await findUserById(req.params.id);
      if (!row) {
        throw notFound('用户不存在或已删除');
      }
      await query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [req.params.id, status]);
      if (status === 'banned') {
        await revokeAllForUser(req.params.id);
      }
      const updated = await findUserById(req.params.id);
      return { user: statusPayload(updated || row) };
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/users/:id/two-factor  （管理员）
 *
 * 关闭某个账号的两步验证 —— **这是两步验证唯一的兜底出口**：用户的邮箱一旦用不了
 * （离职、邮箱被回收、域名过期），没有这条路他就永远登不进来。
 * 接口是幂等的：本来就关着也返回成功。
 */
router.put('/:id/two-factor', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req, '只有管理员可以关闭他人的两步验证');
    await mutate(res, next, async () => {
      const enabled = (req.body || {}).enabled !== false;
      if (enabled) {
        throw badRequest('两步验证只能由本人开启（需要验证码）');
      }
      const row = await findUserById(req.params.id);
      if (!row) {
        throw notFound('用户不存在或已删除');
      }
      await query('UPDATE users SET two_factor_enabled = false, updated_at = now() WHERE id = $1', [req.params.id]);
      return { user: statusPayload(row), twoFactorEnabled: false };
    });
  } catch (error) {
    next(error);
  }
});

/** 公开页的查询目标：按 id 精确匹配，昵称兜底（昵称没有唯一约束，取最早注册的一个）。 */ async function findPublicTarget({
  id,
  nickname,
}) {
  if (id) {
    return findUserById(id);
  }
  if (nickname) {
    const result = await query(
      `
            SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.nickname = $1 ${USER_ORDER} LIMIT 1
        `,
      [nickname],
    );
    return result.rows[0] || null;
  }
  return null;
}

/** 组装公开页响应：资料 + 按隐私规则过滤后的报名记录。 */
async function publicProfile(req, target) {
  if (!target) {
    return { found: false, error: '用户不存在或未公开' };
  }
  const viewer = req.user;
  const viewedAsAdmin = viewer?.role === 'admin';
  const isSelf = Boolean(viewer) && viewer.userId === target.id;
  const showRegistrations = target.show_registrations === true;

  // 只有已通过 / 已参加的报名对外展示，待审核与已拒绝属于内部流转状态。
  // 公开页对访客开放，因此映射用 publicRegistrationPayload：去掉现场核销用的报名码。
  let registrations = [];
  if (viewedAsAdmin || isSelf || showRegistrations) {
    const result = await query(
      `
            SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM}
            WHERE r.visitor_id = $1 AND r.status IN ('approved', 'attended')
            ORDER BY e.exhibition_date DESC, r.created_at DESC
        `,
      [target.id],
    );
    registrations = result.rows.map(publicRegistrationPayload);
  }

  const profile = {
    nickname: target.nickname,
    role: labels.ROLE_LABEL[target.role] || target.role,
    bio: target.bio || '',
    region: target.region || '',
    avatar: target.avatar || '',
    socialMedia: target.social_media || '',
    registrationTime: target.registration_time || '',
  };
  return {
    found: true,
    // 页面（user-public.js）直接读顶层字段，因此资料同时铺在顶层；
    // 另外按接口约定给出 `profile` 分组，两种取法都能拿到。
    ...profile,
    profile,
    viewedAsAdmin,
    showRegistrations,
    registrations,
  };
}

module.exports = router;
