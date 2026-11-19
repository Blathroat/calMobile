import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { readServerSettings, readUiMode, readUiTheme } from '../domain/settings.js';
import { USER_COLUMNS, USER_FROM } from '../domain/queries.js';
import { userPayload, guestPayload, type UserRow } from '../domain/payloads.js';
import { capabilities } from '../domain/permissions.js';
import { jsonResponse } from '../http/respond.js';
import { resolveRelease } from '../services/release.js';
import { langPacks, privacyPolicyUrl, publicBaseUrl } from '../config/runtime.js';
import { clientBranding, type BrandingConfig } from '../config/branding.js';
import { optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';

interface LandingMonthRow {
  year: number;
  month: number;
}

/**
 * 启动数据里的下载摘要：只有 source / version / url。
 *
 * resolveRelease 自己把失败收成空地址（不会抛 5xx），这里再兜一层，
 * 让「GitHub 挂了」不影响整个启动数据。
 */
async function releaseDownload(settings: Awaited<ReturnType<typeof readServerSettings>>) {
  try {
    const release = await resolveRelease(settings);
    return { source: release.source, version: release.version, url: release.url };
  } catch {
    return { source: 'url', version: '', url: '' };
  }
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

export function createBootstrapRoutes(options: { branding?: BrandingConfig } = {}) {
  const app = new Hono<HonoEnv>();
  const branding = options.branding ? clientBranding(options.branding) : {};

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
      const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [
        userOfRequest.userId,
      ]);
      const row = result.rows[0];
      if (row) user = userPayload(row, capabilities(row.role, row.status ?? undefined));
    }
    return jsonResponse(c, {
      user,
      theme: { index: themeIndex, colors: settings.theme.colors, accentColor: settings.theme.accentColor },
      ui: { mode },
      capabilities: { ...settings.capabilities },
      categories: settings.categories,
      review: settings.review,
      // 匿名报名姓名同义词：报名站据此决定是否把收集项当姓名、隐藏额外的姓名表单。
      // 空数组表示不合并（始终显示单独姓名表）。
      registration: settings.registration,
      media: settings.media,
      announcement: settings.announcement,
      brand: settings.brand,
      // 运行时品牌：页面标题、PWA 名称/描述来自服务器环境；空对象表示全用构建期默认值。
      branding,
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
      // 最新版本的下载地址：报名站（系统浏览器打开时）据此决定要不要显示下载条。
      // 与 GET /app/release 读同一份缓存；解析失败时给空地址，启动数据本身不失败。
      download: await releaseDownload(settings),
      calendar: { available: false, landing: await landingMonth() },
      // 报名站的规范来源。空串表示没配，客户端不得自行编造 127.0.0.1 链接。
      publicBaseUrl,
      privacyPolicyUrl,
      // 用户协议：只下发开关与版本（登录/注册页据此决定是否展示勾选）；
      // 正文走公开的 GET /agreement，避免每次启动都下载一遍全文。
      agreement: {
        enabled: settings.agreement.enabled,
        version: settings.agreement.version,
        updatedAt: settings.agreement.updatedAt,
      },
      // 默认语言包名称和下载列表。正文在客户端本机，这里不下发。
      lang: langPacks,
    });
  });

  return app;
}

export const BOOTSTRAP_ENDPOINTS: readonly [string, string][] = [['GET', '/bootstrap']];
