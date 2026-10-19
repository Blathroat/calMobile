/**
 * 状态与报名方式的唯一声明处。
 *
 * 中文标签的权威来源是后端的 `server/src/domain/labels.ts`：数据库只存英文代码，
 * 中文标签在那里映射一次后随接口下发。前端页面只按这里的值比较与渲染，
 * 不再写 `'已通过'` 这类字面量。改标签要同时改 labels.ts 与本文件。
 *
 * 下面这些常量是与后端逐字比对、并原样渲染的协议值，不进 i18n（翻译了就比不中）；
 * 本文件里只有 `modeHint()` 返回的说明文案取 `zh.json`。
 */
import { t } from '@/i18n';

/** 报名审核状态。 */
export const REGISTRATION_STATUS = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
  ATTENDED: '已参加',
  CANCELLED: '已撤销',
} as const;

/**
 * 账号状态：接口与数据库用的是这套中文码——后端 `server/src/domain/labels.ts` 的
 * `USER_STATUS` 是同一批字符串，前端只拿它比较与回传，**不能**换成译文；
 * 屏幕上显示的名字走 `admin.users.normal` 这类文案键。
 */
export const USER_STATUS = {
  NORMAL: '正常',
  RESTRICTED: '受限',
  BANNED: '封禁',
} as const;

/** 展会报名方式 / 报名状态。 */
export const EXHIBITION_STATUS = {
  REVIEW_REQUIRED: '需审核',
  REVIEW_OPTIONAL: '无需审核',
  DISPLAY_ONLY: '仅展示',
  OPEN: '报名中',
  CLOSED: '截止报名',
  ENDED: '已结束',
} as const;

/** 报名管理页的筛选顺序。 */
export const REVIEW_FILTERS = [
  REGISTRATION_STATUS.PENDING,
  REGISTRATION_STATUS.APPROVED,
  REGISTRATION_STATUS.REJECTED,
  REGISTRATION_STATUS.ATTENDED,
  '全部',
];

/** 展会编辑页可选的报名方式（三个互斥选项）。 */
export const REGISTRATION_MODES = [
  EXHIBITION_STATUS.REVIEW_REQUIRED,
  EXHIBITION_STATUS.REVIEW_OPTIONAL,
  EXHIBITION_STATUS.DISPLAY_ONLY,
];

export type StatusTone = 'ok' | 'pending' | 'danger' | 'warn' | 'info' | 'muted';

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
    case REGISTRATION_STATUS.APPROVED:
    case REGISTRATION_STATUS.ATTENDED:
    case EXHIBITION_STATUS.OPEN:
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
