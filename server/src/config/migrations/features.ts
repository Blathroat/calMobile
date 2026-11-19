/**
 * 迁移步骤 0020-0028：配色首色、多天展会、匿名报名查询、登录地区、用户协议、
 * 操作日志、报名注意事项与参加时间段。
 *
 * 步骤按 id 从小到大排列；id、顺序、SQL 与注释都是已发布内容，不要改，新增步骤追加到末尾。
 */

import type { MigrationStep } from './types.js';

/** 本模块的迁移步骤。 */
export const STEPS: readonly MigrationStep[] = [
  {
    // 首色从「钢青 #41707E」担任，并允许管理设置下发色号覆盖；原焦糖橙移到 1。
    // 老用户的 `ui_theme` 下标整体平移：0→1、1→2 … 10→11、11→0（钢青留在 0）。
    id: '0020-theme-accent',
    sql: `
        UPDATE users
           SET ui_theme = CASE ui_theme
                 WHEN 11 THEN 0
                 WHEN 0 THEN 1
                 WHEN 1 THEN 2
                 WHEN 2 THEN 3
                 WHEN 3 THEN 4
                 WHEN 4 THEN 5
                 WHEN 5 THEN 6
                 WHEN 6 THEN 7
                 WHEN 7 THEN 8
                 WHEN 8 THEN 9
                 WHEN 9 THEN 10
                 WHEN 10 THEN 11
                 ELSE ui_theme
               END
         WHERE ui_theme IS NOT NULL;
        `,
  },
  {
    // 全局默认固定为 0（新首色），并写入可下发的首色字段。
    // 带 params 的迁移只能有一条 SQL：pg 的扩展协议不接受一次多条语句。
    id: '0021-theme-accent-default',
    sql: `
        UPDATE app_settings
           SET value = jsonb_set(
                 jsonb_set(
                   jsonb_set(value, '{colors}', $1::jsonb, true),
                   '{accentColor}', to_jsonb($2::text), true
                 ),
                 '{index}', '0'::jsonb, true
               )
         WHERE key = 'theme';
        `,
    params: (palette: readonly string[]) => [JSON.stringify(palette), palette[0] ?? ''],
  },
  {
    // 展会可以跨天办：闭展日期与开展日期分开存。NULL 表示单日展会（闭展日期 = 开展日期），
    // 老数据不用回填，读取时按开展日期兜底。页面校验要求它不早于开展日期。
    // `IF NOT EXISTS` 让这一步可以反复执行。
    id: '0022-exhibition-end-date',
    sql: `
        ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS exhibition_end_date DATE;
        `,
  },
  {
    // 报名站允许未登录直接报名：这类报名没有账号可查，提交后给一条只含随机凭据的查询链接。
    // 库里只存凭据的哈希（与刷新令牌、验证码一致），链接原文只在创建响应里返回一次；
    // 登录后认领（claim）时把 visitor_id 补上，报名就并入账号的「我的活动」。
    // 空串表示老记录与账号报名，不参与查询索引。
    id: '0023-registration-query-token',
    sql: `
        ALTER TABLE registrations ADD COLUMN IF NOT EXISTS query_token_hash TEXT NOT NULL DEFAULT '';
        CREATE UNIQUE INDEX IF NOT EXISTS registrations_query_token_idx
            ON registrations (query_token_hash)
            WHERE query_token_hash <> '';
        `,
  },
  {
    // 用户管理要显示「最近登录」的地区：登录时记下客户端 IP 与离线解析出的地区。
    // 只往下发地区，IP 原文留在库里当审计信息。`IF NOT EXISTS` 让这一步可以反复执行。
    id: '0024-user-last-login-region',
    sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_region TEXT NOT NULL DEFAULT '';
        -- 建号即登录：没有登录时间的老账号用注册时间兜底，用户管理不再显示「未知」。
        UPDATE users SET last_login_time = registration_time WHERE last_login_time IS NULL;
        `,
  },
  {
    // 用户协议同意状态：0 表示从未同意过任何版本；`agreed_terms_at` 是最后一次同意的时间。
    // 协议正文与版本在 `app_settings.agreement` 里，这里只记每个账号同意到哪一版。
    // `IF NOT EXISTS` 让这一步可以反复执行。
    id: '0025-user-agreement',
    sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS agreed_terms_version INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS agreed_terms_at TIMESTAMPTZ;
        `,
  },
  {
    // 操作日志：管理后台「最近日志」页的数据源。只追加、满了由服务端按大小上限清理最早的。
    // `size_bytes` 在写入时算好，清理时按累计大小找最早的那些行，不必每次重新序列化。
    // `actor_id` 不建外键：账号删除后日志仍要保留（显示当时的名字）。
    id: '0026-app-logs',
    sql: `
        CREATE TABLE IF NOT EXISTS app_logs (
            id          BIGSERIAL PRIMARY KEY,
            level       TEXT NOT NULL DEFAULT 'info',
            category    TEXT NOT NULL DEFAULT '',
            message     TEXT NOT NULL DEFAULT '',
            actor_id    TEXT NOT NULL DEFAULT '',
            actor_name  TEXT NOT NULL DEFAULT '',
            method      TEXT NOT NULL DEFAULT '',
            path        TEXT NOT NULL DEFAULT '',
            status      INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            ip          TEXT NOT NULL DEFAULT '',
            detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
            size_bytes  INTEGER NOT NULL DEFAULT 0,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS app_logs_created_idx ON app_logs (created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS app_logs_level_idx ON app_logs (level, created_at DESC);
        `,
  },
  {
    // 报名注意事项：审核通过 / 已参加的报名者在报名详情页看到这段正文。
    // 与展商公开信息（exhibitor_note）分开：后者是公开简介，这份只给通过审核的报名者。
    id: '0027-exhibition-registration-notice',
    sql: `
        ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS registration_notice TEXT NOT NULL DEFAULT '';
        `,
  },
  {
    // 报名参加时间段：多天展会报名时用户自己选的参加日期。NULL 表示没选（按整段展会处理），
    // 老数据不回填。用 ADD COLUMN IF NOT EXISTS 保持这一步可重复执行。
    id: '0028-registration-attendance',
    sql: `
        ALTER TABLE registrations ADD COLUMN IF NOT EXISTS attendance_start DATE;
        ALTER TABLE registrations ADD COLUMN IF NOT EXISTS attendance_end DATE;
        `,
  },
];
