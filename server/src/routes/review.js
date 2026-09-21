/**
 * review：报名审核列表、详情、改状态（展商后台 / 管理员的「报名管理」页）。
 *
 * 权限：`requireExhibitor`（展商或管理员）。展商只能看 / 改**自己举办的展会**的报名，
 * 管理员不限；别人的展会一律 403 或按不存在处理，不泄露报名人信息。
 * 展商还要再受管理员配置的「允许修改已通过或已拒绝的报名」（`state.review.canRevise`）约束。
 *
 * 列表字段就是前端「报名管理」页消费的那一份（`pages/review.js`）：
 * `{ exhibitionId, status, records, counts }`，`records` 每条带
 * `id / exhibitionId / visitorName / registrationTime / answers / summary / status`。
 */

const express = require('express');
const { query } = require('../config/pool');
const { authenticate } = require('../middleware/auth');
const { requireExhibitor, canManageExhibition } = require('../domain/permissions');
const { badRequest, forbidden, notFound } = require('../domain/errors');
const { mutate } = require('../domain/respond');
const { readSection } = require('../domain/settings');
const labels = require('../domain/labels');

const router = express.Router();

/**
 * 报名状态机：当前状态 → 允许改成哪些状态。
 *
 * 规则来自审核业务本身，而不是页面按钮好不好点：
 * - 待审核 → 已通过 / 已拒绝 / 已撤销（撤销由报名人自己发起，这里也允许展商改）；
 * - 已通过 → 已参加 / 已拒绝 / 已撤销（现场到会、复核改判、作废）；
 * - 已拒绝 → 已通过 / 已撤销（复核改判）；
 * - 已参加 → 终态，任何改动都不允许（已核销的记录只读，避免把核销结果改没）；
 * - 已撤销 → 待审核 / 已通过（重新激活；库里另有部分唯一索引兜住「同展会重复报名」）。
 *
 * 管理员与展商共用这张表；「展商能不能改已审核的记录」是另一条策略，
 * 由下面的 `canReviseByExhibitor()` 读管理员配置后判定。
 */
const REGISTRATION_TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['attended', 'rejected', 'cancelled'],
  rejected: ['approved', 'cancelled'],
  attended: [],
  cancelled: ['pending', 'approved'],
};

/** 管理员配置的审核策略：`canRevise` 为 true 才允许展商改动已审核的报名。 */
async function canReviseByExhibitor() {
  const review = await readSection('review');
  return Boolean(review && review.canRevise === true);
}

/** 审核视图用到的列：只取页面要用的字段，`registrationTime` 由 SQL 直接格式化成 `MM-DD HH:mm`。 */
const REVIEW_COLUMNS = `
    r.id, r.exhibition_id, r.visitor_name, r.answers, r.status,
    to_char(r.created_at, 'MM-DD HH24:MI')  AS registration_time,
    e.exhibitor_id                          AS exhibition_exhibitor_id
`;

const REVIEW_FROM = `
    FROM registrations r
    JOIN exhibitions e ON e.id = r.exhibition_id
`;

/** 报名内容摘要：换行折成空格再截断（`answers` 是各收集项拼成的多行文本）。 */
function summaryOf(answers) {
  return String(answers || '')
    .replace(/\n/g, ' ')
    .slice(0, 46);
}

/** 报名行 → 审核记录（含核销结果里的报名摘要，两边字段一致）。 */
function reviewPayload(row) {
  return {
    id: row.id,
    exhibitionId: row.exhibition_id,
    visitorName: row.visitor_name,
    registrationTime: row.registration_time || '',
    answers: row.answers || '',
    summary: summaryOf(row.answers),
    status: labels.REGISTRATION_STATUS[row.status] || '',
  };
}

/** 状态下拉可选的取值：五个英文代码对应的中文标签。 */
function statusHint() {
  return Object.values(labels.REGISTRATION_STATUS).join(' / ');
}

/**
 * 校验 `exhibitionId` 指向的展会能不能管；返回展会行。
 * 不存在给 404，别人的展会给 403（管理员不限）。
 */
async function assertExhibitionScope(exhibitionId, user) {
  const result = await query('SELECT id, exhibitor_id FROM exhibitions WHERE id = $1', [exhibitionId]);
  const exhibition = result.rows[0];
  if (!exhibition) {
    throw notFound('展会不存在或已删除');
  }
  if (!canManageExhibition(user, exhibition)) {
    throw forbidden('只能查看自己举办的展会的报名');
  }
  return exhibition;
}

/**
 * GET /api/v1/review?exhibitionId=&status=
 *
 * `status` 缺省或传 `全部` 表示不筛选，取值是中文标签（`labels.toRegistrationStatus`
 * 同时接受英文代码）。`counts` 统计的是**范围**（指定的展会 / 自己的全部展会），
 * 不随状态筛选变化，页面据此显示每个筛选上的条数。
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = requireExhibitor(req);
    const exhibitionId = String(req.query.exhibitionId || '').trim();
    const statusLabel = String(req.query.status || '').trim() || '全部';
    const statusCode = statusLabel === '全部' ? '' : labels.toRegistrationStatus(statusLabel);
    if (statusLabel !== '全部' && !statusCode) {
      throw badRequest(`报名状态只能是 ${statusHint()}`);
    }

    // 范围条件：指定展会就按展会，否则展商只看自己举办的展会，管理员不限。
    const scopeParams = [];
    const scope = [];
    if (exhibitionId) {
      await assertExhibitionScope(exhibitionId, user);
      scopeParams.push(exhibitionId);
      scope.push(`r.exhibition_id = $${scopeParams.length}`);
    } else if (user.role !== 'admin') {
      scopeParams.push(user.userId);
      scope.push(`e.exhibitor_id = $${scopeParams.length}`);
    }
    const scopeSql = scope.length > 0 ? `WHERE ${scope.join(' AND ')}` : '';

    const counts = { total: 0 };
    for (const label of Object.values(labels.REGISTRATION_STATUS)) {
      counts[label] = 0;
    }
    const grouped = await query(
      `
            SELECT r.status, count(*)::int AS total
            ${REVIEW_FROM}
            ${scopeSql}
            GROUP BY r.status
        `,
      scopeParams,
    );
    for (const row of grouped.rows) {
      counts.total += row.total;
      const label = labels.REGISTRATION_STATUS[row.status];
      if (label) {
        counts[label] = row.total;
      }
    }

    // 记录列表：在范围之上再叠加状态筛选。
    const recordParams = [...scopeParams];
    let recordsSql = scopeSql;
    if (statusCode) {
      recordParams.push(statusCode);
      recordsSql = `${scopeSql ? `${scopeSql} AND` : 'WHERE'} r.status = $${recordParams.length}`;
    }
    const records = await query(
      `
            SELECT ${REVIEW_COLUMNS}
            ${REVIEW_FROM}
            ${recordsSql}
            ORDER BY r.created_at DESC, r.id DESC
        `,
      recordParams,
    );

    res.json({
      exhibitionId,
      status: statusLabel,
      records: records.rows.map(reviewPayload),
      counts,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/review/:id
 * 单条审核详情。别人的展会按「不存在」处理（不返回 403，避免探出记录是否存在）。
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const user = requireExhibitor(req);
    const result = await query(`SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE r.id = $1`, [req.params.id]);
    const row = result.rows[0];
    if (!row || !canManageExhibition(user, { exhibitor_id: row.exhibition_exhibitor_id })) {
      res.json({ found: false, error: '报名记录不存在' });
      return;
    }
    res.json({ found: true, record: reviewPayload(row) });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/review/:id/status
 * 改审核状态，请求体 `{ status }` 接受中文标签或英文代码。
 *
 * 三层校验，失败形态各不相同：
 * 1. **越权**（不是自己举办的展会、展商改已审核的报名而管理员没开放）→ 403，
 *    在进 `mutate` 之前判定：这是权限问题，不该伪装成 200 的业务失败；
 * 2. **状态流转非法**（例如已参加 → 已通过）→ 400，走 `mutate` 的信封
 *    （HTTP 200 + `{ ok:false, error }`），因为它是业务规则失败；
 * 3. 状态取值非法、记录不存在同样是业务失败，走信封。
 */
router.put('/:id/status', authenticate, async (req, res, next) => {
  try {
    const user = requireExhibitor(req);
    const result = await query(`SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE r.id = $1`, [req.params.id]);
    const row = result.rows[0];
    if (row && !canManageExhibition(user, { exhibitor_id: row.exhibition_exhibitor_id })) {
      throw forbidden('只能管理自己举办的展会的报名');
    }

    await mutate(res, next, async () => {
      const status = labels.toRegistrationStatus(req.body.status);
      if (!status) {
        throw badRequest(`报名状态只能是 ${statusHint()}`);
      }
      if (!row) {
        throw badRequest('报名记录不存在');
      }

      // 白名单之外的流转直接拒绝，别让「已参加」被改回「已通过」这类操作把核销结果抹掉。
      const allowed = REGISTRATION_TRANSITIONS[row.status] || [];
      if (!allowed.includes(status)) {
        throw badRequest(
          `不能把「${labels.REGISTRATION_STATUS[row.status] || row.status}」` +
            `的报名改成「${labels.REGISTRATION_STATUS[status]}」`,
        );
      }
      // 展商改动已审核（已通过 / 已拒绝）或重新激活已撤销的报名，要先由管理员开放；
      // 管理员不受这条策略限制（「管理后台查看报名时始终可以切换状态」）。
      if (user.role !== 'admin' && !(await canReviseByExhibitor())) {
        if (row.status === 'approved' || row.status === 'rejected') {
          throw forbidden('管理员未开放修改已通过或已拒绝的报名');
        }
        if (row.status === 'cancelled') {
          throw forbidden('管理员未开放重新审核已撤销的报名');
        }
      }

      try {
        await query('UPDATE registrations SET status = $2, updated_at = now() WHERE id = $1', [row.id, status]);
      } catch (error) {
        // 23505：把一条「已撤销」的报名改回有效状态，而这个人在这场展会上已经有别的
        // 未撤销报名（由部分唯一索引兜底）。给业务提示，不要变成 500。
        if (error.code === '23505') {
          throw badRequest('该用户在这场展会上已有未撤销的报名，不能把这条改成此状态');
        }
        throw error;
      }
      return { record: { ...reviewPayload(row), status: labels.REGISTRATION_STATUS[status] } };
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
