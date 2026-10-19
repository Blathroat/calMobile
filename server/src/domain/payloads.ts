/**
 * 数据库行 → 接口响应。
 *
 * 前端页面直接消费这些结构（见 `docs/engineering.md`「系统边界」），字段名与页面读取的
 * 保持一致，因此换实现不需要改页面。映射集中在这里，路由只负责取数与校验。
 */

import * as labels from './labels.js';
import { isPastExpiry } from './membership.js';
import type { Capabilities } from './permissions.js';

/** 时间戳（Date 或 ISO 字符串）→ ISO 字符串；空值返回空串。 */
function isoTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export interface ExhibitionRow {
  id: string;
  title: string;
  venue: string;
  time: string;
  category?: string | null;
  description?: string | null;
  description_format?: string | null;
  status: string;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  exhibition_date?: string | null;
  exhibitor?: string | null;
  exhibitor_role?: string | null;
  exhibitor_note?: string | null;
  image_uri?: string | null;
  registration_start?: string | null;
  registration_end?: string | null;
  qr_enabled?: boolean | null;
  allow_cancel?: boolean | null;
  exhibitor_id?: string | null;
  registration_count?: number | null;
  field_count?: number | null;
}

export interface FieldRow {
  id: string;
  title: string;
  type: string;
  required?: boolean | null;
  options?: unknown;
}

export interface RegistrationRow {
  id: string;
  exhibition_id: string;
  visitor_id?: string | null;
  exhibition_exhibitor_id?: string | null;
  exhibition_title?: string | null;
  exhibition_day?: number | null;
  exhibition_month?: number | null;
  exhibition_year?: number | null;
  exhibition_date?: string | null;
  exhibition_time?: string | null;
  exhibition_venue?: string | null;
  visitor_name: string;
  visitor_type: string;
  answers?: string | null;
  status: string;
  exhibition_qr_enabled?: boolean | null;
  exhibition_allow_cancel?: boolean | null;
  check_in_time?: string | Date | null;
  /** 可轮换的报名码凭据：退回重审后换一个，旧码随之失效。 */
  check_in_secret?: string | null;
}

export interface UserRow {
  id: string;
  role: string;
  username: string;
  nickname: string;
  email?: string | null;
  bio?: string | null;
  region?: string | null;
  social_media?: string | null;
  avatar?: string | null;
  show_registrations?: boolean | null;
  accept_meetings?: boolean | null;
  /** 已看过的一次性提示 key 列表（见 `domain/settings.ts` 的 `saveSeenHint`）。 */
  seen_hints?: string[] | null;
  status?: string | null;
  email_verified?: boolean | null;
  two_factor_enabled?: boolean | null;
  /** 限时展商的到期时间；NULL 表示永久。到期后角色会被降回普通用户。 */
  exhibitor_expires_at?: string | Date | null;
  last_login_time?: string | null;
  registration_time?: string | null;
}

export interface AdminUserRow {
  id: string;
  username: string;
  nickname: string;
  email?: string | null;
  role: string;
  avatar?: string | null;
  status?: string | null;
  email_verified?: boolean | null;
  two_factor_enabled?: boolean | null;
  exhibitor_expires_at?: string | Date | null;
  registration_time?: string | null;
  last_login_time?: string | null;
}

/** 展会行 → 列表 / 详情的展会对象。 */
export function exhibitionPayload(row: ExhibitionRow) {
  const statusCode = row.status;
  return {
    id: row.id,
    title: row.title,
    venue: row.venue,
    time: row.time,
    category: row.category || '',
    description: row.description || '',
    descriptionFormat: row.description_format === 'html' ? 'html' : 'md',
    // 兼容字段：给还没更新快照的旧页面用的中文标签，新代码读 statusCode。
    status: labels.EXHIBITION_STATUS[statusCode] || labels.EXHIBITION_STATUS.review,
    statusCode,
    mode: labels.modeOf(statusCode),
    // 兼容字段（中文），规则与前端 `modeLabel(code)` 一致。
    modeLabel: labels.modeLabel(statusCode),
    openForRegistration: labels.acceptsRegistration(statusCode),
    year: row.year,
    month: row.month,
    day: row.day,
    date: row.exhibition_date || '',
    dateLabel: labels.dateLabel(row.exhibition_date),
    exhibitor: row.exhibitor || '',
    exhibitorId: row.exhibitor_id || '',
    exhibitorRole: row.exhibitor_role || '',
    exhibitorNote: row.exhibitor_note || '',
    imageUri: row.image_uri || '',
    registrationStart: row.registration_start || '',
    registrationEnd: row.registration_end || '',
    qrEnabled: row.qr_enabled === true,
    allowCancel: row.allow_cancel !== false,
    registrationCount: Number(row.registration_count) || 0,
    fieldCount: Number(row.field_count) || 0,
  };
}

/** 收集项行 → 表单定义。 */
export function fieldPayload(row: FieldRow) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    required: row.required === true,
    options: Array.isArray(row.options) ? row.options : [],
  };
}

/**
 * 报名行 → 报名对象。
 *
 * `checkInCode` 只在「展会启用二维码」且「报名已通过 / 已参加」时下发，
 * 其余状态给空串，页面据此不渲染二维码。这是现场核销的唯一凭据，
 * 因此只在本人 / 管理员可见的路径上下发（公开页用 publicRegistrationPayload）。
 *
 * 码里带上轮换凭据 `check_in_secret`；凭据为空（老数据迁移前可能如此）时**不拼码**，
 * 否则会下发一个核销时必然被拒的码。
 */
export function registrationPayload(row: RegistrationRow) {
  const statusCode = row.status;
  const secret = String(row.check_in_secret || '');
  const codeAllowed =
    row.exhibition_qr_enabled === true && (statusCode === 'approved' || statusCode === 'attended') && secret !== '';
  return {
    id: row.id,
    exhibitionId: row.exhibition_id,
    exhibitionTitle: row.exhibition_title || '',
    exhibitionDay: Number(row.exhibition_day) || 0,
    exhibitionMonth: Number(row.exhibition_month) || 0,
    exhibitionYear: Number(row.exhibition_year) || 0,
    exhibitionDate: row.exhibition_date || '',
    exhibitionTime: row.exhibition_time || '',
    exhibitionVenue: row.exhibition_venue || '',
    visitorName: row.visitor_name,
    visitorType: row.visitor_type,
    answers: row.answers || '',
    // 兼容字段：status 与 statusLabel 都是中文标签，只给还没更新快照的旧页面；新代码读 statusCode。
    status: labels.REGISTRATION_STATUS[statusCode] || '',
    statusLabel: labels.REGISTRATION_STATUS[statusCode] || '',
    statusCode,
    qrEnabled: row.exhibition_qr_enabled === true,
    allowCancel: row.exhibition_allow_cancel !== false,
    checkInCode: codeAllowed ? labels.checkInCode(row.exhibition_id, row.id, secret) : '',
    checkInTime: row.check_in_time ? new Date(row.check_in_time).toISOString() : '',
  };
}

/**
 * 报名行 → **公开页**的报名对象（用户公开页对访客开放，见 routes/users.js）。
 *
 * 与 `registrationPayload` 唯一的差别是不下发 `checkInCode`：那是现场核销的唯一凭据，
 * 谁拿到谁就能替别人核销，只有本人与管理员可以看到。这里保留其余字段（含 `visitorName`
 * 与 `answers`），因为展示报名记录正是用户打开 `showRegistrations` 的本意；
 * `checkInTime` 不是凭据，且「已参加」这一状态本身对访客可见，因此照常给出。
 * 字段名与形状与 `registrationPayload` 一致，页面才能共用同一套渲染。
 */
export function publicRegistrationPayload(row: RegistrationRow) {
  return { ...registrationPayload(row), checkInCode: '' };
}

/**
 * 用户行 → 前端需要的用户态。
 *
 * `can` 是页面与路由共用的权限判定结果（见 domain/permissions.ts），
 * 这里只做字段拼装，不重复判断角色。
 */
export function userPayload(row: UserRow, can: Capabilities) {
  return {
    loggedIn: true,
    guest: false,
    id: row.id,
    role: row.role,
    // 兼容字段：中文角色标签，只给还没更新快照的旧页面；新代码读上面的 role（本身就是 code）。
    roleLabel: labels.ROLE_LABEL[row.role] || labels.ROLE_LABEL.user,
    username: row.username,
    nickname: row.nickname,
    email: row.email || '',
    bio: row.bio || '',
    region: row.region || '',
    socialMedia: row.social_media || '',
    avatar: row.avatar || '',
    showRegistrations: row.show_registrations === true,
    // 一次性提示的已读列表：与账号绑定，前端据此决定提示是否还显示
    seenHints: Array.isArray(row.seen_hints) ? row.seen_hints : [],
    status: labels.USER_STATUS[row.status || ''] || labels.USER_STATUS.active || '',
    statusCode: row.status || 'active',
    // 邮箱验证状态与两步验证开关：个人页「安全」区与用户管理都看这两个字段
    emailVerified: row.email_verified === true,
    twoFactorEnabled: row.two_factor_enabled === true,
    // 展商时长：空串表示永久；到期后角色已降为普通用户，但保留时间用于说明「已到期」
    exhibitorExpiresAt: isoTime(row.exhibitor_expires_at),
    exhibitorExpired: isPastExpiry(row.exhibitor_expires_at),
    lastLoginTime: row.last_login_time || '',
    registrationTime: row.registration_time || '',
    can,
  };
}

/** 未登录（访客）时的用户态，字段与 userPayload 对齐。 */
export function guestPayload() {
  return {
    loggedIn: false,
    guest: true,
    role: 'guest',
    roleLabel: labels.ROLE_LABEL.guest,
    username: '',
    nickname: '',
    email: '',
    bio: '',
    region: '',
    socialMedia: '',
    avatar: '',
    showRegistrations: false,
    // 访客没有账号状态：status 与 statusCode 都是空串（词表里只有 active / limited / banned）。
    status: '',
    statusCode: '',
    lastLoginTime: '',
    registrationTime: '',
    exhibitorExpiresAt: '',
    exhibitorExpired: false,
    can: { register: false, profile: false, exhibitor: false, admin: false, limited: false },
  };
}

/** 管理员用户列表里的一行：与 `users.list` 的字段一致。 */
export function adminUserPayload(row: AdminUserRow, index: number) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email || '',
    avatar: row.avatar || '',
    // role 与 roleCode 都是 code（协议值）；roleLabel 是兼容字段，给还没更新快照的旧页面。
    role: row.role,
    roleLabel: labels.ROLE_LABEL[row.role] || row.role,
    roleCode: row.role,
    // status 是兼容字段（中文）；新代码读 statusCode。
    status: labels.USER_STATUS[row.status || ''] || labels.USER_STATUS.active || '',
    statusCode: row.status || 'active',
    // 管理员据此决定要不要显示「关闭两步验证」这个兜底入口
    emailVerified: row.email_verified === true,
    twoFactorEnabled: row.two_factor_enabled === true,
    exhibitorExpiresAt: isoTime(row.exhibitor_expires_at),
    exhibitorExpired: isPastExpiry(row.exhibitor_expires_at),
    registrationTime: row.registration_time || '',
    lastLoginTime: row.last_login_time || '',
    order: index,
  };
}
