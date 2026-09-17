/**
 * 状态与报名方式的唯一声明处。
 *
 * 这些中文标签同时也是**桥接协议里的值**：原生侧
 * `RegistrationReviewStore.STATUS_*`、`ExhibitorExhibition.STATUS_*`
 * 与 `WebAppActions.modeLabel()` 输出同一批字符串，前端按值比较。
 * 因此这里集中声明，页面不要再写 `'已通过'` 之类的字面量 —— 后
 * 端化时只要这份映射与接口字段对齐，页面就不用改。
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
