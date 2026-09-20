/**
 * 数据库迁移与示例数据。
 *
 * 迁移按步骤编号记录在 `schema_migrations` 表里，只跑没跑过的步骤，
 * 因此可以反复执行（`npm run db:migrate` 是幂等的），新增字段时往后追加一步即可，
 * 不要去改已经发布过的步骤。
 *
 * 约定：
 * - 状态一律存**英文代码**（pending / approved / review / optional …），
 *   中文标签只在 `src/domain/labels.js` 里映射一次；
 * - 展会日期只存 `exhibition_date`，年 / 月 / 日由 SQL 派生，避免三者互相漂移；
 * - 报名记录不冗余展会标题、时间、地点，读取时 JOIN 展会表，避免展会改期后两边不一致。
 */

const { pool } = require('./pool');

/** 迁移步骤：id 一旦发布就不要改内容，只能追加新步骤。 */
const STEPS = [
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
];

const DEFAULT_SETTINGS = {
  theme: { index: 0, colors: ['#C05621', '#48515D', '#245D3C', '#2F6F8F'] },
  ui: { mode: 'auto' },
  capabilities: { calendar: false, notifications: false, richText: true, export: true },
  categories: ['智能家居', '物流技术', '医疗健康', '新材料'],
  review: { canRevise: false, statuses: ['待审核', '已通过', '已拒绝'] },
  media: { imageCount: 8, imageSizeMb: 10, videoCount: 2, videoSizeMb: 50 },
  upload: { avatarSizeMb: 2, imageFormats: ['jpg', 'jpeg', 'png', 'webp'], videoFormats: ['mp4', 'mov', 'webm'] },
  limits: {
    exhibitionTitle: 60, exhibitionVenue: 60, category: 20, fieldTitle: 30,
    usernameMin: 3, usernameMax: 20, passwordMin: 6, passwordMax: 32,
    nickname: 20, bio: 200, region: 40, answer: 200,
  },
  announcement: { enabled: false, text: '' },
  brand: { zh: '发现展会', en: 'ExpoHub' },
};

/** 创建迁移记录表，返回已应用的步骤 id。 */
async function appliedSteps(client) {
  await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id          TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
  const result = await client.query('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
}

/** 执行未应用的迁移步骤；每一步各自一个事务，失败即回滚。 */
async function migrate() {
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
        await client.query(step.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [step.id]);
        await client.query('COMMIT');
        console.log(`迁移完成：${step.id}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`迁移失败：${step.id}`, error.message);
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

/** 示例数据：账号、展会（含收集项）、报名、服务器设置。可重复执行。 */
async function seed() {
  const bcrypt = require('bcryptjs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash('password', 10);
    const accounts = [
      ['usr-1', 'demo', 'demo@example.com', 'demo', 'admin', ''],
      ['usr-2', 'exhibitor', 'exhibitor@example.com', 'exhibitor', 'exhibitor', ''],
      ['usr-3', 'user', 'user@example.com', 'user', 'user', '展会常客，关注智能家居与新材料。'],
    ];
    for (const [id, username, email, nickname, role, bio] of accounts) {
      await client.query(`
                INSERT INTO users (id, username, password_hash, email, nickname, role, bio)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    username = EXCLUDED.username,
                    email = EXCLUDED.email,
                    nickname = EXCLUDED.nickname,
                    role = EXCLUDED.role,
                    updated_at = now()
            `, [id, username, passwordHash, email, nickname, role, bio]);
    }
    console.log(`示例账号就绪（${accounts.length} 个，密码均为 password）`);

    // 示例展会的日期**相对今天**生成：写死日期的示例数据过一阵就会全部过期，
    // 报名窗口规则一上线，演示里就再也报不上名了。偏移量以天为单位。
    const exhibitions = [
      {
        id: 'exh-1', title: '华南智能家居展', venue: '深圳会展中心 3 号馆', time: '09:00-17:30',
        dayOffset: 7, status: 'optional', category: '智能家居',
        description: '# 展会亮点\n\n- 智能门锁与全屋方案\n- 节能家电现场体验',
        highlights: ['智能门锁', '全屋方案', '节能家电'],
        registerFrom: -14, registerTo: 3,
        qrEnabled: true, exhibitorId: 'usr-2', note: '面向渠道商与终端用户',
      },
      {
        id: 'exh-2', title: '大湾区物流技术展', venue: '广州琶洲展馆 C 区', time: '10:00-18:00',
        dayOffset: 14, status: 'review', category: '物流技术',
        description: 'AGV、仓储机器人与冷链物流方案。',
        highlights: ['AGV', '仓储机器人'],
        registerFrom: -7, registerTo: 10,
        qrEnabled: false, exhibitorId: 'usr-2', note: '面向制造业与物流企业',
      },
      {
        id: 'exh-3', title: '数字健康峰会', venue: '上海国家会展中心', time: '09:30-16:00',
        dayOffset: 21, status: 'closed', category: '医疗健康',
        description: '医疗 AI、远程诊疗和穿戴设备专题。',
        highlights: ['医疗 AI', '穿戴设备'],
        registerFrom: -30, registerTo: -1,
        qrEnabled: false, exhibitorId: 'usr-2', note: '面向医疗机构与设备厂商',
      },
      {
        id: 'exh-4', title: '国际新材料展', venue: '北京国家会议中心', time: '09:00-17:00',
        dayOffset: 45, status: 'display', category: '新材料',
        description: '碳纤维、石墨烯和可降解材料展示。',
        highlights: ['碳纤维', '石墨烯'],
        registerFrom: null, registerTo: null,
        qrEnabled: false, exhibitorId: 'usr-2', note: '面向研发与采购',
      },
    ];
    for (const item of exhibitions) {
      await client.query(`
                INSERT INTO exhibitions (id, title, venue, time, exhibition_date, status, category,
                    description, description_format, highlights, exhibitor_note,
                    registration_start, registration_end, qr_enabled, exhibitor_id)
                VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8, 'md', $9, $10,
                    CASE WHEN $11::int IS NULL THEN NULL ELSE CURRENT_DATE + $11::int END,
                    CASE WHEN $12::int IS NULL THEN NULL ELSE CURRENT_DATE + $12::int END,
                    $13, $14)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, venue = EXCLUDED.venue, time = EXCLUDED.time,
                    exhibition_date = EXCLUDED.exhibition_date, status = EXCLUDED.status,
                    category = EXCLUDED.category, description = EXCLUDED.description,
                    highlights = EXCLUDED.highlights, exhibitor_note = EXCLUDED.exhibitor_note,
                    registration_start = EXCLUDED.registration_start,
                    registration_end = EXCLUDED.registration_end,
                    qr_enabled = EXCLUDED.qr_enabled, exhibitor_id = EXCLUDED.exhibitor_id,
                    updated_at = now()
            `, [item.id, item.title, item.venue, item.time, item.dayOffset, item.status, item.category,
        item.description, JSON.stringify(item.highlights), item.note,
        item.registerFrom, item.registerTo, item.qrEnabled, item.exhibitorId]);
    }
    console.log(`示例展会就绪（${exhibitions.length} 场，日期相对今天生成）`);

    // 默认报名收集项：与 routes/exhibitions.js 的 DEFAULT_FIELDS 同一份取值
    // （那边是「展会没有配置收集项时页面与提交校验用的默认值」）。
    const fields = [
      ['姓名 / 公司名称', '文本', true, []],
      ['参观身份', '单选', true, ['专业观众', '采购负责人', '媒体']],
      ['报名需求', '多选', false, ['希望安排展商洽谈', '需要停车位', '需要翻译服务']],
    ];
    for (const exhibition of exhibitions) {
      const existing = await client.query(
        'SELECT count(*)::int AS total FROM exhibition_fields WHERE exhibition_id = $1',
        [exhibition.id],
      );
      if (existing.rows[0].total > 0) {
        continue;
      }
      for (const [index, [title, type, required, options]] of fields.entries()) {
        await client.query(`
                    INSERT INTO exhibition_fields (id, exhibition_id, title, type, required, options, position)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [`field-${exhibition.id}-${index + 1}`, exhibition.id, title, type, required,
          JSON.stringify(options), index]);
      }
    }
    console.log('示例报名收集项就绪');

    const registrations = [
      ['reg-1', 'exh-1', 'usr-3', '张伟', '专业观众', '姓名 / 公司名称：张伟\n参观身份：专业观众\n报名需求：希望安排展商洽谈', 'approved'],
      ['reg-2', 'exh-1', 'usr-2', '李娜', '采购负责人', '姓名 / 公司名称：李娜\n参观身份：采购负责人', 'approved'],
      ['reg-3', 'exh-2', 'usr-3', '王磊', '专业观众', '姓名 / 公司名称：王磊', 'pending'],
    ];
    for (const [id, exhibitionId, visitorId, name, type, answers, status] of registrations) {
      await client.query(`
                INSERT INTO registrations (id, exhibition_id, visitor_id, visitor_name, visitor_type, answers, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    visitor_name = EXCLUDED.visitor_name,
                    visitor_type = EXCLUDED.visitor_type,
                    answers = EXCLUDED.answers,
                    status = EXCLUDED.status,
                    updated_at = now()
            `, [id, exhibitionId, visitorId, name, type, answers, status]);
    }
    console.log(`示例报名就绪（${registrations.length} 条）`);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await client.query(`
                INSERT INTO app_settings (key, value) VALUES ($1, $2)
                ON CONFLICT (key) DO NOTHING
            `, [key, JSON.stringify(value)]);
    }
    console.log('服务器设置默认值就绪');

    await client.query('COMMIT');
    console.log('示例数据插入完成');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('示例数据插入失败：', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const command = process.argv[2];
  const run = command === 'seed' ? seed : command === 'migrate' ? migrate : null;
  if (!run) {
    console.log('用法：node src/config/migrate.js [migrate|seed]');
    process.exit(1);
  }
  run()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  migrate,
  seed,
  DEFAULT_SETTINGS,
  STEPS,
};
