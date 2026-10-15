/**
 * 服务器级设置与个人偏好。
 *
 * - **服务器级**（主题配色、软件标题、公告、分类、审核策略、媒体与上传限制、表单字符数上限）
 *   存在 `app_settings` 里，保存后对所有用户生效，只有管理员能改；
 * - **个人偏好**（外观模式、配色下标）存在 `users.ui_mode` / `users.ui_theme`，
 *   未登录或没选过时用 `app_settings.ui` / `app_settings.theme.index` 作为默认值；
 * - **通知开关**存在 `notification_preferences`。
 *
 * `applyServerPatch()` 是纯函数：只做「校验 + 合并」，方便单测；落库由 `saveServerSettings()` 完成。
 */

import { query } from '../config/pool.js';
import { DEFAULT_SETTINGS, type ServerSettings } from '../config/migrate.js';
import { badRequest } from './errors.js';
import { normalizeWhenFull } from '../services/media-quota.js';
import { toUserStatus } from './labels.js';

/** 表单字符数上限的取值范围：前端 `core/validate.js` 的 `limit()` 按同一批键取值。 */
export const LIMIT_BOUNDS: Record<keyof ServerSettings['limits'], [number, number]> = {
  exhibitionTitle: [4, 120],
  exhibitionVenue: [4, 120],
  category: [2, 60],
  fieldTitle: [2, 60],
  textFill: [1, 1000],
  radioOption: [1, 120],
  checkOption: [1, 120],
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
const PAIRED_FLOOR: Partial<Record<keyof ServerSettings['limits'], keyof ServerSettings['limits']>> = {
  usernameMax: 'usernameMin',
  passwordMax: 'passwordMin',
};

export const MODES = ['auto', 'light', 'dark'];

export interface ServerPatch {
  themeIndex?: unknown;
  announcement?: unknown;
  announcementEnabled?: unknown;
  appTitleZh?: unknown;
  appTitleEn?: unknown;
  categories?: unknown;
  canRevise?: unknown;
  imageCount?: unknown;
  imageSizeMb?: unknown;
  videoCount?: unknown;
  videoSizeMb?: unknown;
  avatarSizeMb?: unknown;
  avatarFormats?: unknown;
  imageFormats?: unknown;
  videoFormats?: unknown;
  storageMb?: unknown;
  whenFull?: unknown;
  exhibitionTitle?: unknown;
  exhibitionVenue?: unknown;
  category?: unknown;
  fieldTitle?: unknown;
  textFill?: unknown;
  radioOption?: unknown;
  checkOption?: unknown;
  usernameMin?: unknown;
  usernameMax?: unknown;
  passwordMin?: unknown;
  passwordMax?: unknown;
  nickname?: unknown;
  bio?: unknown;
  region?: unknown;
  answer?: unknown;
  defaultCover?: unknown;
  maxFutureExhibitions?: unknown;
  maxFutureMeetings?: unknown;
}

interface SettingRow {
  key: string;
  value: unknown;
}

interface UiModeRow {
  ui_mode: string;
}

interface UiThemeRow {
  ui_theme: number | null;
}

interface NotificationRow {
  exhibition_reminder: boolean;
  registration_updates: boolean;
}

/** 色值必须是 `#RRGGBB`：前端 `applyTheme()` 直接把它写进 CSS 变量。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 归一化配色：保证 `theme.colors` 永远是当前的默认色板。
 *
 * 数据库里的 `theme` 那一项可能是**旧版本**写入的：色板只有 4 项（甚至被手工改成了
 * 非法值、重复值）。`theme.colors` 不是可以「缺项补默认」的段（读取时整段覆盖），
 * 若原样下发，前端配色面板就永远比后端少几个色块，而且 `themeIndex` 的夹取会按一个
 * 更短的范围收敛 —— 同一份代码在老库和新库上行为不一致。
 *
 * 规则：保留库里**合法且不重复**的颜色（顺序不变），再按默认色板顺序补上缺的颜色，
 * 补不满（或库里的值全部非法）时退回默认色板。下标语义因此与默认色板一致。
 */
export function normalizeThemeColors(colors: unknown): string[] {
  const stored: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(colors)) {
    for (const item of colors) {
      const color = typeof item === 'string' ? item.trim() : '';
      // 大小写不敏感地去重：`#c05621` 与 `#C05621` 是同一个色，留两个只会白占一格色板。
      // 超长（被手工改成多于默认色板）时只取前 N 个，保证下发长度与 index 的取值范围一致。
      if (stored.length >= DEFAULT_SETTINGS.theme.colors.length) {
        break;
      }
      if (COLOR_PATTERN.test(color) && !seen.has(color.toLowerCase())) {
        seen.add(color.toLowerCase());
        stored.push(color);
      }
    }
  }
  if (stored.length === 0) {
    return [...DEFAULT_SETTINGS.theme.colors];
  }
  for (const color of DEFAULT_SETTINGS.theme.colors) {
    if (stored.length >= DEFAULT_SETTINGS.theme.colors.length) {
      break;
    }
    if (!seen.has(color.toLowerCase())) {
      seen.add(color.toLowerCase());
      stored.push(color);
    }
  }
  return stored;
}

/**
 * 归一化整段配色：色板补齐到默认色板，`index` 按**补齐后**的长度夹取。
 * 读取（老库）与保存（管理端提交）都过这里，两边的合法范围因此永远一致。
 */
export function normalizeTheme(
  theme: { index?: unknown; colors?: unknown } | null | undefined,
): ServerSettings['theme'] {
  const colors = normalizeThemeColors(theme?.colors);
  const index = clampInt(theme?.index, 0, [0, Math.max(0, colors.length - 1)]);
  return { index, colors };
}

function clampInt(value: unknown, fallback: number, [min, max]: [number, number]): number {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
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
 *
 * `theme.colors` 同理要补齐：老库存的是 4 色色板（见 `normalizeThemeColors`）。
 */
export async function readServerSettings(): Promise<ServerSettings> {
  const result = await query<SettingRow>('SELECT key, value FROM app_settings');
  const settings = clone(DEFAULT_SETTINGS);
  for (const row of result.rows) {
    if (Object.prototype.hasOwnProperty.call(settings, row.key)) {
      (settings as unknown as Record<string, unknown>)[row.key] = row.value;
    }
  }
  settings.media = { ...DEFAULT_SETTINGS.media, ...settings.media };
  settings.upload = { ...DEFAULT_SETTINGS.upload, ...settings.upload };
  // 老库存的 exhibitor 只有展会额度。新键按默认值补上，避免读出来是 undefined。
  settings.exhibitor = { ...DEFAULT_SETTINGS.exhibitor, ...settings.exhibitor };
  // 老库的 limits JSON 没有文本填写和选项上限。缺的键用默认值补上，避免读出来是 undefined。
  const storedLimits = settings.limits;
  settings.limits = {
    ...DEFAULT_SETTINGS.limits,
    ...(storedLimits && typeof storedLimits === 'object' ? storedLimits : {}),
  };
  settings.theme = normalizeTheme(settings.theme);
  return settings;
}

/** 取一项设置（例如 limits）。 */
export async function readSection<K extends keyof ServerSettings>(key: K): Promise<ServerSettings[K]> {
  const settings = await readServerSettings();
  return settings[key];
}

/**
 * 把前端（管理-设置 / 个人页）提交的**扁平**字段合并进服务器设置。
 * 只处理出现过的键，因此保存配色不会把别的设置改回默认值。
 */
export function applyServerPatch(current: ServerSettings, patch: ServerPatch | null | undefined): ServerSettings {
  const next = clone(current);
  const source = patch || {};

  // 色板先归一化再夹取 index：老库（4 色）与手改过的色板都按补齐后的长度收敛，
  // 否则同一段代码在两次读取之间会给出不同的合法范围。
  next.theme = normalizeTheme(next.theme);
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
  if (['avatarSizeMb', 'avatarFormats', 'imageFormats', 'videoFormats', 'storageMb', 'whenFull'].some((key) => key in source)) {
    // 老库的 upload JSON 里还没有 avatarFormats / storageMb：以默认值为底再盖库里的键。
    const fallback = { ...DEFAULT_SETTINGS.upload, ...next.upload };
    next.upload = {
      avatarSizeMb: clampNumber(source.avatarSizeMb, fallback.avatarSizeMb, 1, 20),
      avatarFormats: avatarFormatList(source.avatarFormats, fallback.avatarFormats),
      imageFormats: formatList(source.imageFormats, fallback.imageFormats),
      videoFormats: formatList(source.videoFormats, fallback.videoFormats),
      storageMb: clampNumber(source.storageMb, fallback.storageMb, 64, 10240),
      whenFull: normalizeWhenFull(source.whenFull, fallback.whenFull),
    };
  }
  // 字符数上限：逐项收敛，成对的上下限再互相约束一次。
  // 当前设置可能来自加键之前的库，先用默认值补齐再按提交覆盖。
  const limits = { ...DEFAULT_SETTINGS.limits, ...next.limits };
  for (const [key, bounds] of Object.entries(LIMIT_BOUNDS) as [keyof ServerSettings['limits'], [number, number]][]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      limits[key] = clampInt(source[key], limits[key], bounds);
    }
  }
  for (const [upper, lower] of Object.entries(PAIRED_FLOOR) as [
    keyof ServerSettings['limits'],
    keyof ServerSettings['limits'],
  ][]) {
    limits[upper] = Math.max(limits[upper], limits[lower]);
  }
  next.limits = limits;

  if (Object.prototype.hasOwnProperty.call(source, 'defaultCover')) {
    // 存的是媒体短 URL（与展会封面同一种值），这里只做长度与协议的形状校验：
    // 具体怎么存、能否访问由原生 / 部署方的媒体服务负责，后端不解析图片。
    const cover = String(source.defaultCover ?? '')
      .trim()
      .slice(0, 500);
    if (cover && !/^(https?:)?\/\//.test(cover) && !cover.startsWith('data:image/')) {
      throw badRequest('缺省封面需要是一个可访问的图片地址');
    }
    next.cover = { defaultCover: cover };
  }
  if (Object.prototype.hasOwnProperty.call(source, 'maxFutureExhibitions')) {
    // 0 表示不限；上限 100 是防呆（管理端填错位数不至于把展商全锁死）。
    next.exhibitor = {
      ...next.exhibitor,
      maxFutureExhibitions: clampInt(source.maxFutureExhibitions, next.exhibitor.maxFutureExhibitions, [0, 100]),
    };
  }
  if (Object.prototype.hasOwnProperty.call(source, 'maxFutureMeetings')) {
    next.exhibitor = {
      ...next.exhibitor,
      maxFutureMeetings: clampInt(source.maxFutureMeetings, next.exhibitor.maxFutureMeetings, [0, 100]),
    };
  }

  return next;
}

const AVATAR_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/**
 * 头像格式只接受裁剪画布能导出的四种后缀。
 *
 * 空值沿用原来的列表。提交了内容但含有不支持的后缀时直接拒绝，
 * 避免管理员以为 gif 已生效、上传时才失败。
 */
export function avatarFormatList(value: unknown, fallback: string[]): string[] {
  const base = fallback.length > 0 ? fallback : ['jpg', 'jpeg', 'png', 'webp'];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return base;
  const parsed = formatList(value, []);
  if (parsed.length === 0) return base;
  if (parsed.some((item) => !AVATAR_EXTENSIONS.has(item))) {
    throw badRequest('头像格式只支持 jpg、jpeg、png、webp');
  }
  return parsed;
}

/** 「jpg,png」或数组都接受，返回去重后的小写数组。 */
export function formatList(value: unknown, fallback: string[]): string[] {
  const items = Array.isArray(value) ? value : String(value === undefined ? '' : value).split(',');
  const formats: string[] = [];
  for (const item of items) {
    const format = String(item).trim().toLowerCase().replace(/^\./, '');
    if (format && /^[a-z0-9]{1,10}$/.test(format) && !formats.includes(format)) {
      formats.push(format);
    }
  }
  return formats.length > 0 ? formats : fallback;
}

/** 落库：只写值发生变化的段。 */
export async function saveServerSettings(current: ServerSettings, next: ServerSettings): Promise<ServerSettings> {
  for (const key of Object.keys(next) as (keyof ServerSettings)[]) {
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
export async function readUiMode(userId: string | null | undefined, serverSettings?: ServerSettings): Promise<string> {
  if (userId) {
    const result = await query<UiModeRow>('SELECT ui_mode FROM users WHERE id = $1', [userId]);
    const mode = result.rows[0]?.ui_mode;
    if (result.rows.length > 0 && mode && MODES.includes(mode)) {
      return mode;
    }
  }
  const mode = serverSettings?.ui?.mode;
  return mode && MODES.includes(mode) ? mode : 'auto';
}

/** 保存个人外观模式：只写调用者自己的 `users.ui_mode`。 */
export async function saveUiMode(userId: string | null | undefined, mode: unknown): Promise<string> {
  if (!userId) {
    // 没有 userId 就写不了「个人」偏好；以前这里会退回写全局 app_settings.ui，
    // 于是匿名请求能改掉所有用户的默认外观，现在直接拒绝。
    throw badRequest('请先登录后再保存外观模式');
  }
  const next = typeof mode === 'string' && MODES.includes(mode) ? mode : 'auto';
  await query('UPDATE users SET ui_mode = $2, updated_at = now() WHERE id = $1', [userId, next]);
  return next;
}

/**
 * 个人配色下标：登录用户读自己的 `users.ui_theme`，没选过（NULL）或未登录时用
 * 服务器默认值 `app_settings.theme.index`。
 *
 * 下标按**补齐后**的色板长度收敛：色板缩短过或库里的值被手工改大时，
 * 个人偏好也不该把前端推到 undefined 的颜色上。
 *
 * 收敛只发生在**读取**这一侧（`clampInt`），不会顺手把夹过的值写回库：
 * `saveServerSettings()` 只写 `app_settings`，`users.ui_theme` 只在用户自己提交时改写，
 * 因此这里不能悄悄产生一次写操作。
 */
export async function readUiTheme(
  userId: string | null | undefined,
  fallbackIndex: number,
  colors: readonly string[] = DEFAULT_SETTINGS.theme.colors,
): Promise<number> {
  const [min, max] = [0, Math.max(0, colors.length - 1)];
  const fallback = clampInt(fallbackIndex, 0, [min, max]);
  if (!userId) {
    return fallback;
  }
  const result = await query<UiThemeRow>('SELECT ui_theme FROM users WHERE id = $1', [userId]);
  const stored = result.rows[0]?.ui_theme;
  if (stored === null || stored === undefined) {
    return fallback;
  }
  return clampInt(stored, fallback, [min, max]);
}

/**
 * 保存个人配色：只写调用者自己的 `users.ui_theme`。
 *
 * 与外观模式不同，这里**不静默回落**：配色是枚举色板上的选择，提交一个越界或非数字的
 * 下标说明请求本身有问题，夹取到边界会把「点错了」伪装成「保存成功」。
 * 越界按规则失败（200 + `ok:false`）返回，合法值写库后原样返回。
 */
export async function saveUiTheme(
  userId: string | null | undefined,
  themeIndex: unknown,
  colors: readonly string[] = DEFAULT_SETTINGS.theme.colors,
): Promise<number> {
  if (!userId) {
    // 与外观模式同一条边界：没有 userId 就写不了个人偏好，更不能退回改全局默认。
    throw badRequest('请先登录后再保存配色');
  }
  const max = Math.max(0, colors.length - 1);
  const index = themeIndexToIndex(themeIndex);
  // 越界与非整数都拒绝：**不夹取**。配色是色板上的枚举选择，把 99 夹成 7 会把
  // 「点错了 / 前端传错字段」伪装成「保存成功」。
  if (index === null || index < 0 || index > max) {
    throw badRequest(`配色下标必须是 0 到 ${max} 之间的整数`);
  }
  await query('UPDATE users SET ui_theme = $2, updated_at = now() WHERE id = $1', [userId, index]);
  return index;
}

/**
 * 把请求里的配色下标严格解析成整数，解析不出来返回 `null`。
 *
 * 不用 `Number()`：`Number('')` 与 `Number(null)` 都是 0，会把「空字符串」和「没提交」
 * 静默当成第 0 号色板保存；也不接受 `1.5`、`'2abc'` 这类能靠 parseInt 蒙混过关的值。
 * 负数原样返回，由调用方按「越界」拒绝。
 */
function themeIndexToIndex(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

/** 通知偏好：没有记录时返回默认值并顺手建一行。 */
export async function readNotificationPreferences(userId: string | null | undefined): Promise<{
  exhibitionReminder: boolean;
  registrationUpdates: boolean;
  granted: boolean;
}> {
  if (!userId) {
    return { exhibitionReminder: true, registrationUpdates: true, granted: true };
  }
  const result = await query<NotificationRow>(
    'SELECT exhibition_reminder, registration_updates FROM notification_preferences WHERE user_id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    await query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    return { exhibitionReminder: true, registrationUpdates: true, granted: true };
  }
  return {
    exhibitionReminder: row.exhibition_reminder,
    registrationUpdates: row.registration_updates,
    granted: true,
  };
}

/** 保存通知偏好（部分字段也可以）。 */
export async function saveNotificationPreferences(
  userId: string | null | undefined,
  patch: { exhibitionReminder?: unknown; registrationUpdates?: unknown } | null | undefined,
): Promise<{ exhibitionReminder: boolean; registrationUpdates: boolean }> {
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
export function normalizeUserStatus(value: unknown): string {
  const status = toUserStatus(value);
  if (!status) {
    throw badRequest('账号状态只能是 正常 / 受限 / 封禁');
  }
  return status;
}

/**
 * 一次性提示的 key 形状。
 *
 * 只允许小写字母、数字与短横线：它同时是数据库里存的值与前端的调用参数，
 * 放开任意字符等于给用户对象塞进一段可以任意增长的自由文本。
 */
const HINT_KEY = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** 一个人最多记多少条已读提示：key 是受控的短码，留个上限避免无限增长。 */
const HINT_LIMIT = 50;

/**
 * 记下一条「看过的提示」并返回最新列表。
 *
 * 幂等（重复提交同一条不报错，列表也不重复）；只写调用者自己那一行。
 */
export async function saveSeenHint(userId: string | null | undefined, hint: unknown): Promise<string[]> {
  if (!userId) throw badRequest('请先登录后再记录提示状态');
  const key = String(hint ?? '').trim();
  if (!HINT_KEY.test(key)) throw badRequest('提示标识不合法');
  // 在 UPDATE 持有行锁时合并，等待中的请求会基于最新值追加，不覆盖另一设备刚确认的提示。
  const result = await query<{ seen_hints: string[] }>(
    `UPDATE users SET
       seen_hints = CASE WHEN $2 = ANY(seen_hints) THEN seen_hints
         ELSE (array_append(seen_hints, $2))[GREATEST(1, cardinality(seen_hints) + 2 - $3):]
         END,
       updated_at = CASE WHEN $2 = ANY(seen_hints) THEN updated_at ELSE now() END
     WHERE id = $1 RETURNING seen_hints`,
    [userId, key, HINT_LIMIT],
  );
  return result.rows[0]?.seen_hints ?? [];
}
