/**
 * 状态与报名方式的唯一声明处。
 *
 * 中文标签的权威来源是后端的 `server/src/domain/labels.js`：数据库里只存英文代码，
 * 中文标签在那里映射一次后随接口下发。原生侧已经没有任何数据实现（相关类已删除），
 * 前端这一份因此是**界面侧的唯一声明处**——页面只按这里的值比较与渲染，不要再写
 * `'已通过'` 之类的字面量。改标签时要同时改 `labels.js` 与本文件，两边按值对齐，
 * 页面本身不用动。
 */

/** 报名审核状态。 */
export const REGISTRATION_STATUS = {
    PENDING: '待审核',
    APPROVED: '已通过',
    REJECTED: '已拒绝',
    ATTENDED: '已参加',
    CANCELLED: '已撤销',
};

/** 展会报名方式 / 报名状态。 */
export const EXHIBITION_STATUS = {
    REVIEW_REQUIRED: '需审核',
    REVIEW_OPTIONAL: '无需审核',
    DISPLAY_ONLY: '仅展示',
    OPEN: '报名中',
    CLOSED: '截止报名',
    ENDED: '已结束',
};

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

/** 报名方式 → 说明文案。 */
export function modeHint(status) {
    if (status === EXHIBITION_STATUS.REVIEW_REQUIRED) {
        return '用户提交后进入待审核，展商在报名管理中通过或拒绝。';
    }
    if (status === EXHIBITION_STATUS.REVIEW_OPTIONAL) {
        return '用户提交后直接视为通过，仍可在报名管理中调整。';
    }
    return '只展示展会信息，报名入口保持禁用。';
}

/**
 * 状态 → 标签色调。
 * 颜色不作为唯一线索，标签始终带文字，这里只决定底色语义。
 */
export function statusTone(status) {
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
