/**
 * 协议词表的唯一声明处：状态、报名方式、收集项类型、角色。
 *
 * 协议值一律是英文 code——数据库、接口、前端比较与回传都用 code，
 * 界面文案按 code 查 `zh.json`（`status.*` / `role.*` / `fieldType.*`）。
 * **不要把中文标签当协议值**：它曾经既是显示文案又是比较值，装了语言包就会比不中、回传译文。
 *
 * 服务端 `server/src/domain/labels.ts` 是同一套 code 的定义处，改一边必须同步另一边。
 * 接口里的中文标签字段（`status` / `statusLabel` / `modeLabel` / `roleLabel`）只留给
 * 还没更新快照的旧页面，新代码一律读 `statusCode` / `role` / `roleCode`。
 */
import { t } from '@/i18n';

/** 报名审核状态。 */
export const REGISTRATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ATTENDED: 'attended',
  CANCELLED: 'cancelled',
} as const;

/** 展会报名方式 / 报名状态。 */
export const EXHIBITION_STATUS = {
  REVIEW_REQUIRED: 'review',
  REVIEW_OPTIONAL: 'optional',
  DISPLAY_ONLY: 'display',
  CLOSED: 'closed',
  ENDED: 'ended',
} as const;

/** 账号状态。 */
export const USER_STATUS = {
  NORMAL: 'active',
  RESTRICTED: 'limited',
  BANNED: 'banned',
} as const;

/** 收集项类型。 */
export const FIELD_TYPE = {
  TEXT: 'text',
  RADIO: 'radio',
  CHECKBOX: 'checkbox',
} as const;

/** 筛选条上的「全部」：不是后端词表，只在本机作哨兵。 */
export const FILTER_ALL = 'all';

/** 报名管理页的筛选顺序。 */
export const REVIEW_FILTERS = [
  REGISTRATION_STATUS.PENDING,
  REGISTRATION_STATUS.APPROVED,
  REGISTRATION_STATUS.REJECTED,
  REGISTRATION_STATUS.ATTENDED,
  FILTER_ALL,
];

/** 展会编辑页可选的报名方式（三个互斥选项）。 */
export const REGISTRATION_MODES = [
  EXHIBITION_STATUS.REVIEW_REQUIRED,
  EXHIBITION_STATUS.REVIEW_OPTIONAL,
  EXHIBITION_STATUS.DISPLAY_ONLY,
];

/** 账号状态面板的顺序。 */
export const USER_STATUSES = [USER_STATUS.NORMAL, USER_STATUS.RESTRICTED, USER_STATUS.BANNED];

export type StatusTone = 'ok' | 'pending' | 'danger' | 'warn' | 'info' | 'muted';

/**
 * 按 code 取文案。code 不在词表里时原样回显 code：跟缺文案时显示路径一个道理，
 * 屏幕上一眼能看出是哪个新值没跟上。
 */
export function registrationStatusLabel(status: string): string {
  switch (status) {
    case REGISTRATION_STATUS.PENDING:
      return t('status.registration.pending');
    case REGISTRATION_STATUS.APPROVED:
      return t('status.registration.approved');
    case REGISTRATION_STATUS.REJECTED:
      return t('status.registration.rejected');
    case REGISTRATION_STATUS.ATTENDED:
      return t('status.registration.attended');
    case REGISTRATION_STATUS.CANCELLED:
      return t('status.registration.cancelled');
    default:
      return status;
  }
}

export function exhibitionStatusLabel(status: string): string {
  switch (status) {
    case EXHIBITION_STATUS.REVIEW_REQUIRED:
      return t('status.exhibition.review');
    case EXHIBITION_STATUS.REVIEW_OPTIONAL:
      return t('status.exhibition.optional');
    case EXHIBITION_STATUS.DISPLAY_ONLY:
      return t('status.exhibition.display');
    case EXHIBITION_STATUS.CLOSED:
      return t('status.exhibition.closed');
    case EXHIBITION_STATUS.ENDED:
      return t('status.exhibition.ended');
    default:
      return status;
  }
}

/**
 * 报名方式是否处于「报名中」：只有需审核 / 无需审核两种才算。
 *
 * 管理端暂停 / 恢复报名按它判断，不看 `openForRegistration`：报名截止日已过的展会
 * 也是 `openForRegistration === false`，但那不是展商手动暂停。
 */
export function acceptsRegistration(statusCode: unknown): boolean {
  const status = String(statusCode ?? '');
  return status === EXHIBITION_STATUS.REVIEW_REQUIRED || status === EXHIBITION_STATUS.REVIEW_OPTIONAL;
}

/**
 * 展会的展示状态：报名已截止时用 `closed`（截止报名）覆盖原报名方式。
 *
 * 服务端只在报名方式仍是需审核 / 无需审核、且报名截止日已过时下发 `registrationEnded`，
 * 「仅展示 / 截止报名 / 已结束」保持自己的状态文案。卡片状态灯与详情页统一读它，
 * 不要各自按 `openForRegistration` 判断。
 */
export function exhibitionModeCode(item: {
  statusCode?: unknown;
  registrationEnded?: unknown;
  [key: string]: unknown;
}): string {
  const status = String(item.statusCode ?? '');
  return item.registrationEnded === true && acceptsRegistration(status) ? EXHIBITION_STATUS.CLOSED : status;
}

export function userStatusLabel(status: string): string {
  switch (status) {
    case USER_STATUS.NORMAL:
      return t('status.user.active');
    case USER_STATUS.RESTRICTED:
      return t('status.user.limited');
    case USER_STATUS.BANNED:
      return t('status.user.banned');
    default:
      return status;
  }
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return t('role.admin');
    case 'exhibitor':
      return t('role.exhibitor');
    case 'user':
      return t('role.user');
    case 'guest':
      return t('role.guest');
    default:
      return role;
  }
}

export function fieldTypeLabel(type: string): string {
  switch (type) {
    case FIELD_TYPE.TEXT:
      return t('fieldType.text');
    case FIELD_TYPE.RADIO:
      return t('fieldType.radio');
    case FIELD_TYPE.CHECKBOX:
      return t('fieldType.checkbox');
    default:
      return type;
  }
}

/**
 * 列表卡片上那一列报名方式：review / optional 带「报名中」前缀（服务端 `modeLabel()` 原来是同一套规则），
 * 其余（仅展示 / 截止报名 / 已结束）原样。
 */
export function modeLabel(status: string): string {
  if (status === EXHIBITION_STATUS.REVIEW_REQUIRED) return t('status.exhibitionWithRegistration.review');
  if (status === EXHIBITION_STATUS.REVIEW_OPTIONAL) return t('status.exhibitionWithRegistration.optional');
  return exhibitionStatusLabel(status);
}

/** 报名方式 → 说明文案。 */
export function modeHint(status: string): string {
  if (status === EXHIBITION_STATUS.REVIEW_REQUIRED) {
    return t('review.modeHint.required');
  }
  if (status === EXHIBITION_STATUS.REVIEW_OPTIONAL) {
    return t('review.modeHint.optional');
  }
  return t('review.modeHint.displayOnly');
}

/**
 * 状态 → 标签色调。
 * 颜色不作为唯一线索，标签始终带文字。绿、黄、蓝和主题色都是描边加文字。
 */
export function statusTone(status: unknown): StatusTone {
  switch (status) {
    // 账号状态也是「信号灯」：正常绿、受限琥珀、封禁砖红。
    // 以前这里只认报名 / 展会状态，管理用户卡片上的账号状态因此全是灰色。
    case USER_STATUS.NORMAL:
      return 'ok';
    case USER_STATUS.RESTRICTED:
      return 'warn';
    case USER_STATUS.BANNED:
      return 'danger';
    case REGISTRATION_STATUS.APPROVED:
    case REGISTRATION_STATUS.ATTENDED:
    case EXHIBITION_STATUS.REVIEW_OPTIONAL:
      return 'ok';
    case REGISTRATION_STATUS.PENDING:
    case EXHIBITION_STATUS.REVIEW_REQUIRED:
      return 'pending';
    case REGISTRATION_STATUS.REJECTED:
    case REGISTRATION_STATUS.CANCELLED:
      return 'danger';
    case EXHIBITION_STATUS.CLOSED:
      return 'warn';
    case EXHIBITION_STATUS.DISPLAY_ONLY:
      return 'info';
    default:
      return 'muted';
  }
}
