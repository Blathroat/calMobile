/**
 * 公开的客户端更新信息。
 *
 * 网页端「检查更新」与报名站的下载条读同一份：管理端只配下载源，
 * 服务端把最新版本、更新日志与下载地址解析好（GitHub Release 有 5 分钟缓存）。
 * 不需要登录，也不缓存响应（Cache-Control: no-store，见 jsonResponse）。
 */

import { Hono } from 'hono';
import { readServerSettings } from '../domain/settings.js';
import { resolveRelease } from '../services/release.js';
import { jsonResponse } from '../http/respond.js';
import type { HonoEnv } from './hono-utils.js';

const app = new Hono<HonoEnv>();

app.get('/app/release', async (c) => {
  const settings = await readServerSettings();
  const release = await resolveRelease(settings);
  return jsonResponse(c, { ok: true, ...release });
});

export function createAppRoutes() {
  return app;
}

export const APP_ENDPOINTS: readonly [string, string][] = [['GET', '/app/release']];
