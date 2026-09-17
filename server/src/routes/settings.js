/**
 * settings：服务器设置读写与个人外观模式。
 *
 * - `GET /` 访客也能读（页面首帧要用），返回的键与原生 `SystemActions.settings()` 一致：
 *   `theme / ui / announcement / brand / categories / review / media / upload / limits / notify`；
 * - `PUT /` 只有管理员能改。请求体是**扁平**补丁（键与「管理-设置」表单一一对应），
 *   合并与收敛交给 `domain/settings.js` 的 `applyServerPatch()`，这里不重复实现；
 *   带 `notify` 时顺带保存当前用户的通知偏好（与原生 `saveSettings` 分工一致）；
 * - `PUT /ui-mode` 是个人偏好（存 `users.ui_mode`），访客调用则写服务器默认值。
 */

const express = require('express');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin } = require('../domain/permissions');
const { mutate } = require('../domain/respond');
const {
  applyServerPatch, readNotificationPreferences, readServerSettings, readUiMode,
  saveNotificationPreferences, saveServerSettings, saveUiMode,
} = require('../domain/settings');

const router = express.Router();

/** 请求体里是否真的带了某个字段。 */
function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

/**
 * 组装设置响应。
 *
 * GET 与 PUT 返回同一份结构：页面保存后立刻用它刷新界面（`applySettings`），
 * 少一个键就会回落到旧值，因此两处共用这一个函数。
 */
async function settingsPayload(userId) {
  const settings = await readServerSettings();
  return {
    theme: settings.theme,
    ui: { mode: await readUiMode(userId, settings) },
    announcement: settings.announcement,
    brand: settings.brand,
    categories: settings.categories,
    review: settings.review,
    media: settings.media,
    // 上传限制对外叫 upload（bootstrap 里的 `server` 是它的另一个别名）。
    upload: settings.upload,
    limits: settings.limits,
    notify: await readNotificationPreferences(userId),
  };
}

/**
 * GET /api/v1/settings
 * 服务器设置 + 当前用户的通知偏好；未登录时用服务器默认外观模式。
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    res.json(await settingsPayload(req.user?.userId));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/settings
 * 保存服务器设置。权限判定放在 `mutate()` **外面**：非管理员要拿到 403，
 * 而不是被包成 200 的 `{ ok:false }` 业务失败。
 */
router.put('/', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req, '只有管理员可以修改服务器设置');
    await mutate(res, next, async () => {
      const body = req.body || {};
      const current = await readServerSettings();
      const next = applyServerPatch(current, body);
      await saveServerSettings(current, next);
      if (has(body, 'notify')) {
        await saveNotificationPreferences(req.user.userId, body.notify || {});
      }
      return { settings: await settingsPayload(req.user.userId) };
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/settings/ui-mode
 * 个人外观模式：只认 auto / light / dark，其余一律当 auto（与演示后端一致）。
 */
router.put('/ui-mode', optionalAuth, async (req, res, next) => {
  try {
    await mutate(res, next, async () => {
      const body = req.body || {};
      return { mode: await saveUiMode(req.user?.userId, String(body.mode === undefined ? '' : body.mode)) };
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
