/**
 * 尚未迁移到 Hono 的 Express 路由注册表。
 *
 * 单独成模块的理由是**打破循环依赖**：`index.ts` 装载全部路由器，而 `routes/status.ts`
 * 的接口清单又要反过来遍历这张表。历史上那里用「延迟 require 入口」绕开半成品 exports，
 * ESM 下延迟 require 无处安放，于是把注册表本身独立出来 —— `index.ts` 负责挂载，
 * `status.ts` 只读这张表，谁都不依赖谁。
 *
 * 认证路由已由 `auth-hono.ts` 自己注册并导出清单；这里登记其余 Express 承接路由。
 *
 * 约定：新承接接口同时登记到这里、`api.js` 的 `ENDPOINTS`、`server/src/test/api.test.ts`
 * （那里交叉校验前后端路由）；Hono 路由在自己的模块导出清单，状态接口没有对应的前端动作，
 * **不进来**（理由见 index.ts）。
 */

import type { Router } from 'express';
import bootstrapRoutes from './bootstrap.js';
import profileRoutes from './profile.js';
import exhibitionRoutes from './exhibitions.js';
import registrationRoutes from './registrations.js';
import reviewRoutes from './review.js';
import checkinRoutes from './checkin.js';
import userRoutes from './users.js';
import searchRoutes from './search.js';
import settingsRoutes from './settings.js';

export const routes: Record<string, Router> = {
  '': bootstrapRoutes,
  profile: profileRoutes,
  exhibitions: exhibitionRoutes,
  registrations: registrationRoutes,
  review: reviewRoutes,
  checkin: checkinRoutes,
  users: userRoutes,
  search: searchRoutes,
  settings: settingsRoutes,
};
