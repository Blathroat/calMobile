/**
 * profile：资料读写、改密码、通知偏好。
 *
 * 响应约定（见 index.js 头部注释）：
 * - 读取接口直接返回数据本身：`GET /` 给用户态、`GET /notifications` 给通知偏好；
 * - 写入接口走 `mutate()` 信封 `{ ok, error, ... }`，校验失败是**业务失败**（HTTP 200）
 *   + `{ ok:false, error }`，页面 `if (!result.ok)` 就地提示；
 * - 未登录由 `authenticate` 给 401，前端 api.js 当作异常抛出。
 *
 * 保存资料只写**请求体里出现过的字段**：个人页保存配色或隐私开关时，
 * 不能顺带把昵称、简介或另一个开关改回默认值。
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/pool');
const { USER_COLUMNS, USER_FROM } = require('../domain/queries');
const { userPayload } = require('../domain/payloads');
const { capabilities, assertNotLimited } = require('../domain/permissions');
const { limits, bool } = require('../domain/validation');
const { mutate } = require('../domain/respond');
const { badRequest, notFound } = require('../domain/errors');
const {
  readNotificationPreferences, saveNotificationPreferences,
} = require('../domain/settings');
const { revokeAllForUser } = require('../domain/session');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/** 邮箱格式与 auth.js 的注册校验保持一致。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 请求体里是否真的带了某个字段（`{bio: ''}` 与「没传」是两件事）。 */
function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

/** 读取一个用户行并拼成前端要的用户态（页面直接拿它刷新界面）。 */
async function loadUser(id) {
  const result = await query(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  if (result.rows.length === 0) {
    throw notFound('用户不存在或已删除');
  }
  const row = result.rows[0];
  return userPayload(row, capabilities(row.role, row.status));
}

/**
 * GET /api/v1/profile
 * 当前登录用户的资料，返回的就是页面使用的用户态对象。
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await loadUser(req.user.userId));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/profile
 * 保存资料：`nickname / email / bio / region / socialMedia / avatar / showRegistrations`，
 * 只更新出现过的字段（隐私开关此前没有落库，这里真的写 `users.show_registrations`）。
 *
 * 受限账号（管理员不受限）不能改个人信息 → 403；判定放在 `mutate()` 外面，
 * 前端才拿得到状态码。改密码与通知偏好是另外两条路由，不受这条限制。
 */
router.put('/', authenticate, async (req, res, next) => {
  try {
    assertNotLimited(req.user, 'profile');
  } catch (error) {
    next(error);
    return;
  }
  try {
    await mutate(res, next, async () => {
      const body = req.body || {};
      const bounds = await limits();
      const assignments = [];
      const values = [];
      /** 追加一列赋值，参数按顺序占位，SQL 全程参数化。 */
      const set = (column, value) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };

      if (has(body, 'nickname')) {
        const nickname = String(body.nickname === undefined ? '' : body.nickname).trim();
        if (!nickname) {
          throw badRequest('昵称不能为空');
        }
        if (bounds.nickname && nickname.length > bounds.nickname) {
          throw badRequest(`昵称最多 ${bounds.nickname} 个字符`);
        }
        set('nickname', nickname);
      }
      if (has(body, 'email')) {
        const email = String(body.email === undefined ? '' : body.email).trim();
        if (email && (!EMAIL_PATTERN.test(email) || email.length > 120)) {
          throw badRequest('邮箱格式不正确');
        }
        set('email', email);
      }
      if (has(body, 'bio')) {
        const bio = String(body.bio === undefined ? '' : body.bio).trim();
        if (bounds.bio && bio.length > bounds.bio) {
          throw badRequest(`个人简介最多 ${bounds.bio} 个字符`);
        }
        set('bio', bio);
      }
      if (has(body, 'region')) {
        const region = String(body.region === undefined ? '' : body.region).trim();
        if (bounds.region && region.length > bounds.region) {
          throw badRequest(`地区最多 ${bounds.region} 个字符`);
        }
        set('region', region);
      }
      if (has(body, 'socialMedia')) {
        set('social_media', String(body.socialMedia === undefined ? '' : body.socialMedia).trim());
      }
      if (has(body, 'avatar')) {
        set('avatar', String(body.avatar === undefined ? '' : body.avatar).trim());
      }
      if (has(body, 'showRegistrations')) {
        set('show_registrations', bool(body.showRegistrations, false));
      }

      if (assignments.length > 0) {
        values.push(req.user.userId);
        await query(`
                    UPDATE users SET ${assignments.join(', ')}, updated_at = now()
                    WHERE id = $${values.length}
                `, values);
      }
      return { user: await loadUser(req.user.userId) };
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/password
 * 改密码：先校验输入与当前密码，再落新哈希，最后撤销该用户全部刷新令牌
 * （其它设备上的旧刷新令牌从此换不到访问令牌）。
 */
router.post('/password', authenticate, async (req, res, next) => {
  try {
    await mutate(res, next, async () => {
      const body = req.body || {};
      const current = String(body.currentPassword === undefined ? '' : body.currentPassword);
      const nextPassword = String(body.newPassword === undefined ? '' : body.newPassword);
      const confirm = String(body.confirmPassword === undefined ? '' : body.confirmPassword);

      if (!current || !nextPassword) {
        throw badRequest('请填写完整密码');
      }
      if (nextPassword !== confirm) {
        throw badRequest('两次输入的新密码不一致');
      }
      const bounds = await limits();
      if (bounds.passwordMin && nextPassword.length < bounds.passwordMin) {
        throw badRequest(`密码至少需要 ${bounds.passwordMin} 个字符`);
      }
      if (bounds.passwordMax && nextPassword.length > bounds.passwordMax) {
        throw badRequest(`密码最多 ${bounds.passwordMax} 个字符`);
      }

      const found = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
      const matched = found.rows.length > 0
                && await bcrypt.compare(current, found.rows[0].password_hash);
      if (!matched) {
        throw badRequest('当前密码不正确');
      }

      await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        req.user.userId,
        await bcrypt.hash(nextPassword, 10),
      ]);
      await revokeAllForUser(req.user.userId);
      return {};
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/profile/notifications
 * 通知偏好（个人页的两个开关）。设备通知权限由客户端自己确认，
 * 后端只保存用户的开关，因此 `granted` 恒为 true，不代表系统权限已授予。
 */
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    res.json(await readNotificationPreferences(req.user.userId));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/profile/notifications
 * 保存通知偏好：可以只提交一个开关，未提交的保持不变。
 */
router.put('/notifications', authenticate, async (req, res, next) => {
  try {
    await mutate(res, next, async () => ({
      notify: await saveNotificationPreferences(req.user.userId, req.body || {}),
    }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
