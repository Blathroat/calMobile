import { Hono } from 'hono';
import { authenticateHono, optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';
import { requireAdmin, requireUser } from '../domain/permissions.js';
import {
  applyServerPatch,
  readNotificationPreferences,
  readServerSettings,
  readUiMode,
  saveNotificationPreferences,
  saveServerSettings,
  saveUiMode,
} from '../domain/settings.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';

const app = new Hono<HonoEnv>();
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function has(body: object | null | undefined, key: string) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}
async function settingsPayload(userId: string | null | undefined) {
  const settings = await readServerSettings();
  return {
    theme: settings.theme,
    ui: { mode: await readUiMode(userId, settings) },
    announcement: settings.announcement,
    brand: settings.brand,
    categories: settings.categories,
    review: settings.review,
    media: settings.media,
    upload: settings.upload,
    limits: settings.limits,
    notify: await readNotificationPreferences(userId),
  };
}
app.get('/', optionalAuthHono, async (c) => jsonResponse(c, await settingsPayload(userOf(c)?.userId)));
app.put('/', authenticateHono, async (c) => {
  const user = requireAdmin({ user: userOf(c) });
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const current = await readServerSettings();
    const next = applyServerPatch(current, body);
    await saveServerSettings(current, next);
    if (has(body, 'notify')) await saveNotificationPreferences(user.userId, body.notify as Record<string, unknown>);
    return { settings: await settingsPayload(user.userId) };
  });
});
app.put('/ui-mode', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => ({
    mode: await saveUiMode(user.userId, String(body.mode === undefined ? '' : body.mode)),
  }));
});
export function createSettingsRoutes() {
  return app;
}
export const SETTINGS_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['PUT', '/'],
  ['PUT', '/ui-mode'],
];
