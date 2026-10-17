import { Hono } from 'hono';
import { authenticateHono, optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';
import { requireAdmin, requireUser } from '../domain/permissions.js';
import {
  applyServerPatch,
  readNotificationPreferences,
  readServerSettings,
  readUiMode,
  readUiTheme,
  saveNotificationPreferences,
  saveServerSettings,
  saveUiMode,
  saveUiTheme,
} from '../domain/settings.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { forgetTexts, storageReport } from '../services/media-gc.js';
import { readJsonBody } from '../http/body-limit.js';
import { parseSchema } from '../domain/validation.js';
import { notifySchema, serverSettingsPatchSchema, uiModeSchema, uiThemeSchema } from '../domain/schemas.js';
import { createInvite, deleteInvite, listInvites } from '../domain/invites.js';

const app = new Hono<HonoEnv>();
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function has(body: object | null | undefined, key: string) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}
async function settingsPayload(userId: string | null | undefined, role?: string | null) {
  const settings = await readServerSettings();
  const storage = role === 'admin' ? await storageReport() : undefined;
  const invites = role === 'admin' ? await listInvites() : undefined;
  // `theme.index` 下发的是**调用者实际生效**的下标（个人选择优先于全局默认）：
  // 页面据此画选中环，不必自己判断「我有没有单独选过配色」。
  const themeIndex = await readUiTheme(userId, settings.theme.index, settings.theme.colors);
  return {
    theme: { index: themeIndex, colors: settings.theme.colors },
    ui: { mode: await readUiMode(userId, settings) },
    announcement: settings.announcement,
    brand: settings.brand,
    categories: settings.categories,
    review: settings.review,
    media: settings.media,
    upload: settings.upload,
    limits: settings.limits,
    cover: settings.cover,
    exhibitor: settings.exhibitor,
    invite: settings.invite,
    notify: await readNotificationPreferences(userId),
    ...(storage ? { storage } : {}),
    ...(invites ? { invites } : {}),
  };
}
app.get('/', optionalAuthHono, async (c) => {
  const user = userOf(c);
  return jsonResponse(c, await settingsPayload(user?.userId, user?.role));
});
app.put('/', authenticateHono, async (c) => {
  const user = requireAdmin({ user: userOf(c) });
  const rawBody = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const body = parseSchema(serverSettingsPatchSchema, rawBody);
    const current = await readServerSettings();
    const next = applyServerPatch(current, body);
    await saveServerSettings(current, next);
    if (current.cover.defaultCover !== next.cover.defaultCover) {
      await forgetTexts([current.cover.defaultCover]).catch(() => {
        console.error('清理未引用媒体失败');
      });
    }
    if (has(body, 'notify')) await saveNotificationPreferences(user.userId, parseSchema(notifySchema, body.notify));
    return { settings: await settingsPayload(user.userId, user.role) };
  });
});
app.post('/invites', authenticateHono, async (c) => {
  const user = requireAdmin({ user: userOf(c) });
  const rawBody = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const current = await readServerSettings();
    const next = applyServerPatch(current, {
      inviteUses: rawBody.uses,
      inviteValidHours: rawBody.validHours,
    });
    await saveServerSettings(current, next);
    await createInvite(user.userId, next.invite.uses, next.invite.validHours);
    return { invites: await listInvites(), settings: await settingsPayload(user.userId, user.role) };
  });
});
app.delete('/invites/:id', authenticateHono, async (c) => {
  requireAdmin({ user: userOf(c) });
  return mutate(c, async () => ({ invites: await deleteInvite(c.req.param('id')) }));
});
app.put('/ui-mode', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const body = parseSchema(uiModeSchema, bodyRecord(await readJsonBody(c)));
  return mutate(c, async () => ({
    mode: await saveUiMode(user.userId, body.mode),
  }));
});
// 个人配色：与 `/ui-mode` 对称，只写调用者自己的 users.ui_theme。
// 「管理-设置」里改的是全局默认 `app_settings.theme.index`，两者互不覆盖。
app.put('/ui-theme', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const body = parseSchema(uiThemeSchema, bodyRecord(await readJsonBody(c)));
  return mutate(c, async () => {
    const settings = await readServerSettings();
    return { themeIndex: await saveUiTheme(user.userId, body.themeIndex, settings.theme.colors) };
  });
});
export function createSettingsRoutes() {
  return app;
}
export const SETTINGS_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['PUT', '/'],
  ['POST', '/invites'],
  ['DELETE', '/invites/:id'],
  ['PUT', '/ui-mode'],
  ['PUT', '/ui-theme'],
];
