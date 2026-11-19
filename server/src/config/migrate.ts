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
import * as labels from '../domain/labels.js';
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
  theme: { index: number; colors: string[]; accentColor: string };
  ui: { mode: string };
  capabilities: { calendar: boolean; notifications: boolean; richText: boolean; export: boolean };
  categories: string[];
  /**
   * 审核策略。`canRevise`：展商能否改已通过 / 已拒绝的报名；
   * `canReviseAttended`：展商能否把「已参加」退回重审（默认关闭，管理员始终可改）。
   */
  review: { canRevise: boolean; canReviseAttended: boolean; statuses: string[] };
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
  /**
   * 匿名报名（报名站分享链接、未登录）相关的展示配置。
   *
   * `nameFieldTitles` 是姓名同义词列表：展商的文本收集项标题命中其中任意一项时，
   * 报名页把额外的「姓名」表单合并掉，直接拿这项收集项当姓名；空数组表示不合并。
   */
  registration: { nameFieldTitles: string[] };
  announcement: { enabled: boolean; text: string };
  brand: { zh: string; en: string };
  /** 缺省展会封面：展会自己没有封面时用它，空串表示继续用占位图。 */
  cover: { defaultCover: string };
  /**
   * 展商端策略：
   * - `maxFutureExhibitions` / `maxFutureMeetings`：同时能筹备的展会 / 私人会议数上限，0 表示不限；
   * - `maxExhibitionDays`：单个展会最长持续天数（按开展～闭展算），0 表示不限。
   */
  exhibitor: { maxFutureExhibitions: number; maxFutureMeetings: number; maxExhibitionDays: number };
  /**
   * 邀请码生成默认值。uses 至少 1；validHours 为 0 表示不过期。
   * durationDays 是兑换后展商身份保留的天数，0 表示永久。
   */
  invite: { uses: number; validHours: number; durationDays: number };
  /**
   * 客户端安装包下载源（管理端设置）。
   *
   * - url：直接用管理员填的直链；
   * - github：追踪 repo 仓库的最新 Release，取第一个 .apk 资产的下载地址。
   * 空串表示没配，更新检查与报名站的下载条据此隐藏下载入口。
   */
  download: { source: 'url' | 'github'; url: string; repo: string };
  /**
   * 用户协议（管理端可选开启）。
   *
   * `content` 是 Markdown 正文；`version` 在正文变化时自增，用来判断已登录用户
   * 是否需要重新确认（只拨开关、不改正文不升版本）。`updatedAt` 是正文最后更新时间。
   */
  agreement: { enabled: boolean; content: string; version: number; updatedAt: string };
  /** 操作日志的存储上限（MB）：超过后自动清理最早的日志。 */
  logs: { storageMb: number };
}

/**
 * 应用配色的默认色板（12 种）。
 *
 * 2026-11 起首色由「钢青」担任，并允许管理设置下发色号覆盖它；原先的焦糖橙移到 1。
 * `users.ui_theme` 里的旧下标由迁移 `0020-theme-accent` 平移，老用户选中的颜色不变；
 * 新用户的默认下标是 0（钢青或管理设置下发的色号）。
 * 其余位置仍按「新色只能往后追加」维护，不要再重排 1..11。
 *
 * 每个色都能同时充当「实心按钮底色 + 白字」：与白色的对比度均 ≥ 4.5:1
 * （最浅的 #C05621 约 4.6:1），与深色模式页面底色（#171A1F）的对比度均 ≥ 2.1:1，
 * 因此深色模式下也认得出是「有彩色」而不是糊成一块深灰。
 *
 * 定义放在 `STEPS` 之前：迁移 `0006` 的 `params` 读它，位置在后会踩到 TDZ。
 */
export const THEME_COLORS: readonly string[] = [
  '#41707E', // 0 钢青（默认）：可由管理设置下发色号覆盖
  '#C05621', // 1 焦糖橙：原默认色，老用户已选过它的会由 0020 迁移保持
  '#48515D', // 2 石墨蓝灰：中性冷色，用于沉稳、少彩的界面临时切换
  '#245D3C', // 3 森林绿：成功、环保与健康类主题
  '#2F6F8F', // 4 海湾青蓝：信息、科技与数据类主题
  '#334E7D', // 5 靛蓝：偏正式的商务蓝，比 4 更深更冷
  '#0E6E62', // 6 墨绿（偏青）：介于绿与蓝之间，区分度落在 3 与 4 之间
  '#6B3FA0', // 7 紫：活动、创意与展演类主题
  '#A32C5E', // 8 玫红：促销、节庆等强情绪主题
  '#5F6B2A', // 9 橄榄绿：偏黄绿，和 3 的森林绿、6 的墨绿拉开一档
  '#A33B3B', // 10 深红：比 8 的玫红更沉，适合展陈、纪实类主题
  '#8E4A76', // 11 梅紫：介于 7 的紫与 8 的玫红之间，更柔和
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
            type            TEXT NOT NULL DEFAULT 'text'
                            CHECK (type IN ('text', 'radio', 'checkbox')),
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
  {
    // 报名码从「确定性拼接」升级成「带可轮换凭据」：凭据在报名被退回重审时换新，
    // 现场那张旧二维码随之失效。存量已通过 / 已参加的报名在这里补一个随机凭据；
    // 不补的话它们升级后拼不出码（`registrationPayload` 凭据为空就不下发报名码）。
    // `ADD COLUMN IF NOT EXISTS` + `WHERE check_in_secret = ''` 让这一步可以反复执行。
    id: '0016-check-in-secret',
    sql: `
        ALTER TABLE registrations ADD COLUMN IF NOT EXISTS check_in_secret TEXT NOT NULL DEFAULT '';
        UPDATE registrations
           SET check_in_secret = substr(md5(random()::text || id), 1, 12)
         WHERE status IN ('approved', 'attended') AND check_in_secret = '';
        `,
  },
  {
    // 展商身份可以按天发放：邀请码记录兑换后保留多少天，用户记录到期时间。
    // NULL 表示永久；0 天邀请码也写 NULL，因此老库和老邀请码的行为保持不变。
    id: '0017-exhibitor-membership',
    sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS exhibitor_expires_at TIMESTAMPTZ;
        ALTER TABLE exhibitor_invites ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 0;

        CREATE INDEX IF NOT EXISTS users_exhibitor_expiry_idx
            ON users (exhibitor_expires_at)
            WHERE role = 'exhibitor' AND exhibitor_expires_at IS NOT NULL;
        `,
  },
  {
    // 收集项类型从「中文标签」改成 code（text / radio / checkbox）：协议值、前端比较与
    // 表单回传都用 code，中文只留在兼容字段里。两张收集项表都要迁：展会的
    // exhibition_fields 与私人会议的 meeting_fields。
    // Postgres 的 CHECK 约束自动名是 <表>_type_check，所以先 DROP IF EXISTS 再按 code 重建；
    // UPDATE 只认老中文，已经写进 code 的行与重复执行都不受影响。
    id: '0018-field-type-codes',
    sql: `
        ALTER TABLE exhibition_fields DROP CONSTRAINT IF EXISTS exhibition_fields_type_check;
        UPDATE exhibition_fields
           SET type = CASE type
                        WHEN '文本' THEN 'text'
                        WHEN '单选' THEN 'radio'
                        WHEN '多选' THEN 'checkbox'
                        ELSE type
                      END
         WHERE type IN ('文本', '单选', '多选');
        ALTER TABLE exhibition_fields ALTER COLUMN type SET DEFAULT 'text';
        ALTER TABLE exhibition_fields ADD CONSTRAINT exhibition_fields_type_check
            CHECK (type IN ('text', 'radio', 'checkbox'));

        ALTER TABLE meeting_fields DROP CONSTRAINT IF EXISTS meeting_fields_type_check;
        UPDATE meeting_fields
           SET type = CASE type
                        WHEN '文本' THEN 'text'
                        WHEN '单选' THEN 'radio'
                        WHEN '多选' THEN 'checkbox'
                        ELSE type
                      END
         WHERE type IN ('文本', '单选', '多选');
        ALTER TABLE meeting_fields ALTER COLUMN type SET DEFAULT 'text';
        ALTER TABLE meeting_fields ADD CONSTRAINT meeting_fields_type_check
            CHECK (type IN ('text', 'radio', 'checkbox'));
        `,
  },
  {
    // 通行密钥（WebAuthn / passkey）：第二因子从「验证器 / 邮箱码 / 备用码」再扩一种。
    //
    // credential_id 与 public_key 都存 base64url：前者是浏览器交给我们的凭据 id，
    // 后者是 COSE 编码的公钥（由 @simplewebauthn/server 解析并校验，服务端不自己解 CBOR）。
    // counter 用于识别被克隆的认证器：每次断言成功都要把新计数写回来。
    // 挑战一次一用、10 分钟过期：只存服务端生成的那一串，消费时原子删除。
    id: '0019-passkeys',
    sql: `
        CREATE TABLE IF NOT EXISTS passkey_credentials (
            id            TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            credential_id TEXT NOT NULL UNIQUE,          -- base64url
            public_key    TEXT NOT NULL,                 -- base64url（COSE 公钥）
            counter       BIGINT NOT NULL DEFAULT 0,
            transports    TEXT NOT NULL DEFAULT '[]',    -- JSON 数组
            name          TEXT NOT NULL DEFAULT '',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at  TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS passkey_credentials_user ON passkey_credentials (user_id);

        CREATE TABLE IF NOT EXISTS webauthn_challenges (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind       TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
            challenge  TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS webauthn_challenges_user ON webauthn_challenges (user_id);
        `,
  },
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

export const DEFAULT_SETTINGS: ServerSettings = {
  theme: { index: 0, colors: [...THEME_COLORS], accentColor: THEME_COLORS[0] ?? '#41707E' },
  ui: { mode: 'auto' },
  capabilities: { calendar: false, notifications: false, richText: true, export: true },
  categories: ['智能家居', '物流技术', '医疗健康', '新材料'],
  review: { canRevise: false, canReviseAttended: false, statuses: ['待审核', '已通过', '已拒绝'] },
  // 匿名报名姓名同义词：默认覆盖常见的叫法。展商收集项标题命中时，报名页不再单独要姓名。
  registration: { nameFieldTitles: ['姓名', '昵称', '称呼', '圈名'] },
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
  exhibitor: { maxFutureExhibitions: 0, maxFutureMeetings: 0, maxExhibitionDays: 0 },
  invite: { uses: 1, validHours: 168, durationDays: 0 },
  // 默认是直链且地址为空：升级后的老库不会凭空多出一个下载入口。
  download: { source: 'url', url: '', repo: '' },
  // 默认不开启：升级后的老库不会凭空出现用户协议入口。
  agreement: { enabled: false, content: '', version: 0, updatedAt: '' },
  // 操作日志默认保留 64 MB，超出自动清理最早的记录。
  logs: { storageMb: 64 },
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

/** 示例账号：一个 id 一行，重复执行 seed 时按 id 更新成期望值。 */
interface SeedAccount {
  id: string;
  username: string;
  email: string;
  nickname: string;
  role: 'user' | 'exhibitor' | 'admin';
  status: 'active' | 'limited' | 'banned';
  bio: string;
  region: string;
  socialMedia: string;
  avatar: string;
  /** 展商身份到期时间（相对今天的天数，负数表示已过期）；null 表示永久或不是展商。 */
  expiresInDays: number | null;
  acceptMeetings: boolean;
  meetingAllowCancel: boolean;
  meetingNotice: string;
  showRegistrations: boolean;
  seenHints: string[];
  /** 注册时间距今多少天，只影响用户列表排序与「注册时间」展示。 */
  registerDaysAgo: number;
  /** 最近登录地区（管理端用户列表展示；本人登录后会被真实来源覆盖）。 */
  lastLoginRegion: string;
}

/** 示例收集项：报名页按顺序渲染，type 只认 text / radio / checkbox。 */
interface SeedField {
  title: string;
  type: 'text' | 'radio' | 'checkbox';
  required: boolean;
  options: string[];
}

/**
 * 示例展会。
 *
 * 日期一律用「相对今天的天数」表示：写死日期的示例数据过一阵就全部过期，
 * 报名窗口与日历落点都跟着失效。dayOffset 为 0 表示今天。
 *
 * exh-1 是日历落点（最早的一场），月视图契约测试依赖「落点那个月里的展会都归
 * exhibitor 账号」，因此新增展会都放在 +60 天以后，不要插到它前面。
 */
interface SeedExhibition {
  id: string;
  title: string;
  venue: string;
  time: string;
  dayOffset: number;
  /** 闭展日期相对今天的天数；null 表示单日展会。 */
  endOffset: number | null;
  status: 'review' | 'optional' | 'display' | 'closed' | 'ended';
  category: string;
  description: string;
  exhibitorId: string;
  exhibitorNote: string;
  registrationNotice: string;
  /** 报名窗口起止（相对今天的天数）；null 表示不设窗口。 */
  registerFrom: number | null;
  registerTo: number | null;
  qrEnabled: boolean;
  allowCancel: boolean;
  fields: SeedField[];
}

/**
 * 示例报名：状态覆盖 pending / approved / rejected / cancelled / attended 五种。
 *
 * attendanceStart / attendanceEnd 是多天展会报名时选的参加时间段（相对今天的天数）；
 * checkInHoursAgo 只给「已参加」用，表示核销时间相对现在多少小时之前。
 * answers 与对应展会的收集项格式一致：每行「标题：值」，多选值用「、」连接。
 */
interface SeedRegistration {
  id: string;
  exhibitionId: string;
  visitorId: string;
  visitorName: string;
  visitorType: string;
  answers: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'attended';
  attendanceStart: number | null;
  attendanceEnd: number | null;
  checkInHoursAgo: number | null;
}

/** 示例私人会议：日期用相对今天的天数，保证演示时都还在未来。 */
interface SeedMeeting {
  id: string;
  exhibitorId: string;
  visitorId: string;
  visitorName: string;
  dayOffset: number;
  time: string;
  answers: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
}

/** 示例邀请码：固定 code 便于演示；重复执行时把次数与有效期恢复成这里的期望值。 */
interface SeedInvite {
  id: string;
  code: string;
  maxUses: number;
  durationDays: number;
  /** 有效期（相对今天的天数）；null 表示不过期。 */
  validDays: number | null;
}

/**
 * 示例数据：账号、展会（含收集项）、报名、私人会议、邀请码、服务器设置。可重复执行。生产环境拒绝执行。
 *
 * 幂等约定：账号 / 展会 / 报名 / 邀请码按固定 id 写入，重复执行时更新成这里的期望值
 * （演示中改过的状态会被重置）；收集项与私人会议按存在性跳过，避免撞上唯一约束。
 * 与契约测试共享的固定数据是账号 demo / exhibitor / user 与展会 exh-1..4、报名 reg-1..3，
 * 改它们的形状之前先看一遍 src/test 下引用到的地方。
 */
export async function seed(): Promise<void> {
  if (runtime.isProduction) {
    throw new Error('生产环境不写入示例账号。管理员由 ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_EMAIL 在启动时创建。');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash('password', 10);
    // demo / exhibitor / user 三个固定账号是契约测试与演示脚本的入口，用户名与密码不要改；
    // 其余账号覆盖管理端要看到的角色与状态：第二个展商、受限、封禁、展商身份已到期。
    const accounts: SeedAccount[] = [
      {
        id: 'usr-1',
        username: 'demo',
        email: 'demo@example.com',
        nickname: 'demo',
        role: 'admin',
        status: 'active',
        bio: '平台运营与展会审核',
        region: '广东省深圳市',
        socialMedia: 'demo_admin',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: ['home-calendar-swipe'],
        registerDaysAgo: 120,
        lastLoginRegion: '广东省深圳市',
      },
      {
        id: 'usr-2',
        username: 'exhibitor',
        email: 'exhibitor@example.com',
        nickname: 'exhibitor',
        role: 'exhibitor',
        status: 'active',
        bio: '智能家居与物流装备展主办方',
        region: '上海市',
        socialMedia: 'linyizhou_expo',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: ['home-calendar-swipe'],
        registerDaysAgo: 100,
        lastLoginRegion: '上海市',
      },
      {
        id: 'usr-3',
        username: 'user',
        email: 'user@example.com',
        nickname: 'user',
        role: 'user',
        status: 'active',
        bio: '展会常客，关注智能家居与新材料。',
        region: '北京市',
        socialMedia: '',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 90,
        lastLoginRegion: '北京市',
      },
      {
        id: 'usr-5',
        username: 'mediaexpo',
        email: 'mediaexpo@example.com',
        nickname: '方启明',
        role: 'exhibitor',
        status: 'active',
        bio: '跨境供应链展与医疗器械论坛的主办人，接受私人会议预约。',
        region: '浙江省杭州市',
        socialMedia: '@fangqiming',
        avatar: '/media/avatars/0123456789abcdef0123456789abcdef.png',
        expiresInDays: null,
        acceptMeetings: true,
        meetingAllowCancel: true,
        meetingNotice: '请提前一天确认会议时间',
        showRegistrations: true,
        seenHints: ['home-calendar-swipe', 'exhibitor-checkin'],
        registerDaysAgo: 60,
        lastLoginRegion: '浙江省杭州市',
      },
      {
        id: 'usr-6',
        username: 'limiteduser',
        email: 'limited@example.com',
        nickname: '陈嘉禾',
        role: 'user',
        status: 'limited',
        bio: '账号状态演示：受限账号不能报名、不能发布展会。',
        region: '四川省成都市',
        socialMedia: '',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 45,
        lastLoginRegion: '四川省成都市',
      },
      {
        id: 'usr-7',
        username: 'banneduser',
        email: 'banned@example.com',
        nickname: '高远',
        role: 'user',
        status: 'banned',
        bio: '账号状态演示：封禁账号在登录时就被拒绝。',
        region: '湖北省武汉市',
        socialMedia: '@gaoyuan_media',
        avatar: '',
        expiresInDays: null,
        acceptMeetings: false,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 30,
        lastLoginRegion: '湖北省武汉市',
      },
      {
        id: 'usr-8',
        username: 'trialexpo',
        email: 'trial@example.com',
        nickname: '秦岚',
        role: 'exhibitor',
        status: 'active',
        bio: '限时展商演示：展商身份已到期，登录后会自动降为普通用户。',
        region: '江苏省南京市',
        socialMedia: '',
        avatar: '',
        expiresInDays: -2,
        acceptMeetings: true,
        meetingAllowCancel: false,
        meetingNotice: '',
        showRegistrations: false,
        seenHints: [],
        registerDaysAgo: 20,
        lastLoginRegion: '江苏省南京市',
      },
    ];
    for (const item of accounts) {
      // `email_verified` 必须在这里显式写 true：迁移 0004 里那条回填写在「存量账号回填」上，
      // 而**全新库是先迁移、后 seed**，回填时表还是空的 —— 不写的话示例账号一建出来就是
      // 「邮箱未验证」，找不回密码、也开不了两步验证（演示账号的邮箱本来就是占位地址，
      // 收不到信，只能按已验证处理）。
      // 重复执行时把密码、状态与资料一起恢复成期望值，演示中改乱的数据能一键回到初始形态。
      await client.query(
        `
                INSERT INTO users (id, username, password_hash, email, nickname, role, status, bio, region,
                    social_media, avatar, show_registrations, accept_meetings, meeting_allow_cancel,
                    meeting_notice, exhibitor_expires_at, seen_hints, last_login_region,
                    email_verified, email_verified_at, registration_time)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    CASE WHEN $16::int IS NULL THEN NULL ELSE now() + make_interval(days => $16::int) END,
                    $17::text[], $18, true, now(), now() - make_interval(days => $19::int))
                ON CONFLICT (id) DO UPDATE SET
                    username = EXCLUDED.username,
                    password_hash = EXCLUDED.password_hash,
                    email = EXCLUDED.email,
                    nickname = EXCLUDED.nickname,
                    role = EXCLUDED.role,
                    status = EXCLUDED.status,
                    bio = EXCLUDED.bio,
                    region = EXCLUDED.region,
                    social_media = EXCLUDED.social_media,
                    avatar = EXCLUDED.avatar,
                    show_registrations = EXCLUDED.show_registrations,
                    accept_meetings = EXCLUDED.accept_meetings,
                    meeting_allow_cancel = EXCLUDED.meeting_allow_cancel,
                    meeting_notice = EXCLUDED.meeting_notice,
                    exhibitor_expires_at = EXCLUDED.exhibitor_expires_at,
                    seen_hints = EXCLUDED.seen_hints,
                    last_login_region = EXCLUDED.last_login_region,
                    email_verified = EXCLUDED.email_verified,
                    email_verified_at = EXCLUDED.email_verified_at,
                    registration_time = EXCLUDED.registration_time,
                    updated_at = now()
            `,
        [
          item.id,
          item.username,
          passwordHash,
          item.email,
          item.nickname,
          item.role,
          item.status,
          item.bio,
          item.region,
          item.socialMedia,
          item.avatar,
          item.showRegistrations,
          item.acceptMeetings,
          item.meetingAllowCancel,
          item.meetingNotice,
          item.expiresInDays,
          item.seenHints,
          item.lastLoginRegion,
          item.registerDaysAgo,
        ],
      );
    }
    console.log(`示例账号就绪（${accounts.length} 个，含第二个展商、受限、封禁与已到期展商）`);

    // 示例展会的日期**相对今天**生成：写死日期的示例数据过一阵就会全部过期，
    // 报名窗口规则一上线，演示里就再也报不上名了。偏移量以天为单位。
    //
    // 覆盖范围：五种报名方式（需审核 / 无需审核 / 仅展示 / 截止报名 / 已结束）、
    // 单日与多天、时间为空、报名窗口进行中 / 未开始 / 已截止 / 不设窗口、
    // 两种主办人（管理员与第二个展商）、带与不带报名注意事项、二维码开关、
    // 有收集项与没有收集项的展会。exh-1 是最早的一场（日历落点），不要往前插展会。
    const standardFields: SeedField[] = [
      { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
      { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '采购负责人', '媒体'] },
      {
        title: '报名需求',
        type: 'checkbox',
        required: false,
        options: ['希望安排展商洽谈', '需要停车位', '需要翻译服务'],
      },
    ];
    const exhibitions: SeedExhibition[] = [
      {
        id: 'exh-1',
        title: '华南智能家居展',
        venue: '深圳会展中心 3 号馆',
        time: '09:00-17:30',
        dayOffset: 7,
        endOffset: null,
        status: 'optional',
        category: '智能家居',
        description: '# 展会亮点\n\n- 智能门锁与全屋方案\n- 节能家电现场体验',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向渠道商与终端用户',
        registrationNotice: '',
        registerFrom: -14,
        registerTo: 3,
        qrEnabled: true,
        allowCancel: true,
        fields: standardFields,
      },
      {
        id: 'exh-2',
        title: '大湾区物流技术展',
        venue: '广州琶洲展馆 C 区',
        time: '10:00-18:00',
        dayOffset: 14,
        endOffset: null,
        status: 'review',
        category: '物流技术',
        description: 'AGV、仓储机器人与冷链物流方案。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向制造业与物流企业',
        registrationNotice: '',
        registerFrom: -7,
        registerTo: 10,
        qrEnabled: false,
        allowCancel: true,
        fields: standardFields,
      },
      {
        id: 'exh-3',
        title: '数字健康峰会',
        venue: '上海国家会展中心',
        time: '09:30-16:00',
        dayOffset: 21,
        endOffset: null,
        status: 'closed',
        category: '医疗健康',
        description: '医疗 AI、远程诊疗和穿戴设备专题。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向医疗机构与设备厂商',
        registrationNotice: '',
        registerFrom: -30,
        registerTo: -1,
        qrEnabled: false,
        allowCancel: true,
        fields: standardFields,
      },
      {
        id: 'exh-4',
        title: '国际新材料展',
        venue: '北京国家会议中心',
        time: '09:00-17:00',
        dayOffset: 45,
        endOffset: null,
        status: 'display',
        category: '新材料',
        description: '碳纤维、石墨烯和可降解材料展示。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向研发与采购',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: standardFields,
      },
      {
        // 管理员主办、多天、带报名注意事项与齐全的收集项；报名窗口进行中。
        id: 'exh-5',
        title: '国际智慧城市与物联网博览会',
        venue: '杭州国际博览中心 1 号馆',
        time: '09:00-18:00',
        dayOffset: 60,
        endOffset: 62,
        status: 'review',
        category: '智能家居',
        description: '# 展会亮点\n\n- 城市级物联网平台与数字孪生\n- 智能安防与楼宇方案现场演示',
        exhibitorId: 'usr-1',
        exhibitorNote: '管理员主办的跨天展会，面向政企客户与系统集成商',
        registrationNotice: '请携带身份证件从 A 口入场\n审核通过后可在「我的活动」里查看报名码',
        registerFrom: -10,
        registerTo: 30,
        qrEnabled: true,
        allowCancel: true,
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          {
            title: '参观身份',
            type: 'radio',
            required: true,
            options: ['专业观众', '采购负责人', '媒体', '展商代表'],
          },
          {
            title: '报名需求',
            type: 'checkbox',
            required: false,
            options: ['希望安排展商洽谈', '需要停车位', '需要翻译服务', '需要住宿协助'],
          },
          { title: '公司规模', type: 'radio', required: false, options: ['1-50 人', '51-200 人', '200 人以上'] },
        ],
      },
      {
        // 第二个展商主办、多天、关闭二维码与撤销；报名窗口进行中。
        id: 'exh-6',
        title: '跨境供应链与仓储自动化展',
        venue: '苏州国际博览中心 B 馆',
        time: '10:00-17:30',
        dayOffset: 70,
        endOffset: 73,
        status: 'optional',
        category: '物流技术',
        description: 'AGV、无人仓与跨境物流服务商一站式对接。',
        exhibitorId: 'usr-5',
        exhibitorNote: '面向物流企业与跨境电商卖家',
        registrationNotice: '报名后请按参加时间段到馆，现场签到入场',
        registerFrom: -5,
        registerTo: 40,
        qrEnabled: false,
        allowCancel: false,
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '采购负责人', '媒体'] },
        ],
      },
      {
        // 单日、**时间为空**（活动时间待定）、报名窗口还没开始、没有收集项。
        id: 'exh-7',
        title: '长三角医疗器械创新论坛',
        venue: '上海世博展览馆 2 号馆',
        time: '',
        dayOffset: 80,
        endOffset: null,
        status: 'optional',
        category: '医疗健康',
        description: '创新器械、影像设备与临床转化专题，活动时间待定。',
        exhibitorId: 'usr-5',
        exhibitorNote: '',
        registrationNotice: '',
        registerFrom: 20,
        registerTo: 40,
        qrEnabled: true,
        allowCancel: true,
        fields: [],
      },
      {
        // 需审核 + 报名窗口已截止：列表上会叠加「已截止」，报名入口关闭。
        id: 'exh-8',
        title: '先进复合材料应用展',
        venue: '北京国家会议中心 E 区',
        time: '09:30-16:30',
        dayOffset: 85,
        endOffset: null,
        status: 'review',
        category: '新材料',
        description: '碳纤维、陶瓷基与可回收复合材料应用案例。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向研发、采购与投资机构',
        registrationNotice: '',
        registerFrom: -30,
        registerTo: -5,
        qrEnabled: false,
        allowCancel: true,
        fields: [
          { title: '姓名 / 公司名称', type: 'text', required: true, options: [] },
          { title: '参观身份', type: 'radio', required: true, options: ['专业观众', '采购负责人', '媒体'] },
          { title: '采购意向', type: 'checkbox', required: false, options: ['寻找供应商', '了解新品', '商务洽谈'] },
        ],
      },
      {
        // 不设报名窗口（起止都为空）+ 没有收集项。
        id: 'exh-9',
        title: '华南智能办公空间展',
        venue: '广州保利世贸博览馆',
        time: '10:00-16:00',
        dayOffset: 90,
        endOffset: null,
        status: 'optional',
        category: '智能家居',
        description: '智能办公家具、会议系统与空间管理方案。',
        exhibitorId: 'usr-2',
        exhibitorNote: '',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: [],
      },
      {
        // 今天结束的展会：用来展示「已结束」状态与已参加的报名记录。
        id: 'exh-10',
        title: '智慧医疗与康复设备展',
        venue: '成都世纪城新国际会展中心',
        time: '09:00-17:00',
        dayOffset: 0,
        endOffset: null,
        status: 'ended',
        category: '医疗健康',
        description: '今天结束的示例展会：用来展示「已结束」状态与已参加的报名记录。',
        exhibitorId: 'usr-2',
        exhibitorNote: '面向医院、康复机构与经销渠道',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: [],
      },
      {
        // 管理员主办的「仅展示」展会：不开放报名。
        id: 'exh-11',
        title: '国际绿色建筑与节能技术展',
        venue: '南京国际博览中心 3 号馆',
        time: '09:00-17:00',
        dayOffset: 95,
        endOffset: null,
        status: 'display',
        category: '新材料',
        description: '绿色建材、光伏建筑一体化与低碳园区案例展示。',
        exhibitorId: 'usr-1',
        exhibitorNote: '仅展示，不开放报名',
        registrationNotice: '',
        registerFrom: null,
        registerTo: null,
        qrEnabled: false,
        allowCancel: true,
        fields: [],
      },
    ];
    for (const item of exhibitions) {
      await client.query(
        `
                INSERT INTO exhibitions (id, title, venue, time, exhibition_date, exhibition_end_date,
                    status, category, description, description_format, exhibitor_note, registration_notice,
                    registration_start, registration_end, qr_enabled, allow_cancel, exhibitor_id)
                VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int,
                    CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END,
                    $7, $8, $9, 'md', $10, $11,
                    CASE WHEN $12::int IS NULL THEN NULL ELSE CURRENT_DATE + $12::int END,
                    CASE WHEN $13::int IS NULL THEN NULL ELSE CURRENT_DATE + $13::int END,
                    $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, venue = EXCLUDED.venue, time = EXCLUDED.time,
                    exhibition_date = EXCLUDED.exhibition_date,
                    exhibition_end_date = EXCLUDED.exhibition_end_date,
                    status = EXCLUDED.status, category = EXCLUDED.category,
                    description = EXCLUDED.description, description_format = EXCLUDED.description_format,
                    exhibitor_note = EXCLUDED.exhibitor_note,
                    registration_notice = EXCLUDED.registration_notice,
                    registration_start = EXCLUDED.registration_start,
                    registration_end = EXCLUDED.registration_end,
                    qr_enabled = EXCLUDED.qr_enabled, allow_cancel = EXCLUDED.allow_cancel,
                    exhibitor_id = EXCLUDED.exhibitor_id,
                    updated_at = now()
            `,
        [
          item.id,
          item.title,
          item.venue,
          item.time,
          item.dayOffset,
          item.endOffset,
          item.status,
          item.category,
          item.description,
          item.exhibitorNote,
          item.registrationNotice,
          item.registerFrom,
          item.registerTo,
          item.qrEnabled,
          item.allowCancel,
          item.exhibitorId,
        ],
      );
    }
    console.log(`示例展会就绪（${exhibitions.length} 场，日期相对今天生成）`);

    // 示例展会的报名收集项：**只写在这里**，是给演示用的数据。
    // 展会本身没有「默认收集项」这回事 —— 展商新建展会时没填收集项，报名页就是空的。
    // 按存在性跳过：重复执行不会重复插入，也不会覆盖演示中改过的收集项。
    let fieldCount = 0;
    for (const exhibition of exhibitions) {
      if (exhibition.fields.length === 0) {
        continue;
      }
      const existing = await client.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM exhibition_fields WHERE exhibition_id = $1',
        [exhibition.id],
      );
      if ((existing.rows[0]?.total ?? 0) > 0) {
        continue;
      }
      for (const [index, field] of exhibition.fields.entries()) {
        await client.query(
          `
                    INSERT INTO exhibition_fields (id, exhibition_id, title, type, required, options, position)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [
            `field-${exhibition.id}-${index + 1}`,
            exhibition.id,
            field.title,
            field.type,
            field.required,
            JSON.stringify(field.options),
            index,
          ],
        );
        fieldCount += 1;
      }
    }
    console.log(`示例报名收集项就绪（本次补 ${fieldCount} 项）`);

    // 报名：覆盖待审核 / 已通过 / 已拒绝 / 已撤销 / 已参加五种状态；
    // 多天展会的报名带参加时间段（attendance_start / attendance_end），
    // 已参加的带核销时间（check_in_time）。管理员本人也有一条报名（exh-10）。
    const registrations: SeedRegistration[] = [
      {
        id: 'reg-1',
        exhibitionId: 'exh-1',
        visitorId: 'usr-3',
        visitorName: '张伟',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：张伟\n参观身份：专业观众\n报名需求：希望安排展商洽谈',
        status: 'approved',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-2',
        exhibitionId: 'exh-1',
        visitorId: 'usr-2',
        visitorName: '李娜',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：李娜\n参观身份：采购负责人',
        status: 'approved',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-3',
        exhibitionId: 'exh-2',
        visitorId: 'usr-3',
        visitorName: '王磊',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：王磊',
        status: 'pending',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        // 管理员主办的 exh-5：待审核，带参加时间段。
        id: 'reg-4',
        exhibitionId: 'exh-5',
        visitorId: 'usr-5',
        visitorName: '方启明',
        visitorType: '专业观众',
        answers:
          '姓名 / 公司名称：方启明\n参观身份：专业观众\n报名需求：希望安排展商洽谈、需要停车位\n公司规模：51-200 人',
        status: 'pending',
        attendanceStart: 61,
        attendanceEnd: 62,
        checkInHoursAgo: null,
      },
      {
        // 已通过 + 启用二维码：详情页能看到报名码。
        id: 'reg-5',
        exhibitionId: 'exh-5',
        visitorId: 'usr-6',
        visitorName: '陈嘉禾',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：陈嘉禾\n参观身份：采购负责人\n报名需求：需要翻译服务\n公司规模：200 人以上',
        status: 'approved',
        attendanceStart: 60,
        attendanceEnd: 61,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-6',
        exhibitionId: 'exh-5',
        visitorId: 'usr-7',
        visitorName: '高远',
        visitorType: '媒体',
        answers: '姓名 / 公司名称：高远\n参观身份：媒体\n报名需求：未填写\n公司规模：1-50 人',
        status: 'rejected',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-7',
        exhibitionId: 'exh-5',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：秦岚\n参观身份：专业观众\n报名需求：需要停车位\n公司规模：1-50 人',
        status: 'cancelled',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        // 管理员本人的报名：exh-10 今天结束，状态是已参加并带核销时间。
        id: 'reg-8',
        exhibitionId: 'exh-10',
        visitorId: 'usr-1',
        visitorName: 'demo',
        visitorType: '管理员',
        answers: '',
        status: 'attended',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: 3,
      },
      {
        id: 'reg-9',
        exhibitionId: 'exh-10',
        visitorId: 'usr-5',
        visitorName: '方启明',
        visitorType: '专业观众',
        answers: '',
        status: 'attended',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: 2,
      },
      {
        // 第二个展商主办的 exh-6：已通过，多天展会选了参加时间段。
        id: 'reg-10',
        exhibitionId: 'exh-6',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：秦岚\n参观身份：采购负责人',
        status: 'approved',
        attendanceStart: 71,
        attendanceEnd: 72,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-11',
        exhibitionId: 'exh-6',
        visitorId: 'usr-7',
        visitorName: '高远',
        visitorType: '专业观众',
        answers: '姓名 / 公司名称：高远\n参观身份：专业观众',
        status: 'pending',
        attendanceStart: 72,
        attendanceEnd: 73,
        checkInHoursAgo: null,
      },
      {
        // 不设报名窗口的 exh-9：没有收集项，答案为空。
        id: 'reg-12',
        exhibitionId: 'exh-9',
        visitorId: 'usr-5',
        visitorName: '方启明',
        visitorType: '专业观众',
        answers: '',
        status: 'pending',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
      {
        id: 'reg-13',
        exhibitionId: 'exh-8',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        visitorType: '采购负责人',
        answers: '姓名 / 公司名称：秦岚\n参观身份：采购负责人\n采购意向：寻找供应商、商务洽谈',
        status: 'pending',
        attendanceStart: null,
        attendanceEnd: null,
        checkInHoursAgo: null,
      },
    ];
    for (const item of registrations) {
      // 示例报名和真实报名一样带核销凭据（建记录时就生成）。
      // 已有凭据的行保留原值：重复 seed 不会把演示用的二维码换掉。
      const secret = labels.newCheckInSecret();
      await client.query(
        `
                INSERT INTO registrations (id, exhibition_id, visitor_id, visitor_name, visitor_type,
                    answers, status, attendance_start, attendance_end, check_in_time, check_in_secret)
                VALUES ($1, $2, $3, $4, $5, $6, $7,
                    CASE WHEN $8::int IS NULL THEN NULL ELSE CURRENT_DATE + $8::int END,
                    CASE WHEN $9::int IS NULL THEN NULL ELSE CURRENT_DATE + $9::int END,
                    CASE WHEN $10::int IS NULL THEN NULL ELSE now() - make_interval(hours => $10::int) END,
                    $11)
                ON CONFLICT (id) DO UPDATE SET
                    visitor_name = EXCLUDED.visitor_name,
                    visitor_type = EXCLUDED.visitor_type,
                    answers = EXCLUDED.answers,
                    status = EXCLUDED.status,
                    attendance_start = EXCLUDED.attendance_start,
                    attendance_end = EXCLUDED.attendance_end,
                    check_in_time = EXCLUDED.check_in_time,
                    check_in_secret = CASE
                        WHEN registrations.check_in_secret = '' THEN EXCLUDED.check_in_secret
                        ELSE registrations.check_in_secret
                    END,
                    updated_at = now()
            `,
        [
          item.id,
          item.exhibitionId,
          item.visitorId,
          item.visitorName,
          item.visitorType,
          item.answers,
          item.status,
          item.attendanceStart,
          item.attendanceEnd,
          item.checkInHoursAgo,
          secret,
        ],
      );
    }
    console.log(`示例报名就绪（${registrations.length} 条）`);

    // 私人会议：四种状态都有，日期都在今天之后。全部挂在第二个展商名下，
    // 管理员与 exhibitor 的收件箱保持为空（契约测试依赖这个初始状态）。
    const meetings: SeedMeeting[] = [
      {
        id: 'meet-1',
        exhibitorId: 'usr-5',
        visitorId: 'usr-3',
        visitorName: 'user',
        dayOffset: 3,
        time: '10:30',
        answers: '来意：想了解贵司的展会合作方式\n希望形式：线下面谈',
        status: 'pending',
      },
      {
        id: 'meet-2',
        exhibitorId: 'usr-5',
        visitorId: 'usr-6',
        visitorName: '陈嘉禾',
        dayOffset: 5,
        time: '14:00',
        answers: '来意：采购对接\n希望形式：线上会议',
        status: 'approved',
      },
      {
        id: 'meet-3',
        exhibitorId: 'usr-5',
        visitorId: 'usr-7',
        visitorName: '高远',
        dayOffset: 6,
        time: '09:30',
        answers: '来意：媒体采访安排\n希望形式：线下面谈',
        status: 'rejected',
      },
      {
        id: 'meet-4',
        exhibitorId: 'usr-5',
        visitorId: 'usr-8',
        visitorName: '秦岚',
        dayOffset: 7,
        time: '',
        answers: '来意：展位合作沟通\n希望形式：线上会议',
        status: 'cancelled',
      },
    ];
    for (const item of meetings) {
      const existing = await client.query('SELECT id FROM private_meetings WHERE id = $1', [item.id]);
      if (existing.rowCount) {
        // 固定 id 已存在：日期跟着种子重新算，状态回到期望值。
        await client.query(
          `
                    UPDATE private_meetings
                       SET visitor_id = $2, visitor_name = $3, meeting_date = CURRENT_DATE + $4::int,
                           meeting_time = $5, answers = $6, status = $7, updated_at = now()
                     WHERE id = $1
                `,
          [item.id, item.visitorId, item.visitorName, item.dayOffset, item.time, item.answers, item.status],
        );
        continue;
      }
      // 同一访客对同一主办人同一天只能有一条待审核 / 已通过的申请（库里是唯一索引）。
      // 演示时可能已经约过一次，这种现场数据不去撞它，直接跳过。
      const conflicting = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM private_meetings
          WHERE exhibitor_id = $1 AND visitor_id = $2
            AND meeting_date = CURRENT_DATE + $3::int AND status IN ('pending', 'approved')`,
        [item.exhibitorId, item.visitorId, item.dayOffset],
      );
      if ((conflicting.rows[0]?.total ?? 0) > 0) {
        continue;
      }
      await client.query(
        `
                INSERT INTO private_meetings
                    (id, exhibitor_id, visitor_id, visitor_name, meeting_date, meeting_time, answers, status)
                VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8)
            `,
        [
          item.id,
          item.exhibitorId,
          item.visitorId,
          item.visitorName,
          item.dayOffset,
          item.time,
          item.answers,
          item.status,
        ],
      );
    }
    console.log(`示例私人会议就绪（${meetings.length} 个）`);

    // 第二个展商的会议收集项：申请页按这里的顺序渲染；按存在性跳过，不覆盖演示中的改动。
    const meetingFields: SeedField[] = [
      { title: '来意', type: 'text', required: true, options: [] },
      { title: '希望形式', type: 'radio', required: true, options: ['线下面谈', '线上会议'] },
    ];
    const meetingFieldExisting = await client.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM meeting_fields WHERE exhibitor_id = $1',
      ['usr-5'],
    );
    if ((meetingFieldExisting.rows[0]?.total ?? 0) === 0) {
      for (const [index, field] of meetingFields.entries()) {
        await client.query(
          `
                    INSERT INTO meeting_fields (id, exhibitor_id, title, type, required, options, position)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [
            `mfield-usr-5-${index + 1}`,
            'usr-5',
            field.title,
            field.type,
            field.required,
            JSON.stringify(field.options),
            index,
          ],
        );
      }
    }
    console.log('示例会议收集项就绪');

    // 邀请码：固定 code 便于演示；重复执行时把次数与有效期恢复成期望值。
    const invites: SeedInvite[] = [
      { id: 'inv-demo', code: 'DEMOEXPO', maxUses: 10, durationDays: 0, validDays: null },
      { id: 'inv-demo-trial', code: 'TRIAL30', maxUses: 5, durationDays: 30, validDays: 30 },
    ];
    for (const item of invites) {
      await client.query(
        `
                INSERT INTO exhibitor_invites (id, code, max_uses, used_count, duration_days, expires_at, created_by)
                VALUES ($1, $2, $3, 0, $4,
                    CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END, 'usr-1')
                ON CONFLICT (id) DO UPDATE SET
                    code = EXCLUDED.code,
                    max_uses = EXCLUDED.max_uses,
                    used_count = 0,
                    duration_days = EXCLUDED.duration_days,
                    expires_at = EXCLUDED.expires_at,
                    revoked_at = NULL,
                    created_by = EXCLUDED.created_by
            `,
        [item.id, item.code, item.maxUses, item.durationDays, item.validDays],
      );
    }
    console.log(`示例邀请码就绪（${invites.length} 枚，code 固定）`);

    // 通知偏好：给演示账号各存一份，个人页打开就是配置过的样子。
    const notificationPreferences: { userId: string; exhibitionReminder: boolean; registrationUpdates: boolean }[] = [
      { userId: 'usr-5', exhibitionReminder: true, registrationUpdates: true },
      { userId: 'usr-6', exhibitionReminder: false, registrationUpdates: true },
      { userId: 'usr-7', exhibitionReminder: false, registrationUpdates: false },
    ];
    for (const item of notificationPreferences) {
      await client.query(
        `
                INSERT INTO notification_preferences (user_id, exhibition_reminder, registration_updates, updated_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (user_id) DO UPDATE SET
                    exhibition_reminder = EXCLUDED.exhibition_reminder,
                    registration_updates = EXCLUDED.registration_updates,
                    updated_at = now()
            `,
        [item.userId, item.exhibitionReminder, item.registrationUpdates],
      );
    }
    console.log('示例通知偏好就绪');

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
