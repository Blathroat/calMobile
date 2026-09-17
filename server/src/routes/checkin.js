/**
 * checkin：现场扫码核销。
 *
 * 展商扫用户报名详情里的二维码（`CALMOBILE-CHECKIN|<展会 id>|<报名 id>`），
 * 把「已通过」推进到「已参加」并写入 `check_in_time`；重复扫码要能看出是重复，
 * 而不是报一个含糊的错误。
 *
 * 响应与 `demo-api.js` 的 `checkin.scan` 完全同形：
 * 业务失败也是 HTTP 200 + `{ ok:false, error }`，并带上 `duplicated` / `status` / `record`
 * 供页面渲染（因此这里不用 `mutate` 的统一信封，成功分支自己给 `{ ok:true, error:'' }`）。
 */

const express = require('express');
const { query } = require('../config/pool');
const { REGISTRATION_COLUMNS, REGISTRATION_FROM } = require('../domain/queries');
const { authenticate } = require('../middleware/auth');
const { requireExhibitor, canManageExhibition } = require('../domain/permissions');
const labels = require('../domain/labels');

const router = express.Router();

/** 核销结果里给页面看的报名摘要，字段与 demo 的 `record` 一致。 */
const CHECKIN_COLUMNS = `
    ${REGISTRATION_COLUMNS},
    to_char(r.created_at, 'MM-DD HH24:MI')  AS registration_time
`;

/** 报名内容摘要：换行折成空格再截断。 */
function summaryOf(answers) {
  return String(answers || '').replace(/\n/g, ' ').slice(0, 46);
}

function checkInRecord(row) {
  return {
    recordId: row.id,
    visitorName: row.visitor_name,
    exhibitionId: row.exhibition_id,
    exhibitionTitle: row.exhibition_title || '',
    registrationTime: row.registration_time || '',
    answers: summaryOf(row.answers),
  };
}

/**
 * POST /api/v1/checkin
 * 请求体 `{ code }`；只有展商与管理员可以核销。
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const user = requireExhibitor(req);

    const parsed = labels.parseCheckInCode(String(req.body.code || '').trim());
    if (!parsed) {
      res.json({ ok: false, error: '无法识别的报名码，请扫描报名详情里的二维码' });
      return;
    }

    const result = await query(
      `SELECT ${CHECKIN_COLUMNS} ${REGISTRATION_FROM} WHERE r.id = $1`,
      [parsed.registrationId],
    );
    const row = result.rows[0];
    if (!row) {
      res.json({ ok: false, error: '报名记录不存在，可能已被撤销' });
      return;
    }
    // 码里的展会要跟报名实际所属的展会对得上，避免 A 展会的码在 B 展会核销。
    if (row.exhibition_id !== parsed.exhibitionId) {
      res.json({ ok: false, error: '报名码与展会不匹配' });
      return;
    }

    const record = checkInRecord(row);
    if (!canManageExhibition(user, { exhibitor_id: row.exhibition_exhibitor_id })) {
      res.json({ ok: false, error: '该报名不属于你举办的展会', record });
      return;
    }

    const statusLabel = labels.REGISTRATION_STATUS[row.status] || '';
    if (row.status === 'attended') {
      res.json({
        ok: false,
        duplicated: true,
        status: statusLabel,
        error: `${row.visitor_name} 的报名码已经核销过了`,
        record,
      });
      return;
    }
    if (row.status !== 'approved') {
      res.json({
        ok: false,
        status: statusLabel,
        error: `当前状态为「${statusLabel}」，只有已通过的报名可以核销`,
        record,
      });
      return;
    }

    // 条件更新：并发下两张设备同时扫同一个码时，只有一次能把 approved 改成 attended。
    const updated = await query(`
            UPDATE registrations
            SET status = 'attended', check_in_time = now(), updated_at = now()
            WHERE id = $1 AND status = 'approved'
        `, [row.id]);
    if (updated.rowCount === 0) {
      res.json({
        ok: false,
        duplicated: true,
        status: labels.REGISTRATION_STATUS.attended,
        error: `${row.visitor_name} 的报名码已经核销过了`,
        record,
      });
      return;
    }

    res.json({
      ok: true,
      duplicated: false,
      status: labels.REGISTRATION_STATUS.attended,
      message: `已核销 ${row.visitor_name} 的报名`,
      error: '',
      record,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
