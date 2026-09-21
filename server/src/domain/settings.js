/**
 * 服务器级设置与个人偏好。
 *
 * - **服务器级**（主题配色、软件标题、公告、分类、审核策略、媒体与上传限制、表单字符数上限）
 *   存在 `app_settings` 里，保存后对所有用户生效，只有管理员能改；
 * - **个人偏好**（外观模式）存在 `users.ui_mode`，未登录时用 `app_settings.ui` 作为默认值；
 * - **通知开关**存在 `notification_preferences`。
 *
 * `applyServerPatch()` 是纯函数：只做「校验 + 合并」，方便单测；落库由 `saveServerSettings()` 完成。
 */

const { query } = require('../config/pool');
const { DEFAULT_SETTINGS } = require('../config/migrate');
const { badRequest } = require('./errors');
const { toUserStatus } = require('./labels');

/** 表单字符数上限的取值范围：前端 `core/validate.js` 的 `limit()` 按同一批键取值。 */
const LIMIT_BOUNDS = {
  exhibitionTitle: [4, 120],
  exhibitionVenue: [4, 120],
  category: [2, 60],
  fieldTitle: [2, 60],
  usernameMin: [2, 20],
  usernameMax: [4, 40],
  passwordMin: [4, 24],
  passwordMax: [8, 64],
  nickname: [2, 40],
  bio: [20, 1000],
  region: [4, 120],
  answer: [20, 1000],
};

/** 成对的上限不能小于下限。 */
const PAIRED_FLOOR = { usernameMax: 'usernameMin', passwordMax: 'passwordMin' };

const MODES = ['auto', 'light', 'dark'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampInt(value, fallback, [min, max]) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

/**
 * 读取服务器设置：数据库里的值盖在默认值之上，缺项自动有默认值。
 *
 * `media` 与 `upload` 是**一项 JSON 里的多个键**（不是数据库列），所以库里那一项可能是
 * 加新键之前写入的：例如老库的 `app_settings.media` 里没有 `videoSizeMb`。
 * 这两段按「默认值为底、库里的键覆盖」补齐，保证 `GET /bootstrap` 与 `GET /settings`
 * （两者都来自这里）永远能读到 `videoSizeMb`，不会给出 undefined。
 */
async function readServerSettings() {
  const result = await query('SELECT key, value FROM app_settings');
  const settings = clone(DEFAULT_SETTINGS);
  for (const row of result.rows) {
    if (Object.prototype.hasOwnProperty.call(settings, row.key)) {
      settings[row.key] = row.value;
    }
  }
  settings.media = { ...DEFAULT_SETTINGS.media, ...settings.media };
  settings.upload = { ...DEFAULT_SETTINGS.upload, ...settings.upload };
  return settings;
}

/** 取一项设置（例如 limits）。 */
async function readSection(key) {
  const settings = await readServerSettings();
  return settings[key];
}

/**
 * 把前端（管理-设置 / 个人页）提交的**扁平**字段合并进服务器设置。
 * 只处理出现过的键，因此保存配色不会把别的设置改回默认值。
 */
function applyServerPatch(current, patch) {
  const next = clone(current);
  const source = patch || {};

  if (Object.prototype.hasOwnProperty.call(source, 'themeIndex')) {
    next.theme.index = clampInt(source.themeIndex, next.theme.index, [0, Math.max(0, next.theme.colors.length - 1)]);
  }
  if (
    Object.prototype.hasOwnProperty.call(source, 'announcement') ||
    Object.prototype.hasOwnProperty.call(source, 'announcementEnabled')
  ) {
    next.announcement = {
      enabled:
        source.announcementEnabled === undefined ? next.announcement.enabled : Boolean(source.announcementEnabled),
      text: source.announcement === undefined ? next.announcement.text : String(source.announcement).slice(0, 200),
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(source, 'appTitleZh') ||
    Object.prototype.hasOwnProperty.call(source, 'appTitleEn')
  ) {
    const zh = String(source.appTitleZh === undefined ? next.brand.zh : source.appTitleZh).trim();
    const en = String(source.appTitleEn === undefined ? next.brand.en : source.appTitleEn).trim();
    if (!zh || !en) {
      throw badRequest('软件标题不能为空');
    }
    if (zh.length > 20) {
      throw badRequest('中文标题最多 20 个字符');
    }
    if (en.length > 24) {
      throw badRequest('英文标题最多 24 个字符');
    }
    next.brand = { zh, en };
  }
  if (Array.isArray(source.categories)) {
    const categories = source.categories
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 40);
    if (categories.length > 0) {
      next.categories = categories;
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'canRevise')) {
    next.review = { ...next.review, canRevise: Boolean(source.canRevise) };
  }
  if (['imageCount', 'imageSizeMb', 'videoCount', 'videoSizeMb'].some((key) => key in source)) {
    // 兜底值再取一次默认设置：库里那一项可能是加新键**之前**写入的 JSON
    // （例如 media 里还没有 videoSizeMb），直接拿 `next.media.videoSizeMb` 会是 undefined。
    const fallback = { ...DEFAULT_SETTINGS.media, ...next.media };
    next.media = {
      imageCount: clampInt(source.imageCount, fallback.imageCount, [1, 30]),
      imageSizeMb: clampNumber(source.imageSizeMb, fallback.imageSizeMb, 1, 50),
      videoCount: clampInt(source.videoCount, fallback.videoCount, [0, 10]),
      videoSizeMb: clampNumber(source.videoSizeMb, fallback.videoSizeMb, 1, 500),
    };
  }
  if (['avatarSizeMb', 'imageFormats', 'videoFormats'].some((key) => key in source)) {
    next.upload = {
      avatarSizeMb: clampNumber(source.avatarSizeMb, next.upload.avatarSizeMb, 1, 20),
      imageFormats: formatList(source.imageFormats, next.upload.imageFormats),
      videoFormats: formatList(source.videoFormats, next.upload.videoFormats),
    };
  }
  // 字符数上限：逐项收敛，成对的上下限再互相约束一次。
  const limits = { ...next.limits };
  for (const [key, bounds] of Object.entries(LIMIT_BOUNDS)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      limits[key] = clampInt(source[key], limits[key], bounds);
    }
  }
  for (const [upper, lower] of Object.entries(PAIRED_FLOOR)) {
    limits[upper] = Math.max(limits[upper], limits[lower]);
  }
  next.limits = limits;

  return next;
}

/** 「jpg,png」或数组都接受，返回去重后的小写数组。 */
function formatList(value, fallback) {
  const items = Array.isArray(value) ? value : String(value === undefined ? '' : value).split(',');
  const formats = [];
  for (const item of items) {
    const format = String(item).trim().toLowerCase().replace(/^\./, '');
    if (format && /^[a-z0-9]{1,10}$/.test(format) && !formats.includes(format)) {
      formats.push(format);
    }
  }
  return formats.length > 0 ? formats : fallback;
}

/** 落库：只写值发生变化的段。 */
async function saveServerSettings(current, next) {
  for (const key of Object.keys(next)) {
    if (JSON.stringify(current[key]) === JSON.stringify(next[key])) {
      continue;
    }
    await query(
      `
            INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `,
      [key, JSON.stringify(next[key])],
    );
  }
  return next;
}

/** 个人外观模式：登录用户读自己的，未登录读服务器默认值。 */
async function readUiMode(userId, serverSettings) {
  if (userId) {
    const result = await query('SELECT ui_mode FROM users WHERE id = $1', [userId]);
    if (result.rows.length > 0 && MODES.includes(result.rows[0].ui_mode)) {
      return result.rows[0].ui_mode;
    }
  }
  const mode = serverSettings?.ui?.mode;
  return MODES.includes(mode) ? mode : 'auto';
}

/** 保存个人外观模式：只写调用者自己的 `users.ui_mode`。 */
async function saveUiMode(userId, mode) {
  if (!userId) {
    // 没有 userId 就写不了「个人」偏好；以前这里会退回写全局 app_settings.ui，
    // 于是匿名请求能改掉所有用户的默认外观，现在直接拒绝。
    throw badRequest('请先登录后再保存外观模式');
  }
  const next = MODES.includes(mode) ? mode : 'auto';
  await query('UPDATE users SET ui_mode = $2, updated_at = now() WHERE id = $1', [userId, next]);
  return next;
}

/** 通知偏好：没有记录时返回默认值并顺手建一行。 */
async function readNotificationPreferences(userId) {
  if (!userId) {
    return { exhibitionReminder: true, registrationUpdates: true, granted: true };
  }
  const result = await query(
    'SELECT exhibition_reminder, registration_updates FROM notification_preferences WHERE user_id = $1',
    [userId],
  );
  if (result.rows.length === 0) {
    await query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    return { exhibitionReminder: true, registrationUpdates: true, granted: true };
  }
  return {
    exhibitionReminder: result.rows[0].exhibition_reminder,
    registrationUpdates: result.rows[0].registration_updates,
    granted: true,
  };
}

/** 保存通知偏好（部分字段也可以）。 */
async function saveNotificationPreferences(userId, patch) {
  if (!userId) {
    throw badRequest('请先登录后再保存通知偏好');
  }
  const current = await readNotificationPreferences(userId);
  const next = {
    exhibitionReminder:
      patch && 'exhibitionReminder' in patch ? Boolean(patch.exhibitionReminder) : current.exhibitionReminder,
    registrationUpdates:
      patch && 'registrationUpdates' in patch ? Boolean(patch.registrationUpdates) : current.registrationUpdates,
  };
  await query(
    `
        INSERT INTO notification_preferences (user_id, exhibition_reminder, registration_updates, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (user_id) DO UPDATE SET
            exhibition_reminder = EXCLUDED.exhibition_reminder,
            registration_updates = EXCLUDED.registration_updates,
            updated_at = now()
    `,
    [userId, next.exhibitionReminder, next.registrationUpdates],
  );
  return next;
}

/** 前端传给「管理-设置」的账号状态值校验（复用标签映射，避免多写一份）。 */
function normalizeUserStatus(value) {
  const status = toUserStatus(value);
  if (!status) {
    throw badRequest('账号状态只能是 正常 / 受限 / 封禁');
  }
  return status;
}

module.exports = {
  LIMIT_BOUNDS,
  MODES,
  applyServerPatch,
  readServerSettings,
  readSection,
  saveServerSettings,
  readUiMode,
  saveUiMode,
  readNotificationPreferences,
  saveNotificationPreferences,
  normalizeUserStatus,
  formatList,
};
