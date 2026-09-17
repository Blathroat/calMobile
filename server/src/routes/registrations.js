/**
 * registrations：我的报名列表、详情、提交、撤销。
 *
 * 这一组接口只服务**当前登录用户自己的报名**：展商要看别人的报名走 `/review`
 * （那里按自己举办的展会圈定范围），管理员也只在详情上放行任意一条。
 *
 * 约定与 `auth.js` 一致：写入类接口返回 `{ ok, error, ... }` 信封（页面按 `.ok` 判断），
 * 校验失败抛 `badRequest` 由 `domain/respond.js` 的 `mutate` 转成信封，
 * 只有权限（403）与服务器问题才走 `index.js` 的错误中间件。
 */

const express = require('express');
const { query } = require('../config/pool');
const {
  REGISTRATION_COLUMNS, REGISTRATION_FROM, EXHIBITION_COLUMNS, EXHIBITION_FROM,
} = require('../domain/queries');
const { registrationPayload } = require('../domain/payloads');
const { authenticate } = require('../middleware/auth');
const { requireUser } = require('../domain/permissions');
const { badRequest, forbidden } = require('../domain/errors');
const { mutate } = require('../domain/respond');
const { limits: readLimits, text } = require('../domain/validation');
const labels = require('../domain/labels');

const router = express.Router();

/** 重复报名的提示：预检查与数据库唯一冲突（23505）用同一句，页面提示才稳定。 */
const DUPLICATE_MESSAGE = '已提交过该展会的报名';

/** 报名方式不支持报名时的提示：与 demo 的「该展会当前不可报名」口径一致。 */
function closedMessage(statusCode) {
  if (statusCode === 'display') {
    return '该展会仅展示，不开放报名';
  }
  if (statusCode === 'closed') {
    return '该展会已截止报名';
  }
  if (statusCode === 'ended') {
    return '该展会已结束';
  }
  return '该展会当前不可报名';
}

/**
 * 取展会行，并顺手让数据库判断报名窗口。
 *
 * 日期比较一律交给 SQL 的 `CURRENT_DATE`，不把 `registration_start` / `registration_end`
 * 取回 Node 再 `new Date()` 拆年月日——那会按服务器本地时区算，跨时区就差一天。
 */
async function loadExhibition(id) {
  const result = await query(`
        SELECT ${EXHIBITION_COLUMNS},
            (e.registration_start IS NOT NULL AND CURRENT_DATE < e.registration_start) AS before_start,
            (e.registration_end IS NOT NULL AND CURRENT_DATE > e.registration_end)     AS after_end
        ${EXHIBITION_FROM}
        WHERE e.id = $1
    `, [id]);
  return result.rows[0] || null;
}

/** 读一条报名（`REGISTRATION_COLUMNS` 已经 JOIN 了展会）。 */
async function loadRegistration(id) {
  const result = await query(
    `SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

/**
 * GET /api/v1/registrations
 * 我的报名列表，按报名时间倒序。展商 / 管理员同样只看到自己的。
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = requireUser(req);
    const result = await query(`
            SELECT ${REGISTRATION_COLUMNS}
            ${REGISTRATION_FROM}
            WHERE r.visitor_id = $1
            ORDER BY r.created_at DESC, r.id DESC
        `, [user.userId]);
    res.json(result.rows.map(registrationPayload));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/registrations/:id
 * 报名详情：只能看自己的，管理员可以看任意一条。
 * 别人的报名按「不存在」处理，不暴露「这条记录存在但不属于你」。
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const user = requireUser(req);
    const row = await loadRegistration(req.params.id);
    if (!row || (row.visitor_id !== user.userId && user.role !== 'admin')) {
      res.json({ found: false, error: '报名记录不存在或已撤销' });
      return;
    }
    res.json({ found: true, registration: registrationPayload(row) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/registrations
 * 提交报名：展会存在 → 报名方式开放 → 没有重复报名 → 在报名窗口内 → 字段合法 → 落库。
 *
 * 「没有重复报名」放在报名窗口之前：已经报过的人再点一次，提示「已提交过该展会的报名」
 * 比「报名已截止」更准确（否则展会截止后，老报名人连自己报过都看不出来）。
 */
router.post('/', authenticate, async (req, res, next) => {
  await mutate(res, next, async () => {
    const user = requireUser(req, '请先登录后再报名');

    const exhibitionId = String(req.body.exhibitionId || '').trim();
    if (!exhibitionId) {
      throw badRequest('请选择要报名的展会');
    }
    const exhibition = await loadExhibition(exhibitionId);
    if (!exhibition) {
      throw badRequest('展会不存在或已删除');
    }
    // 报名方式：只有「需审核 / 无需审核」可以报名，仅展示 / 截止报名 / 已结束都要拦住。
    if (!labels.acceptsRegistration(exhibition.status)) {
      throw badRequest(closedMessage(exhibition.status));
    }

    // 同一用户同一展会只允许一条未撤销的报名。
    const existing = await query(`
            SELECT id FROM registrations
            WHERE exhibition_id = $1 AND visitor_id = $2 AND status <> 'cancelled'
            LIMIT 1
        `, [exhibitionId, user.userId]);
    if (existing.rows.length > 0) {
      throw badRequest(DUPLICATE_MESSAGE);
    }

    if (exhibition.before_start) {
      throw badRequest('报名尚未开始');
    }
    if (exhibition.after_end) {
      throw badRequest('报名已截止');
    }

    // 姓名 / 参观身份必填；报名内容上限取管理员在「管理-设置」里配的 limits.answer。
    const visitorName = text(req.body.visitorName, { label: '姓名' });
    const visitorType = text(req.body.visitorType, { label: '参观身份' });
    const answers = String(req.body.answers === undefined || req.body.answers === null
      ? '' : req.body.answers);
    const maxAnswer = Number((await readLimits()).answer) || 0;
    if (maxAnswer > 0 && answers.length > maxAnswer) {
      throw badRequest(`报名填写内容最多 ${maxAnswer} 个字符`);
    }

    // 无需审核的展会提交后直接通过，需审核的留在待审核。
    const autoApproved = exhibition.status === 'optional';
    const status = autoApproved ? 'approved' : 'pending';
    const id = `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await query(`
                INSERT INTO registrations
                    (id, exhibition_id, visitor_id, visitor_name, visitor_type, answers, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [id, exhibitionId, user.userId, visitorName, visitorType, answers, status]);
    } catch (error) {
      // 23505：并发下同一用户同时提交两次时由部分唯一索引拦下，按重复报名处理，不要变成 500。
      if (error.code === '23505') {
        throw badRequest(DUPLICATE_MESSAGE);
      }
      throw error;
    }

    const created = await loadRegistration(id);
    return {
      autoApproved,
      statusLabel: labels.REGISTRATION_STATUS[status],
      registration: registrationPayload(created),
    };
  });
});

/**
 * DELETE /api/v1/registrations/:id
 * 撤销报名：只能撤自己的；已撤销的再撤要给出提示，不当成成功。
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  await mutate(res, next, async () => {
    const user = requireUser(req, '请先登录后再操作');
    const result = await query(
      'SELECT id, visitor_id, status FROM registrations WHERE id = $1',
      [req.params.id],
    );
    const row = result.rows[0];
    if (!row) {
      throw badRequest('报名记录不存在或已撤销');
    }
    if (row.visitor_id !== user.userId) {
      throw forbidden('只能撤销自己的报名');
    }
    if (row.status === 'cancelled') {
      throw badRequest('该报名已撤销，无需重复操作');
    }
    await query(`
            UPDATE registrations
            SET status = 'cancelled', updated_at = now()
            WHERE id = $1
        `, [row.id]);
    return {};
  });
});

module.exports = router;
