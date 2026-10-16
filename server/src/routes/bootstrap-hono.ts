import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { readServerSettings, readUiMode, readUiTheme } from '../domain/settings.js';
import { USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { userPayload, guestPayload, type UserRow } from '../domain/payloads.js';
import { capabilities } from '../domain/permissions.js';
import { jsonResponse } from '../http/respond.js';
import { langPacks, privacyPolicyUrl, publicBaseUrl } from '../config/runtime.js';
import { optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();

interface LandingMonthRow {
  year: number;
  month: number;
}

async function landingMonth() {
  const result = await query<LandingMonthRow>(`
    SELECT EXTRACT(YEAR FROM exhibition_date)::int AS year,
           EXTRACT(MONTH FROM exhibition_date)::int AS month
    FROM exhibitions ORDER BY exhibition_date LIMIT 1
  `);
  const row = result.rows[0];
  if (row) return { year: row.year, month: row.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

app.get('/bootstrap', optionalAuthHono, async (c) => {
  const userOfRequest = userOf(c);
  const settings = await readServerSettings();
  const mode = await readUiMode(userOfRequest?.userId, settings);
  // 配色下标是**该用户实际生效**的那个：登录账号选过就用自己那份（`users.ui_theme`），
  // 没选过或未登录时用全局默认 `app_settings.theme.index`。
  // 前端因此不用分支，直接按 `theme.colors[theme.index]` 取色。
  const themeIndex = await readUiTheme(userOfRequest?.userId, settings.theme.index, settings.theme.colors);
  let user = guestPayload();
  if (userOfRequest) {
    const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [userOfRequest.userId]);
    const row = result.rows[0];
    if (row) user = userPayload(row, capabilities(row.role, row.status ?? undefined));
  }
  return jsonResponse(c, {
    user,
    theme: { index: themeIndex, colors: settings.theme.colors },
    ui: { mode },
    capabilities: { ...settings.capabilities },
    categories: settings.categories,
    review: settings.review,
    media: settings.media,
    announcement: settings.announcement,
    brand: settings.brand,
    limits: settings.limits,
    server: {
      avatarFormats: settings.upload.avatarFormats,
      avatarSizeMb: settings.upload.avatarSizeMb,
      imageFormats: settings.upload.imageFormats,
      videoFormats: settings.upload.videoFormats,
    },
    // 缺省展会封面（展会自己没有封面时用它兜底）与展商端的「可同时筹备的展会数」上限：
    // 前者给列表 / 详情做兜底图，后者给展商表单做提示与前端预校验。
    cover: settings.cover,
    exhibitor: settings.exhibitor,
    calendar: { available: false, landing: await landingMonth() },
    // 报名站的规范来源。空串表示没配，客户端不得自行编造 127.0.0.1 链接。
    publicBaseUrl,
    privacyPolicyUrl,
    // 默认语言包名称和下载列表。正文在客户端本机，这里不下发。
    lang: langPacks,
  });
});

export function createBootstrapRoutes() {
  return app;
}
export const BOOTSTRAP_ENDPOINTS: readonly [string, string][] = [['GET', '/bootstrap']];
