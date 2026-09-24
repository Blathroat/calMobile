/**
 * Express 路由注册表。
 *
 * 单独成模块的理由是**打破循环依赖**：`index.ts` 装载全部路由器，而 `routes/status.ts`
 * 的接口清单又要反过来遍历这张表。历史上那里用「延迟 require 入口」绕开半成品 exports，
 * ESM 下延迟 require 无处安放，于是把注册表本身独立出来 —— `index.ts` 负责挂载，
 * `status.ts` 只读这张表，谁都不依赖谁。
 *
 * 业务路由已由各自的 Hono 模块注册并导出清单；当前表为空，保留这个模块供状态页与
 * 迁移期间的 Express 路由使用。
 *
 * 约定：Express 承接接口同时登记到这里、`api.js` 的 `ENDPOINTS`、`server/src/test/api.test.ts`
 * （那里交叉校验前后端路由）；Hono 路由在自己的模块导出清单，状态接口没有对应的前端动作，
 * **不进来**（理由见 index.ts）。
 */

import type { Router } from 'express';

export const routes: Record<string, Router> = {};
