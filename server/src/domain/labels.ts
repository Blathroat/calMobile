/**
 * 状态词汇表：数据库里存英文代码，对外只讲中文标签。
 *
 * 中文标签是与前端（`assets/web/js/core/status.js`）约定的同一批字符串，
 * 前端按值比较，因此这里的映射是**接口契约**，改动必须两处同时改。
 *
 * 这样做的好处：数据库里筛选、统计、加约束都用稳定的英文代码，
 * 不会因为文案调整而牵动数据。
 */

/** 展会报名方式 / 报名状态：code ↔ 中文标签。 */
export const EXHIBITION_STATUS: Record<string, string> = {
  review: '需审核',
  optional: '无需审核',
  display: '仅展示',
  closed: '截止报名',
  ended: '已结束',
};

/** 展会收集项类型：数据库约束与前端表单都使用这三种中文值。 */
export const EXHIBITION_FIELD_TYPES = ['文本', '单选', '多选'] as const;
export const EXHIBITION_STATUS_HINT = `报名方式只能是 ${Object.values(EXHIBITION_STATUS).join(' / ')}`;

/** 报名审核状态：code ↔ 中文标签。 */
export const REGISTRATION_STATUS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已撤销',
  attended: '已参加',
};
export const REGISTRATION_STATUS_HINT = `报名状态只能是 ${Object.values(REGISTRATION_STATUS).join(' / ')}`;

/** 账号状态：code ↔ 中文标签。 */
export const USER_STATUS: Record<string, string> = {
  active: '正常',
  limited: '受限',
  banned: '封禁',
};
export const USER_STATUS_HINT = `账号状态只能是 ${Object.values(USER_STATUS).join(' / ')}`;

/** 角色：code ↔ 中文标签。 */
export const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  exhibitor: '展商',
  user: '普通用户',
  guest: '访客',
};

/** 中文标签 → code（写入时用）。 */
const exhibitionStatusByLabel = reverse(EXHIBITION_STATUS);
const registrationStatusByLabel = reverse(REGISTRATION_STATUS);
const userStatusByLabel = reverse(USER_STATUS);

function reverse(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [code, label] of Object.entries(map)) {
    out[label] = code;
  }
  return out;
}

/** 报名的中文标签 → 代码；也接受直接传代码。 */
export function toRegistrationStatus(value: unknown): string | null {
  const text = String(value || '').trim();
  if (Object.prototype.hasOwnProperty.call(REGISTRATION_STATUS, text)) {
    return text;
  }
  if (Object.prototype.hasOwnProperty.call(registrationStatusByLabel, text)) {
    return registrationStatusByLabel[text] ?? null;
  }
  return null;
}

/** 展会的报名方式标签 / 代码 → 代码。 */
export function toExhibitionStatus(value: unknown): string | null {
  const text = String(value || '').trim();
  if (Object.prototype.hasOwnProperty.call(EXHIBITION_STATUS, text)) {
    return text;
  }
  if (Object.prototype.hasOwnProperty.call(exhibitionStatusByLabel, text)) {
    return exhibitionStatusByLabel[text] ?? null;
  }
  return null;
}

/** 账号状态标签 / 代码 → 代码。 */
export function toUserStatus(value: unknown): string | null {
  const text = String(value || '').trim();
  if (Object.prototype.hasOwnProperty.call(USER_STATUS, text)) {
    return text;
  }
  if (Object.prototype.hasOwnProperty.call(userStatusByLabel, text)) {
    return userStatusByLabel[text] ?? null;
  }
  return null;
}

/**
 * 报名方式标签：列表卡片上显示的那一列。
 * 「需审核 / 无需审核」要带上「报名中」前缀，「仅展示 / 截止报名 / 已结束」原样显示。
 */
export function modeLabel(statusCode: string): string {
  if (statusCode === 'optional') {
    return '报名中 · 无需审核';
  }
  if (statusCode === 'review') {
    return '报名中 · 需审核';
  }
  return EXHIBITION_STATUS[statusCode] || EXHIBITION_STATUS.review || '需审核';
}

/** 「仅展示」以外的展会才有列表用的 mode 区分，与前端 `mode` 字段一致。 */
export function modeOf(statusCode: string): string {
  return statusCode === 'display' ? 'display' : 'review';
}

/** 当前是否可以提交报名（只跟报名方式有关，具体窗口再看报名起止日期）。 */
export function acceptsRegistration(statusCode: string): boolean {
  return statusCode === 'review' || statusCode === 'optional';
}

/** 报名码前缀：`CALMOBILE-CHECKIN|<展会 id>|<报名 id>`。 */
export const CODE_PREFIX = 'CALMOBILE-CHECKIN|';

/** 生成报名码；只有启用二维码且已通过（或已参加）的报名才应该下发。 */
export function checkInCode(exhibitionId: string, registrationId: string): string {
  return `${CODE_PREFIX}${exhibitionId}|${registrationId}`;
}

/** 解析扫码结果，返回 { exhibitionId, registrationId }；无法识别时返回 null。 */
export function parseCheckInCode(raw: unknown): { exhibitionId: string; registrationId: string } | null {
  const text = String(raw || '').trim();
  if (!text.startsWith(CODE_PREFIX)) {
    return null;
  }
  const rest = text.slice(CODE_PREFIX.length);
  const separator = rest.indexOf('|');
  if (separator <= 0) {
    return null;
  }
  const exhibitionId = rest.slice(0, separator).trim();
  const registrationId = rest.slice(separator + 1).trim();
  if (!exhibitionId || !registrationId) {
    return null;
  }
  return { exhibitionId, registrationId };
}

/** 日期（YYYY-MM-DD）→ 「6月8日」，与前端 dateLabel 一致。 */
export function dateLabel(isoDate: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) {
    return '';
  }
  return `${Number(match[2])}月${Number(match[3])}日`;
}
