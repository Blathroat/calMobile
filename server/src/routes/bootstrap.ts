/**
 * 启动聚合接口：一次把页面首帧需要的全部配置发下去。
 *
 * 字段与前端 `core/bridge.js` 的 `applyBootstrap` 一一对应，缺一个页面就会渲染异常
 * （契约测试逐项断言）。这里不返回通知偏好——它在「设置」接口里，
 * 与 `profile.js` 的通知偏好分工保持一致。
 */

import express = require('express');
import { query } from '../config/pool';
import { optionalAuth } from '../middleware/auth';
import { readServerSettings, readUiMode } from '../domain/settings';
import { USER_COLUMNS, USER_FROM } from '../domain/queries';
import { userPayload, guestPayload, type UserRow } from '../domain/payloads';
import { capabilities } from '../domain/permissions';

const router = express.Router();

interface LandingMonthRow {
  year: number;
  month: number;
}

/** 首页日历的落点月份：最早一个有展会的月份；没有展会时用当前月。 */
async function landingMonth() {
  const result = await query<LandingMonthRow>(`
        SELECT EXTRACT(YEAR FROM exhibition_date)::int  AS year,
               EXTRACT(MONTH FROM exhibition_date)::int AS month
        FROM exhibitions
        ORDER BY exhibition_date
        LIMIT 1
    `);
  if (result.rows.length > 0) {
    const row = result.rows[0];
    if (row) {
      return { year: row.year, month: row.month };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** GET /api/v1/bootstrap */
router.get('/bootstrap', optionalAuth, async (req, res, next) => {
  try {
    const settings = await readServerSettings();
    const mode = await readUiMode(req.user?.userId, settings);

    let user = guestPayload();
    if (req.user) {
      const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [req.user.userId]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        if (row) {
          user = userPayload(row, capabilities(row.role, row.status ?? undefined));
        }
      }
    }

    res.json({
      user,
      theme: settings.theme,
      ui: { mode },
      // 系统日历、通知权限属于设备能力：HTTP 后端只知道服务器侧的状态，
      // 具体是否可用由前端通过系统动作（`calendar.status` / 通知权限）确认。
      capabilities: { ...settings.capabilities },
      categories: settings.categories,
      review: settings.review,
      media: settings.media,
      announcement: settings.announcement,
      brand: settings.brand,
      limits: settings.limits,
      server: settings.upload,
      calendar: { available: false, landing: await landingMonth() },
    });
  } catch (error: unknown) {
    next(error);
  }
});

export = router;
