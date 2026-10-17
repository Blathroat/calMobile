/**
 * 共享 SQL 片段。
 *
 * 展会的读取列在这里定义一次：年 / 月 / 日从 `exhibition_date` 派生（不再各存一份，
 * 避免日期和年月日互相漂移），日期一律用 `to_char` 取成 `YYYY-MM-DD` 字符串，
 * 不让 driver 把它当本地时间的 Date 对象传出来（时区一换就会差一天）。
 */

/** 展会：字段 + 展商昵称 + 报名数 + 收集项数。 */
export const EXHIBITION_COLUMNS = `
    e.id, e.title, e.venue, e.time, e.category, e.description, e.description_format,
    e.image_uri, e.exhibitor_note, e.qr_enabled, e.allow_cancel, e.exhibitor_id, e.status,
    to_char(e.exhibition_date, 'YYYY-MM-DD')                AS exhibition_date,
    EXTRACT(YEAR FROM e.exhibition_date)::int               AS year,
    EXTRACT(MONTH FROM e.exhibition_date)::int              AS month,
    EXTRACT(DAY FROM e.exhibition_date)::int                AS day,
    to_char(e.registration_start, 'YYYY-MM-DD')             AS registration_start,
    to_char(e.registration_end, 'YYYY-MM-DD')             AS registration_end,
    COALESCE(u.nickname, '')                                AS exhibitor,
    COALESCE(u.role, '')                                    AS exhibitor_role,
    (SELECT count(*)::int FROM registrations r
      WHERE r.exhibition_id = e.id AND r.status <> 'cancelled')  AS registration_count,
    (SELECT count(*)::int FROM exhibition_fields f
      WHERE f.exhibition_id = e.id)                              AS field_count
`;

export const EXHIBITION_FROM = `
    FROM exhibitions e
    LEFT JOIN users u ON u.id = e.exhibitor_id
`;

/** 报名：字段 + 展会信息（报名表不冗余展会标题，改期后不会两边不一致）。 */
export const REGISTRATION_COLUMNS = `
    r.id, r.exhibition_id, r.visitor_id, r.visitor_name, r.visitor_type, r.answers,
    r.status, r.check_in_time, r.check_in_secret, r.created_at,
    e.title                 AS exhibition_title,
    e.venue                 AS exhibition_venue,
    e.time                  AS exhibition_time,
    e.qr_enabled            AS exhibition_qr_enabled,
    e.allow_cancel          AS exhibition_allow_cancel,
    e.exhibitor_id          AS exhibition_exhibitor_id,
    EXTRACT(DAY FROM e.exhibition_date)::int    AS exhibition_day,
    EXTRACT(MONTH FROM e.exhibition_date)::int  AS exhibition_month,
    EXTRACT(YEAR FROM e.exhibition_date)::int   AS exhibition_year,
    to_char(e.exhibition_date, 'YYYY-MM-DD')    AS exhibition_date
`;

export const REGISTRATION_FROM = `
    FROM registrations r
    JOIN exhibitions e ON e.id = r.exhibition_id
`;

/** 用户：对外字段（绝不带 password_hash）。 */
export const USER_COLUMNS = `
    u.id, u.username, u.email, u.nickname, u.role, u.status, u.bio, u.region,
    u.avatar, u.social_media, u.show_registrations, u.seen_hints, u.accept_meetings,
    u.email_verified, u.two_factor_enabled,
    to_char(u.registration_time, 'YYYY-MM-DD')  AS registration_time,
    to_char(u.last_login_time, 'YYYY-MM-DD')    AS last_login_time
`;

export const USER_FROM = ' FROM users u ';
