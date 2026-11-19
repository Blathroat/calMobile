/**
 * 迁移步骤 0001-0009：核心表、服务器设置、邮箱与两步验证的早期结构、配色与个人偏好。
 *
 * 步骤按 id 从小到大排列；id、顺序、SQL 与注释都是已发布内容，不要改，新增步骤追加到末尾。
 */

import type { MigrationStep } from './types.js';

/** 本模块的迁移步骤。 */
export const STEPS: readonly MigrationStep[] = [
  {
    id: '0001-core',
    sql: `
        CREATE TABLE IF NOT EXISTS users (
            id                  TEXT PRIMARY KEY,
            username            TEXT NOT NULL UNIQUE,
            password_hash       TEXT NOT NULL,
            email               TEXT NOT NULL DEFAULT '',
            nickname            TEXT NOT NULL,
            role                TEXT NOT NULL DEFAULT 'user'
                                CHECK (role IN ('user', 'exhibitor', 'admin')),
            status              TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'limited', 'banned')),
            bio                 TEXT NOT NULL DEFAULT '',
            region              TEXT NOT NULL DEFAULT '',
            avatar              TEXT NOT NULL DEFAULT '',
            social_media        TEXT NOT NULL DEFAULT '',
            show_registrations  BOOLEAN NOT NULL DEFAULT false,
            registration_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_login_time     TIMESTAMPTZ,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS exhibitions (
            id                  TEXT PRIMARY KEY,
            title               TEXT NOT NULL,
            venue               TEXT NOT NULL,
            time                TEXT NOT NULL,
            exhibition_date     DATE NOT NULL,
            status              TEXT NOT NULL DEFAULT 'review'
                                CHECK (status IN ('review', 'optional', 'display', 'closed', 'ended')),
            category            TEXT NOT NULL DEFAULT '',
            description         TEXT NOT NULL DEFAULT '',
            description_format  TEXT NOT NULL DEFAULT 'md'
                                CHECK (description_format IN ('html', 'md')),
            highlights          JSONB NOT NULL DEFAULT '[]'::jsonb,
            image_uri           TEXT NOT NULL DEFAULT '',
            exhibitor_note      TEXT NOT NULL DEFAULT '',
            registration_start  DATE,
            registration_end    DATE,
            qr_enabled          BOOLEAN NOT NULL DEFAULT false,
            exhibitor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS exhibitions_date_idx ON exhibitions (exhibition_date);
        CREATE INDEX IF NOT EXISTS exhibitions_exhibitor_idx ON exhibitions (exhibitor_id);

        CREATE TABLE IF NOT EXISTS registrations (
            id              TEXT PRIMARY KEY,
            exhibition_id   TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
            visitor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
            visitor_name    TEXT NOT NULL,
            visitor_type    TEXT NOT NULL DEFAULT '专业观众',
            answers         TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'attended')),
            check_in_time   TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS registrations_exhibition_idx ON registrations (exhibition_id);
        CREATE INDEX IF NOT EXISTS registrations_visitor_idx ON registrations (visitor_id);
        -- 同一场展会同一个人只允许一条未撤销的报名，报名窗口、重复报名由数据库兜底。
        CREATE UNIQUE INDEX IF NOT EXISTS registrations_unique_active_idx
            ON registrations (exhibition_id, visitor_id)
            WHERE visitor_id IS NOT NULL AND status <> 'cancelled';

        CREATE TABLE IF NOT EXISTS exhibition_fields (
            id              TEXT PRIMARY KEY,
            exhibition_id   TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
            title           TEXT NOT NULL,
            type            TEXT NOT NULL DEFAULT 'text'
                            CHECK (type IN ('text', 'radio', 'checkbox')),
            required        BOOLEAN NOT NULL DEFAULT false,
            options         JSONB NOT NULL DEFAULT '[]'::jsonb,
            position        INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS exhibition_fields_exhibition_idx
            ON exhibition_fields (exhibition_id, position);
        `,
  },
  {
    id: '0002-server-settings',
    sql: `
        -- 服务器级配置：一项一行，值是任意 JSON。键名与 settings.get / bootstrap 的字段一致。
        CREATE TABLE IF NOT EXISTS app_settings (
            key         TEXT PRIMARY KEY,
            value       JSONB NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS notification_preferences (
            user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            exhibition_reminder     BOOLEAN NOT NULL DEFAULT true,
            registration_updates    BOOLEAN NOT NULL DEFAULT true,
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- 刷新令牌要能撤销，因此落库；只存哈希，不存明文。
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash  TEXT NOT NULL UNIQUE,
            expires_at  TIMESTAMPTZ NOT NULL,
            revoked_at  TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

        -- 应用内通知历史（列表与会话共享，前端暂未展示，先留好落点）。
        CREATE TABLE IF NOT EXISTS notifications (
            id          TEXT PRIMARY KEY,
            user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            message     TEXT NOT NULL,
            type        TEXT NOT NULL,
            is_read     BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        `,
  },
  {
    id: '0003-user-ui-mode',
    sql: `
        -- 外观模式属于个人偏好：登录用户存自己的一份，未登录时用 app_settings.ui 作为默认。
        ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_mode TEXT NOT NULL DEFAULT 'auto';
        `,
  },
  {
    id: '0004-email-verification',
    sql: `
        -- 邮箱从「联系方式」升级为「身份」：验证过的邮箱是找回密码与两步验证的唯一凭据，
        -- 因此它必须唯一（此前只有 username 是 UNIQUE，重名邮箱只在注册路由里查一次，
        -- 并发下两条注册能写成同一个邮箱，之后按邮箱找回密码就会打错账号）。
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

        -- 存量账号回填为已验证：后端尚未公网部署，这些账号是在「注册要求邮箱验证」
        -- 上线之前建的，不回填的话它们一迁移就成了没有验证邮箱的账号，找不回密码也开不了两步验证。
        UPDATE users
           SET email_verified = true, email_verified_at = now()
         WHERE email <> '' AND email_verified = false;

        -- 大小写无关的唯一性；空串不参与唯一（允许留空的老数据并存）。
        -- 已存在重复邮箱时这一步会失败并回滚整个 0004，**必须先人工清掉重复**再迁移。
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
            ON users (lower(email)) WHERE email <> '';

        -- 验证码：一行一个用途，只存哈希，不存明文码。
        -- purpose=register 时 user_id 为空，待建账号暂存在 payload 里（密码存哈希）——
        -- 这样「先验证邮箱、通过后才建账号」不会往 users 表里留下未验证的半成品。
        CREATE TABLE IF NOT EXISTS email_codes (
            id          TEXT PRIMARY KEY,
            purpose     TEXT NOT NULL
                        CHECK (purpose IN ('register', 'reset', 'login', 'enable2fa', 'email')),
            email       TEXT NOT NULL,
            user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
            code_hash   TEXT NOT NULL,
            payload     JSONB,
            attempts    INTEGER NOT NULL DEFAULT 0,
            expires_at  TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            ip          TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS email_codes_lookup_idx
            ON email_codes (purpose, lower(email), created_at DESC);
        CREATE INDEX IF NOT EXISTS email_codes_expiry_idx ON email_codes (expires_at);

        -- 两步验证的预认证票：密码对了但还没过码时发这个，单次使用、可作废。
        -- 访问令牌只在这一步之后签发，因此「密码对了」不等于「已登录」。
        CREATE TABLE IF NOT EXISTS preauth_tickets (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash  TEXT NOT NULL UNIQUE,
            attempts    INTEGER NOT NULL DEFAULT 0,
            expires_at  TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS preauth_tickets_user_idx ON preauth_tickets (user_id);

        -- 发信留痕：送达率是这类功能的第一风险，没有留痕就无从排查
        -- （status 页的「邮件通道」自检项读的也是这张表）。
        CREATE TABLE IF NOT EXISTS mail_log (
            id          TEXT PRIMARY KEY,
            to_email    TEXT NOT NULL,
            purpose     TEXT NOT NULL DEFAULT '',
            transport   TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
            error       TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS mail_log_created_idx ON mail_log (created_at DESC);
        CREATE INDEX IF NOT EXISTS mail_log_failed_idx ON mail_log (status, created_at DESC);
        `,
  },
  {
    id: '0005-totp-backup-codes',
    sql: `
        -- 验证器（TOTP）与备用码：两步验证从「只有邮箱验证码」扩展成三种并列的第二因子。
        --
        -- totp_secret 存的是 **AES-256-GCM 密文**（见 domain/totp.ts），不是明文 base32：
        -- 备份、pg_dump、只读副本这类「只有库」的泄露不该直接把第二因子送出去。
        -- totp_pending_secret 是「扫了码但还没输码确认」的中间态，确认后搬进 totp_secret。
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ;

        -- 备用码：只存 sha256 哈希（10 位随机串，熵足够，不需要慢哈希），一次一枚、用完即废。
        CREATE TABLE IF NOT EXISTS backup_codes (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash   TEXT NOT NULL,
            used_at     TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS backup_codes_user_idx ON backup_codes (user_id);
        -- 登录时的查表只找「没用过」的那些
        CREATE INDEX IF NOT EXISTS backup_codes_active_idx
            ON backup_codes (user_id, code_hash) WHERE used_at IS NULL;
        `,
  },
  {
    // 配色从 4 种扩到 8 种。
    //
    // **只改 DEFAULT_SETTINGS 是不够的**：`app_settings` 的默认值是「缺项才写」
    // （seed 里是 `ON CONFLICT DO NOTHING`），老库那一行早就存在，seed 不会再动它，
    // 于是老用户的配色面板永远只有 4 个色块 —— 老库、新库行为不一致。
    // 这一步把已存的 theme.colors 补齐：保留原有前几项、按默认色板追加缺的新色。
    //
    // 幂等：色板补齐后 WHERE 不匹配，一行都不更新；重复执行也不会重复追加。
    // `theme.index` 完全不动，所以老库选中的强调色保持不变。
    //
    // 色板色值走 **参数**（`$1::jsonb`）而不是写死在 SQL 里：迁移语句用简单查询协议发送，
    // 而 pg 驱动会在发送前扫描 `$` 找占位符，SQL 文本里出现 `$tag$` 之类的字面量
    // （哪怕是注释里）都会被它截断，报成 `syntax error at or near "true"` 这种离谱错误。
    id: '0006-theme-palette-8',
    sql: `
        WITH palette AS (
            -- $1 是默认色板（JSON 数组），position 是它在色板里的 1 基下标。
            SELECT color, position
              FROM jsonb_array_elements_text($1::jsonb) WITH ORDINALITY AS item(color, position)
        ),
        current AS (
            SELECT COALESCE(value -> 'colors', '[]'::jsonb) AS colors
              FROM app_settings WHERE key = 'theme'
        ),
        missing AS (
            -- 只追加「默认色板里位置在已存长度之后、且库里还没有」的新色：既有项原样保留，
            -- 因此 index 0..3 的语义与旧版一致，也不会出现重复色。
            SELECT color FROM palette, current
             WHERE position > jsonb_array_length(colors)
               AND NOT colors ? color
        )
        UPDATE app_settings AS s
           SET value = jsonb_set(
                   s.value,
                   '{colors}',
                   COALESCE(s.value -> 'colors', '[]'::jsonb)
                       || COALESCE((SELECT jsonb_agg(color) FROM missing), '[]'::jsonb),
                   -- create_if_missing：老库的 theme 即使没有 colors 键也能补上
                   true)
         WHERE s.key = 'theme'
           AND jsonb_array_length(COALESCE(s.value -> 'colors', '[]'::jsonb)) < $2::int;
        `,
    // 参数：默认色板 + 目标长度。色板只在 THEME_COLORS 里写一次，避免两处漂移。
    params: (palette: readonly string[]) => [JSON.stringify(palette), palette.length],
  },
  {
    // 配色从「服务器级一项」变成「服务器级默认 + 每人一份」。
    //
    // `ui_theme` 为 NULL 表示「这个账号还没选过配色」，此时跟随
    // `app_settings.theme.index` 的全局默认（见 `domain/settings.ts` 的 `readUiTheme`）。
    // 因此在这次迁移之后，老账号的强调色不变（依旧是全局默认那一色），
    // 只有真正点过配色的账号才会写进自己的行里。
    // `ADD COLUMN IF NOT EXISTS` 让这一步可以反复执行。
    id: '0007-user-ui-theme',
    sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_theme INTEGER;
        `,
  },
  {
    // 展会亮点整块下线：详情页不再展示，表单也从没有过编辑入口（它一直是示例数据里的摆设），
    // 于是把列删掉。0001 里仍然建了这列并有示例值——那一步已经发布过，按本文件的约定不回改；
    // 全新库会先建后删，存量库只执行这里的 DROP。
    // `IF EXISTS` 让这一步可以反复执行。
    id: '0008-drop-exhibition-highlights',
    sql: `
        ALTER TABLE exhibitions DROP COLUMN IF EXISTS highlights;
        `,
  },
  {
    // 一次性用户提示（首页「左右滑动日历卡片可以切换月份」这类）看过就记下来，
    // 与账号绑定：换设备也还在，退出登录不清。存 key 列表，`ADD COLUMN IF NOT EXISTS`
    // 让这一步可以反复执行。
    id: '0009-user-seen-hints',
    sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS seen_hints TEXT[] NOT NULL DEFAULT '{}';
        `,
  },
];
