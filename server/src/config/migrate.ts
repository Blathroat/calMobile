/**
 * 数据库迁移与示例数据。
 *
 * 迁移按步骤编号记录在 `schema_migrations` 表里，只跑没跑过的步骤，
 * 因此可以反复执行（`pnpm db:migrate` 是幂等的），新增字段时往后追加一步即可，
 * 不要去改已经发布过的步骤。
 *
 * 约定：
 * - 状态一律存**英文代码**（pending / approved / review / optional …），
 *   中文标签只在 `src/domain/labels.ts` 里映射一次；
 * - 展会日期只存 `exhibition_date`，年 / 月 / 日由 SQL 派生，避免三者互相漂移；
 * - 报名记录不冗余展会标题、时间、地点，读取时 JOIN 展会表，避免展会改期后两边不一致。
 */

// 运行环境要先定下来：迁移脚本也要能对着生产库跑（`pnpm db:migrate:prod`），
// 而 pool 在 require 的那一刻就按 NODE_ENV 选好库了（见 config/runtime.ts）。
import * as runtime from './runtime.js';
import { pool } from './pool.js';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import * as dbConfig from './database.js';
import { isEntry } from '../entry.js';

export interface MigrationStep {
  id: string;
  sql: string;
  /**
   * 可选：SQL 的绑定参数（按 `THEME_COLORS` 这类「只在代码里维护一份」的常量生成）。
   *
   * 用参数而不是把值拼进 SQL 有两条理由：一是色板只在 `THEME_COLORS` 里写一次，
   * 不会和迁移步骤里手抄的列表漂移；二是 pg 驱动在**简单查询**协议下会在发送前
   * 扫描 `$` 找占位符，SQL 文本里出现美元引用之类的字面量会被截断成语法错误，
   * 走参数即改用扩展协议，不再有这类坑。
   */
  params?: (palette: readonly string[]) => readonly unknown[];
}

export interface ServerSettings {
  theme: { index: number; colors: string[] };
  ui: { mode: string };
  capabilities: { calendar: boolean; notifications: boolean; richText: boolean; export: boolean };
  categories: string[];
  review: { canRevise: boolean; statuses: string[] };
  media: { imageCount: number; imageSizeMb: number; videoCount: number; videoSizeMb: number };
  upload: {
    avatarSizeMb: number;
    avatarFormats: string[];
    imageFormats: string[];
    videoFormats: string[];
    /** 上传目录总上限（MB）。头像、封面和简介媒体都算在里面。 */
    storageMb: number;
    /** 满了以后清最早的文件，或拒绝新上传。 */
    whenFull: 'reject' | 'evict-oldest';
  };
  limits: {
    exhibitionTitle: number;
    exhibitionVenue: number;
    category: number;
    fieldTitle: number;
    /** 报名时每个文本收集项最多填多少字。 */
    textFill: number;
    /** 每个单选选项最多多少字。 */
    radioOption: number;
    /** 每个多选选项最多多少字。 */
    checkOption: number;
    usernameMin: number;
    usernameMax: number;
    passwordMin: number;
    passwordMax: number;
    nickname: number;
    bio: number;
    region: number;
    answer: number;
  };
  announcement: { enabled: boolean; text: string };
  brand: { zh: string; en: string };
  /** 缺省展会封面：展会自己没有封面时用它，空串表示继续用占位图。 */
  cover: { defaultCover: string };
  /** 展商端策略：同时能筹备的展会数、私人会议数上限，0 表示不限。 */
  exhibitor: { maxFutureExhibitions: number; maxFutureMeetings: number };
  /** 邀请码生成默认值。uses 至少 1；validHours 为 0 表示不过期。 */
  invite: { uses: number; validHours: number };
}

/**
 * 应用配色的默认色板（8 种）。
 *
 * 契约：**index 与语义稳定，位置一旦发布不得改动**。
 * `theme.index` 是存下来的用户选择，前端 `applyTheme()` 与原生 `ui.sync` 都按下标取色，
 * 换位置等于换掉所有老用户当前的强调色，因此新色只能往后追加。
 *
 * 每个色都能同时充当「实心按钮底色 + 白字」：与白色的对比度均 ≥ 4.5:1
 * （最浅的 #2F6F8F 约 5.5:1），与深色模式页面底色（#171A1F）的对比度均 ≥ 2.6:1，
 * 因此深色模式下也认得出是「有彩色」而不是糊成一块深灰。
 *
 * 定义放在 `STEPS` 之前：迁移 `0006` 的 `params` 读它，位置在后会踩到 TDZ。
 * 色板一旦发布只能追加，因此**不要**为了好看重排这个数组。
 */
export const THEME_COLORS: readonly string[] = [
  '#C05621', // 0 焦糖橙（默认）：现在的强调色，老用户不动它
  '#48515D', // 1 石墨蓝灰：中性冷色，用于沉稳、少彩的界面临时切换
  '#245D3C', // 2 森林绿：成功、环保与健康类主题
  '#2F6F8F', // 3 海湾青蓝：信息、科技与数据类主题
  '#334E7D', // 4 靛蓝：偏正式的商务蓝，比 3 更深更冷
  '#0E6E62', // 5 墨绿（偏青）：介于绿与蓝之间，区分度落在 2 与 3 之间
  '#6B3FA0', // 6 紫：活动、创意与展演类主题
  '#A32C5E', // 7 玫红：促销、节庆等强情绪主题
];

/** 迁移步骤：id 一旦发布就不要改内容，只能追加新步骤。 */
export const STEPS: MigrationStep[] = [
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
            type            TEXT NOT NULL DEFAULT '文本'
                            CHECK (type IN ('文本', '单选', '多选')),
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
  {
    // 会话按设备追踪与撤销；设备令牌只保存哈希。两步验证明确区分用户选择的主验证方式。
    id: '0010-trusted-devices-and-sessions',
    sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method TEXT NOT NULL DEFAULT 'email';
        UPDATE users
           SET two_factor_method = 'totp'
         WHERE two_factor_enabled = true AND totp_secret <> '';

        ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id TEXT;
        ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_hash TEXT NOT NULL DEFAULT '';
        ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '';
        UPDATE refresh_tokens SET session_id = id WHERE session_id IS NULL;
        ALTER TABLE refresh_tokens ALTER COLUMN session_id SET NOT NULL;
        CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON refresh_tokens (session_id, revoked_at);
        CREATE INDEX IF NOT EXISTS refresh_tokens_device_idx ON refresh_tokens (user_id, device_hash, revoked_at);

        CREATE TABLE IF NOT EXISTS trusted_devices (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash  TEXT NOT NULL,
            name        TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, token_hash)
        );
        CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON trusted_devices (user_id, last_used_at DESC);
        `,
  },
  {
    // 安全操作需要短时、单次、绑定当前会话的身份复核凭据；邮箱复核码只存哈希。
    id: '0011-security-step-up',
    sql: `
        ALTER TABLE email_codes DROP CONSTRAINT IF EXISTS email_codes_purpose_check;
        ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check
            CHECK (purpose IN ('register', 'reset', 'login', 'enable2fa', 'email', 'security'));

        CREATE TABLE IF NOT EXISTS security_stepup_tickets (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_id  TEXT NOT NULL,
            scope       TEXT NOT NULL CHECK (scope IN ('password', 'email', 'totp', 'totp-confirm', 'factor')),
            token_hash  TEXT NOT NULL UNIQUE,
            expires_at  TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS security_stepup_user_expiry_idx
            ON security_stepup_tickets (user_id, expires_at);

        CREATE TABLE IF NOT EXISTS security_stepup_attempts (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_id  TEXT NOT NULL,
            attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS security_stepup_attempts_lookup_idx
            ON security_stepup_attempts (user_id, session_id, attempted_at DESC);
        `,
  },
  {
    id: '0012-totp-confirm-scope',
    sql: `
        ALTER TABLE security_stepup_tickets DROP CONSTRAINT IF EXISTS security_stepup_tickets_scope_check;
        ALTER TABLE security_stepup_tickets ADD CONSTRAINT security_stepup_tickets_scope_check
            CHECK (scope IN ('password', 'email', 'totp', 'totp-confirm', 'factor'));
        `,
  },
  {
    id: '0013-private-meetings',
    sql: `
        -- 展商是否接受私人会议预约。受限或封禁时由业务把这一列强制写成 false。
        ALTER TABLE users ADD COLUMN IF NOT EXISTS accept_meetings BOOLEAN NOT NULL DEFAULT false;

        CREATE TABLE IF NOT EXISTS meeting_fields (
            id              TEXT PRIMARY KEY,
            exhibitor_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title           TEXT NOT NULL,
            type            TEXT NOT NULL DEFAULT '文本'
                            CHECK (type IN ('文本', '单选', '多选')),
            required        BOOLEAN NOT NULL DEFAULT false,
            options         JSONB NOT NULL DEFAULT '[]'::jsonb,
            position        INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS meeting_fields_exhibitor_idx
            ON meeting_fields (exhibitor_id, position);

        CREATE TABLE IF NOT EXISTS private_meetings (
            id              TEXT PRIMARY KEY,
            exhibitor_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            visitor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
            visitor_name    TEXT NOT NULL,
            meeting_date    DATE NOT NULL,
            meeting_time    TEXT NOT NULL DEFAULT '',
            answers         TEXT NOT NULL DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
            locked          BOOLEAN NOT NULL DEFAULT false,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS private_meetings_exhibitor_idx
            ON private_meetings (exhibitor_id, meeting_date);
        CREATE INDEX IF NOT EXISTS private_meetings_visitor_idx
            ON private_meetings (visitor_id, meeting_date);
        -- 同一天、同一个人对同一个展商只保留一条未结束的申请。
        CREATE UNIQUE INDEX IF NOT EXISTS private_meetings_active_idx
            ON private_meetings (exhibitor_id, visitor_id, meeting_date)
            WHERE visitor_id IS NOT NULL AND status IN ('pending', 'approved');
        `,
  },
  {
    id: '0014-cancel-and-meeting-notice',
    sql: `
        -- 展会默认允许撤销已通过的报名，避免已有报名突然不能取消。
        ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS allow_cancel BOOLEAN NOT NULL DEFAULT true;
        -- 私人会议以前不能取消，所以默认关闭；待审核仍可撤销，不看这个开关。
        ALTER TABLE users ADD COLUMN IF NOT EXISTS meeting_allow_cancel BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS meeting_notice TEXT NOT NULL DEFAULT '';
        ALTER TABLE private_meetings DROP CONSTRAINT IF EXISTS private_meetings_status_check;
        ALTER TABLE private_meetings ADD CONSTRAINT private_meetings_status_check
            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
        `,
  },
  {
    id: '0015-exhibitor-invites',
    sql: `
        CREATE TABLE IF NOT EXISTS exhibitor_invites (
            id           TEXT PRIMARY KEY,
            code         TEXT NOT NULL UNIQUE,
            max_uses     INTEGER NOT NULL CHECK (max_uses >= 1),
            used_count   INTEGER NOT NULL DEFAULT 0,
            expires_at   TIMESTAMPTZ,
            created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
            revoked_at   TIMESTAMPTZ,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS exhibitor_invites_created_idx
            ON exhibitor_invites (created_at DESC);
        `,
  },
];

export const DEFAULT_SETTINGS: ServerSettings = {
  theme: { index: 0, colors: [...THEME_COLORS] },
  ui: { mode: 'auto' },
  capabilities: { calendar: false, notifications: false, richText: true, export: true },
  categories: ['智能家居', '物流技术', '医疗健康', '新材料'],
  review: { canRevise: false, statuses: ['待审核', '已通过', '已拒绝'] },
  media: { imageCount: 8, imageSizeMb: 10, videoCount: 2, videoSizeMb: 50 },
  upload: {
    avatarSizeMb: 2,
    avatarFormats: ['jpg', 'jpeg', 'png', 'webp'],
    imageFormats: ['jpg', 'jpeg', 'png', 'webp'],
    videoFormats: ['mp4', 'mov', 'webm'],
    storageMb: 1024,
    whenFull: 'reject',
  },
  limits: {
    exhibitionTitle: 60,
    exhibitionVenue: 60,
    category: 20,
    fieldTitle: 30,
    textFill: 200,
    radioOption: 60,
    checkOption: 60,
    usernameMin: 3,
    usernameMax: 20,
    passwordMin: 6,
    passwordMax: 32,
    nickname: 20,
    bio: 200,
    region: 40,
    answer: 200,
  },
  announcement: { enabled: false, text: '' },
  brand: { zh: '发现展会', en: 'ExpoHub' },
  // 缺省封面默认留空：升级后的老库行为不变（没有封面的展会继续显示占位图）。
  cover: { defaultCover: '' },
  // 0 = 不限。演示环境默认放开，部署方按运营策略调小。
  exhibitor: { maxFutureExhibitions: 0, maxFutureMeetings: 0 },
  invite: { uses: 1, validHours: 168 },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建迁移记录表，返回已应用的步骤 id。 */
async function appliedSteps(client: PoolClient): Promise<Set<string>> {
  await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id          TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
  const result = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
}

/** 执行未应用的迁移步骤；每一步各自一个事务，失败即回滚。 */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    const applied = await appliedSteps(client);
    const pending = STEPS.filter((step) => !applied.has(step.id));
    if (pending.length === 0) {
      console.log('数据库结构已是最新，没有需要执行的迁移');
      return;
    }
    for (const step of pending) {
      await client.query('BEGIN');
      try {
        // 带 params 的步骤按扩展协议发送（见 MigrationStep.params 的说明）。
        if (step.params) {
          await client.query(step.sql, [...step.params(THEME_COLORS)]);
        } else {
          await client.query(step.sql);
        }
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [step.id]);
        await client.query('COMMIT');
        console.log(`迁移完成：${step.id}`);
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        console.error(`迁移失败：${step.id}`, errorMessage(error));
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

/** 示例数据：账号、展会（含收集项）、报名、服务器设置。可重复执行。生产环境拒绝执行。 */
export async function seed(): Promise<void> {
  if (runtime.isProduction) {
    throw new Error('生产环境不写入示例账号。管理员由 ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_EMAIL 在启动时创建。');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash('password', 10);
    const accounts: [string, string, string, string, string, string][] = [
      ['usr-1', 'demo', 'demo@example.com', 'demo', 'admin', ''],
      ['usr-2', 'exhibitor', 'exhibitor@example.com', 'exhibitor', 'exhibitor', ''],
      ['usr-3', 'user', 'user@example.com', 'user', 'user', '展会常客，关注智能家居与新材料。'],
    ];
    for (const [id, username, email, nickname, role, bio] of accounts) {
      // `email_verified` 必须在这里显式写 true：迁移 0004 里那条回填写在「存量账号回填」上，
      // 而**全新库是先迁移、后 seed**，回填时表还是空的 —— 不写的话示例账号一建出来就是
      // 「邮箱未验证」，找不回密码、也开不了两步验证（演示账号的邮箱本来就是占位地址，
      // 收不到信，只能按已验证处理）。
      await client.query(
        `
                INSERT INTO users (id, username, password_hash, email, nickname, role, bio,
                                   email_verified, email_verified_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
                ON CONFLICT (id) DO UPDATE SET
                    username = EXCLUDED.username,
                    email = EXCLUDED.email,
                    nickname = EXCLUDED.nickname,
                    role = EXCLUDED.role,
                    email_verified = EXCLUDED.email_verified,
                    email_verified_at = EXCLUDED.email_verified_at,
                    updated_at = now()
            `,
        [id, username, passwordHash, email, nickname, role, bio],
      );
    }
    console.log(`示例账号就绪（${accounts.length} 个）`);

    // 示例展会的日期**相对今天**生成：写死日期的示例数据过一阵就会全部过期，
    // 报名窗口规则一上线，演示里就再也报不上名了。偏移量以天为单位。
    const exhibitions = [
      {
        id: 'exh-1',
        title: '华南智能家居展',
        venue: '深圳会展中心 3 号馆',
        time: '09:00-17:30',
        dayOffset: 7,
        status: 'optional',
        category: '智能家居',
        description: '# 展会亮点\n\n- 智能门锁与全屋方案\n- 节能家电现场体验',
        registerFrom: -14,
        registerTo: 3,
        qrEnabled: true,
        exhibitorId: 'usr-2',
        note: '面向渠道商与终端用户',
      },
      {
        id: 'exh-2',
        title: '大湾区物流技术展',
        venue: '广州琶洲展馆 C 区',
        time: '10:00-18:00',
        dayOffset: 14,
        status: 'review',
        category: '物流技术',
        description: 'AGV、仓储机器人与冷链物流方案。',
        registerFrom: -7,
        registerTo: 10,
        qrEnabled: false,
        exhibitorId: 'usr-2',
        note: '面向制造业与物流企业',
      },
      {
        id: 'exh-3',
        title: '数字健康峰会',
        venue: '上海国家会展中心',
        time: '09:30-16:00',
        dayOffset: 21,
        status: 'closed',
        category: '医疗健康',
        description: '医疗 AI、远程诊疗和穿戴设备专题。',
        registerFrom: -30,
        registerTo: -1,
        qrEnabled: false,
        exhibitorId: 'usr-2',
        note: '面向医疗机构与设备厂商',
      },
      {
        id: 'exh-4',
        title: '国际新材料展',
        venue: '北京国家会议中心',
        time: '09:00-17:00',
        dayOffset: 45,
        status: 'display',
        category: '新材料',
        description: '碳纤维、石墨烯和可降解材料展示。',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        exhibitorId: 'usr-2',
        note: '面向研发与采购',
      },
    ];
    for (const item of exhibitions) {
      await client.query(
        `
                INSERT INTO exhibitions (id, title, venue, time, exhibition_date, status, category,
                    description, description_format, exhibitor_note,
                    registration_start, registration_end, qr_enabled, exhibitor_id)
                VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8, 'md', $9,
                    CASE WHEN $10::int IS NULL THEN NULL ELSE CURRENT_DATE + $10::int END,
                    CASE WHEN $11::int IS NULL THEN NULL ELSE CURRENT_DATE + $11::int END,
                    $12, $13)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, venue = EXCLUDED.venue, time = EXCLUDED.time,
                    exhibition_date = EXCLUDED.exhibition_date, status = EXCLUDED.status,
                    category = EXCLUDED.category, description = EXCLUDED.description,
                    exhibitor_note = EXCLUDED.exhibitor_note,
                    registration_start = EXCLUDED.registration_start,
                    registration_end = EXCLUDED.registration_end,
                    qr_enabled = EXCLUDED.qr_enabled, exhibitor_id = EXCLUDED.exhibitor_id,
                    updated_at = now()
            `,
        [
          item.id,
          item.title,
          item.venue,
          item.time,
          item.dayOffset,
          item.status,
          item.category,
          item.description,
          item.note,
          item.registerFrom,
          item.registerTo,
          item.qrEnabled,
          item.exhibitorId,
        ],
      );
    }
    console.log(`示例展会就绪（${exhibitions.length} 场，日期相对今天生成）`);

    // 示例展会的报名收集项：**只写在这里**，是给演示用的数据。
    // 展会本身没有「默认收集项」这回事 —— 展商新建展会时没填收集项，报名页就是空的。
    const fields: [string, string, boolean, string[]][] = [
      ['姓名 / 公司名称', '文本', true, []],
      ['参观身份', '单选', true, ['专业观众', '采购负责人', '媒体']],
      ['报名需求', '多选', false, ['希望安排展商洽谈', '需要停车位', '需要翻译服务']],
    ];
    for (const exhibition of exhibitions) {
      const existing = await client.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM exhibition_fields WHERE exhibition_id = $1',
        [exhibition.id],
      );
      if ((existing.rows[0]?.total ?? 0) > 0) {
        continue;
      }
      for (const [index, [title, type, required, options]] of fields.entries()) {
        await client.query(
          `
                    INSERT INTO exhibition_fields (id, exhibition_id, title, type, required, options, position)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [`field-${exhibition.id}-${index + 1}`, exhibition.id, title, type, required, JSON.stringify(options), index],
        );
      }
    }
    console.log('示例报名收集项就绪');

    const registrations: [string, string, string, string, string, string, string][] = [
      [
        'reg-1',
        'exh-1',
        'usr-3',
        '张伟',
        '专业观众',
        '姓名 / 公司名称：张伟\n参观身份：专业观众\n报名需求：希望安排展商洽谈',
        'approved',
      ],
      ['reg-2', 'exh-1', 'usr-2', '李娜', '采购负责人', '姓名 / 公司名称：李娜\n参观身份：采购负责人', 'approved'],
      ['reg-3', 'exh-2', 'usr-3', '王磊', '专业观众', '姓名 / 公司名称：王磊', 'pending'],
    ];
    for (const [id, exhibitionId, visitorId, name, type, answers, status] of registrations) {
      await client.query(
        `
                INSERT INTO registrations (id, exhibition_id, visitor_id, visitor_name, visitor_type, answers, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    visitor_name = EXCLUDED.visitor_name,
                    visitor_type = EXCLUDED.visitor_type,
                    answers = EXCLUDED.answers,
                    status = EXCLUDED.status,
                    updated_at = now()
            `,
        [id, exhibitionId, visitorId, name, type, answers, status],
      );
    }
    console.log(`示例报名就绪（${registrations.length} 条）`);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await client.query(
        `
                INSERT INTO app_settings (key, value) VALUES ($1, $2)
                ON CONFLICT (key) DO NOTHING
            `,
        [key, JSON.stringify(value)],
      );
    }
    console.log('服务器设置默认值就绪');

    await client.query('COMMIT');
    console.log('示例数据插入完成');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    console.error('示例数据插入失败：', errorMessage(error));
    throw error;
  } finally {
    client.release();
  }
}

// 只在直接执行本文件时跑迁移（`tsx src/config/migrate.ts` / `node dist/config/migrate.js`）；
// 被别的模块 import（`routes/status.ts` 读 STEPS、`domain/settings.ts` 读 DEFAULT_SETTINGS）时不动。
if (isEntry(import.meta.url)) {
  const command = process.argv[2];
  const run = command === 'seed' ? seed : command === 'migrate' ? migrate : null;
  if (!run) {
    console.log('用法：tsx src/config/migrate.ts [migrate|seed] [--production]');
    process.exit(1);
  }
  // 打印目标库：迁移是不可逆操作，别对着错的库跑完才发现。
  console.log(`[${runtime.nodeEnv}] 目标库 ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  run()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
