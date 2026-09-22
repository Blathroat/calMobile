/**
 * 路由注册表：前端动作域 ↔ 后端路由器的唯一对照。
 *
 * 单独成模块的理由是**打破循环依赖**：`index.ts` 装载全部路由器，而 `routes/status.ts`
 * 的接口清单又要反过来遍历这张表。历史上那里用「延迟 require 入口」绕开半成品 exports，
 * ESM 下延迟 require 无处安放，于是把注册表本身独立出来 —— `index.ts` 负责挂载，
 * `status.ts` 只读这张表，谁都不依赖谁。
 *
 * 键名与前端 `js/core/api.js` 的 `ENDPOINTS` 域一一对应（见 README「前后端边界」）。
 *
 * 约定：新接口同时登记到这里、`api.js` 的 `ENDPOINTS`、`server/src/test/api.test.ts`
 * （那里交叉校验前后端路由）；状态接口没有对应的前端动作，**不进来**（理由见 index.ts）。
 */

import type { Router } from 'express';
import bootstrapRoutes from './bootstrap.js';
import authRoutes from './auth.js';
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
  auth: authRoutes,
  profile: profileRoutes,
  exhibitions: exhibitionRoutes,
  registrations: registrationRoutes,
  review: reviewRoutes,
  checkin: checkinRoutes,
  users: userRoutes,
  search: searchRoutes,
  settings: settingsRoutes,
};
