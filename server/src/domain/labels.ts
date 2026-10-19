/**
 * 状态词汇表：数据库、接口与前端比较用的都是**英文 code**，中文只在显示层映射一次。
 *
 * 契约（与前端 `web/src/services/status.ts` 是同一套定义，改一边必须同步另一边）：
 * - 协议值一律是 code：报名状态 pending / approved / rejected / cancelled / attended；
 *   报名方式 review / optional / display / closed / ended；账号状态 active / limited / banned；
 *   角色 admin / exhibitor / user / guest；收集项类型 text / radio / checkbox。
 * - 下面几张「code → 中文」映射只给**兼容字段**用：接口仍下发 status / statusLabel /
 *   modeLabel / roleLabel 这些中文标签，给还没更新快照的旧页面；新代码读 statusCode / role。
 * - `toXxx()` 写入前把用户给的值统一成 code，同时接受 code 与旧中文。
 *
 * 这样做的好处：数据库里筛选、统计、加约束都用稳定的英文代码，
 * 不会因为文案调整而牵动数据，也不会因为装了语言包而比不中。
 */

import { randomUUID } from 'node:crypto';

/** 展会报名方式 / 报名状态：code ↔ 中文标签。 */
export const EXHIBITION_STATUS: Record<string, string> = {
  review: '需审核',
  optional: '无需审核',
  display: '仅展示',
  closed: '截止报名',
  ended: '已结束',
};

/** 展会收集项类型：数据库约束、接口与前端表单都用这三个 code。 */
export const EXHIBITION_FIELD_TYPES = ['text', 'radio', 'checkbox'] as const;
export type FieldTypeCode = (typeof EXHIBITION_FIELD_TYPES)[number];

/** 收集项类型 code → 中文：只给兼容字段与提示文案用（协议值本身是 code）。 */
export const FIELD_TYPE: Record<FieldTypeCode, string> = {
  text: '文本',
  radio: '单选',
  checkbox: '多选',
};
export const EXHIBITION_STATUS_HINT = `报名方式只能是 ${Object.keys(EXHIBITION_STATUS).join(' / ')}`;
export const FIELD_TYPE_HINT = `收集项类型只能是 ${EXHIBITION_FIELD_TYPES.join(' / ')}`;

/** 报名审核状态：code ↔ 中文标签。 */
export const REGISTRATION_STATUS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已撤销',
  attended: '已参加',
};
export const REGISTRATION_STATUS_HINT = `报名状态只能是 ${Object.keys(REGISTRATION_STATUS).join(' / ')}`;

/** 账号状态：code ↔ 中文标签。 */
export const USER_STATUS: Record<string, string> = {
  active: '正常',
  limited: '受限',
  banned: '封禁',
};
export const USER_STATUS_HINT = `账号状态只能是 ${Object.keys(USER_STATUS).join(' / ')}`;

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

/** 收集项类型：code 或旧中文 → code；不认识时返回 null。 */
export function toFieldType(value: unknown): FieldTypeCode | null {
  const text = String(value || '').trim();
  if ((EXHIBITION_FIELD_TYPES as readonly string[]).includes(text)) return text as FieldTypeCode;
  for (const [code, label] of Object.entries(FIELD_TYPE)) {
    if (label === text) return code as FieldTypeCode;
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

/**
 * 报名码前缀：`CALMOBILE-CHECKIN|<展会 id>|<报名 id>|<凭据>`。
 *
 * 前两段只用来定位报名，第三段是**可轮换的凭据**：报名被退回重审后换一个，
 * 现场那张旧二维码随之失效（见 `routes/review-hono.ts` 的状态流转）。
 */
export const CODE_PREFIX = 'CALMOBILE-CHECKIN|';

/**
 * 生成一个新的报名码凭据。
 *
 * 12 位十六进制（48 bit）：现场扫码要的是「猜不到」，不是密码学强度。
 * 每次轮换都重新生成，因此旧码不会因为报名 id 不变而继续可用。
 */
export function newCheckInSecret(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

/** 生成报名码；只有启用二维码、已通过（或已参加）且凭据非空的报名才应该下发。 */
export function checkInCode(exhibitionId: string, registrationId: string, secret: string): string {
  return `${CODE_PREFIX}${exhibitionId}|${registrationId}|${secret}`;
}

/**
 * 解析扫码结果，返回 { exhibitionId, registrationId, secret }；无法识别时返回 null。
 *
 * 旧的两段码（没有凭据那一段）解析成空 secret，而不是直接判为无法识别：
 * 它到核销那一步会得到「报名码已失效」的明确提示，用户才知道去重新打开二维码。
 */
export function parseCheckInCode(
  raw: unknown,
): { exhibitionId: string; registrationId: string; secret: string } | null {
  const text = String(raw || '').trim();
  if (!text.startsWith(CODE_PREFIX)) {
    return null;
  }
  const [exhibitionId = '', registrationId = '', secret = ''] = text.slice(CODE_PREFIX.length).split('|');
  if (!exhibitionId.trim() || !registrationId.trim()) {
    return null;
  }
  return { exhibitionId: exhibitionId.trim(), registrationId: registrationId.trim(), secret: secret.trim() };
}

/** 日期（YYYY-MM-DD）→ 「6月8日」，与前端 dateLabel 一致。 */
export function dateLabel(isoDate: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) {
    return '';
  }
  return `${Number(match[2])}月${Number(match[3])}日`;
}
