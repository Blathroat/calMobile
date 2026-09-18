/**
 * 数据库行 → 接口响应。
 *
 * 前端页面直接消费这些结构（见根目录 README「前后端边界」），字段名与页面读取的
 * 保持一致，因此换实现不需要改页面。映射集中在这里，路由只负责取数与校验。
 */

const labels = require('./labels');

/** 展会行 → 列表 / 详情的展会对象。 */
function exhibitionPayload(row) {
  const statusCode = row.status;
  return {
    id: row.id,
    title: row.title,
    venue: row.venue,
    time: row.time,
    category: row.category || '',
    description: row.description || '',
    descriptionFormat: row.description_format === 'html' ? 'html' : 'md',
    status: labels.EXHIBITION_STATUS[statusCode] || labels.EXHIBITION_STATUS.review,
    mode: labels.modeOf(statusCode),
    modeLabel: labels.modeLabel(statusCode),
    openForRegistration: labels.acceptsRegistration(statusCode),
    year: row.year,
    month: row.month,
    day: row.day,
    date: row.exhibition_date || '',
    dateLabel: labels.dateLabel(row.exhibition_date),
    exhibitor: row.exhibitor || '',
    exhibitorNote: row.exhibitor_note || '',
    highlights: Array.isArray(row.highlights) ? row.highlights : [],
    imageUri: row.image_uri || '',
    registrationStart: row.registration_start || '',
    registrationEnd: row.registration_end || '',
    qrEnabled: row.qr_enabled === true,
    registrationCount: Number(row.registration_count) || 0,
    fieldCount: Number(row.field_count) || 0,
  };
}

/** 收集项行 → 表单定义。 */
function fieldPayload(row) {
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
 */
function registrationPayload(row) {
  const statusCode = row.status;
  const codeAllowed = row.exhibition_qr_enabled === true
        && (statusCode === 'approved' || statusCode === 'attended');
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
    status: labels.REGISTRATION_STATUS[statusCode] || '',
    statusLabel: labels.REGISTRATION_STATUS[statusCode] || '',
    qrEnabled: row.exhibition_qr_enabled === true,
    checkInCode: codeAllowed ? labels.checkInCode(row.exhibition_id, row.id) : '',
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
function publicRegistrationPayload(row) {
  return { ...registrationPayload(row), checkInCode: '' };
}

/**
 * 用户行 → 前端需要的用户态。
 *
 * `can` 是页面与路由共用的权限判定结果（见 domain/permissions.js），
 * 这里只做字段拼装，不重复判断角色。
 */
function userPayload(row, can) {
  return {
    loggedIn: true,
    guest: false,
    role: row.role,
    roleLabel: labels.ROLE_LABEL[row.role] || labels.ROLE_LABEL.user,
    username: row.username,
    nickname: row.nickname,
    email: row.email || '',
    bio: row.bio || '',
    region: row.region || '',
    socialMedia: row.social_media || '',
    avatar: row.avatar || '',
    showRegistrations: row.show_registrations === true,
    status: labels.USER_STATUS[row.status] || labels.USER_STATUS.active,
    lastLoginTime: row.last_login_time || '',
    registrationTime: row.registration_time || '',
    can,
  };
}

/** 未登录（访客）时的用户态，字段与 userPayload 对齐。 */
function guestPayload() {
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
    status: '',
    lastLoginTime: '',
    registrationTime: '',
    can: { register: false, profile: false, exhibitor: false, admin: false },
  };
}

/** 管理员用户列表里的一行：与 `users.list` 的字段一致。 */
function adminUserPayload(row, index) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email || '',
    role: labels.ROLE_LABEL[row.role] || row.role,
    roleCode: row.role,
    status: labels.USER_STATUS[row.status] || labels.USER_STATUS.active,
    registrationTime: row.registration_time || '',
    lastLoginTime: row.last_login_time || '',
    order: index,
  };
}

module.exports = {
  exhibitionPayload,
  fieldPayload,
  registrationPayload,
  publicRegistrationPayload,
  userPayload,
  guestPayload,
  adminUserPayload,
};
