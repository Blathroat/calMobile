/**
 * 迁移步骤 0010-0019：会话与可信设备、安全复核、私人会议、邀请码、报名核销凭据、
 * 展商期限、收集项类型与通行密钥。
 *
 * 步骤按 id 从小到大排列；id、顺序、SQL 与注释都是已发布内容，不要改，新增步骤追加到末尾。
 */

import type { MigrationStep } from './types.js';

/** 本模块的迁移步骤。 */
export const STEPS: readonly MigrationStep[] = [
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
];
