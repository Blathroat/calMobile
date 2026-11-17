import { Hono } from 'hono';
import { readServerSettings } from '../domain/settings.js';
import { jsonResponse } from '../http/respond.js';
import type { HonoEnv } from './hono-utils.js';

/**
 * 用户协议（公开读取）。
 *
 * 登录与注册页在**未登录**时也要能展示协议勾选与蓝链，协议浏览页也可能在登录前打开，
 * 所以这段接口不要认证。正文是 Markdown 原文，由前端清洗后渲染；关闭时也照样返回，
 * 页面按 `enabled` 决定是否展示（直接访问协议页时给出「暂未开启」说明）。
 */
const app = new Hono<HonoEnv>();

app.get('/agreement', async (c) => {
  const settings = await readServerSettings();
  return jsonResponse(c, {
    enabled: settings.agreement.enabled,
    version: settings.agreement.version,
    updatedAt: settings.agreement.updatedAt,
    content: settings.agreement.content,
  });
});

export function createAgreementRoutes() {
  return app;
}
export const AGREEMENT_ENDPOINTS: readonly [string, string][] = [['GET', '/agreement']];
