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

import express from 'express';
import { query } from '../config/pool.js';
import { REGISTRATION_COLUMNS, REGISTRATION_FROM, EXHIBITION_COLUMNS, EXHIBITION_FROM } from '../domain/queries.js';
import { registrationPayload, type ExhibitionRow, type RegistrationRow } from '../domain/payloads.js';
import { loadFields } from './exhibitions.js';
import { authenticate } from '../middleware/auth.js';
import { requireUser, assertNotLimited } from '../domain/permissions.js';
import { badRequest, forbidden } from '../domain/errors.js';
import { mutate } from '../domain/respond.js';
import { limits as readLimits, text } from '../domain/validation.js';
import * as labels from '../domain/labels.js';

const router = express.Router();

/** 重复报名的提示：预检查与数据库唯一冲突（23505）用同一句，页面提示才稳定。 */
const DUPLICATE_MESSAGE = '已提交过该展会的报名';

/** 报名方式不支持报名时的提示：分别说明是仅展示、已截止还是已结束。 */
function closedMessage(statusCode: string) {
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
interface ExhibitionWindowRow extends ExhibitionRow {
  before_start: boolean;
  after_end: boolean;
}

async function loadExhibition(id: string) {
  const result = await query<ExhibitionWindowRow>(
    `
        SELECT ${EXHIBITION_COLUMNS},
            (e.registration_start IS NOT NULL AND CURRENT_DATE < e.registration_start) AS before_start,
            (e.registration_end IS NOT NULL AND CURRENT_DATE > e.registration_end)     AS after_end
        ${EXHIBITION_FROM}
        WHERE e.id = $1
    `,
    [id],
  );
  return result.rows[0] || null;
}

/** 读一条报名（`REGISTRATION_COLUMNS` 已经 JOIN 了展会）。 */
async function loadRegistration(id: string) {
  const result = await query<RegistrationRow>(`SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.id = $1`, [
    id,
  ]);
  return result.rows[0] || null;
}

// ── 报名内容的服务端校验 ────────────────────────────────────────

/** 页面对没填的收集项写「未填写」占位（见 `pages/registration-form.js`），校验时按空处理。 */
const EMPTY_ANSWER = '未填写';

/**
 * 取某个收集项在 `answers` 里的填写值。
 *
 * `answers` 是各收集项拼成的多行文本（每行 `标题：值`，见 `pages/registration-form.js`
 * 的提交逻辑），落库后是一整段 TEXT。这里按「行首是标题 + 冒号」匹配，
 * 而不是按第一个冒号硬拆：收集项标题本身可能带冒号，硬拆会把标题切坏。
 * 同一个标题出现多次时以第一行为准。
 */
function answerValue(answers: unknown, title: string) {
  for (const line of String(answers === undefined || answers === null ? '' : answers).split('\n')) {
    for (const separator of ['：', ':']) {
      const prefix = `${title}${separator}`;
      if (line.startsWith(prefix)) {
        const value = line.slice(prefix.length).trim();
        return value === EMPTY_ANSWER ? '' : value;
      }
    }
  }
  return '';
}

/** 多选值拆成单个选项：页面用「、」拼接，这里同时容忍半角 / 全角逗号。 */
function splitChoices(value: string) {
  return String(value || '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 按这场展会配置的收集项校验 `answers`（没有配置收集项时字段列表为空，见 `loadFields`）。
 *
 * 页面的 `core/validate.js` 会被绕过，所以服务端也校验一遍：
 * - 必填项不能为空 → `请填写「XX」`；
 * - 单选 / 多选的值必须落在选项里 → 列出可选值；
 * 失败抛 400，由 `mutate()` 转成 HTTP 200 + `{ ok:false, error }` 的可读文案。
 */
function validateAnswers(fields: Awaited<ReturnType<typeof loadFields>>, answers: unknown) {
  for (const field of fields) {
    const value = answerValue(answers, field.title);
    if (!value) {
      if (field.required) {
        throw badRequest(`请填写「${field.title}」`);
      }
      continue;
    }
    if (field.type !== '单选' && field.type !== '多选') {
      continue;
    }
    const options = Array.isArray(field.options) ? field.options : [];
    const chosen = field.type === '多选' ? splitChoices(value) : [value];
    if (options.length > 0 && chosen.some((item) => !options.includes(item))) {
      throw badRequest(`「${field.title}」只能选择：${options.join(' / ')}`);
    }
  }
}

/**
 * GET /api/v1/registrations
 * 我的报名列表，按报名时间倒序。展商 / 管理员同样只看到自己的。
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = requireUser(req);
    const result = await query<RegistrationRow>(
      `
            SELECT ${REGISTRATION_COLUMNS}
            ${REGISTRATION_FROM}
            WHERE r.visitor_id = $1
            ORDER BY r.created_at DESC, r.id DESC
        `,
      [user.userId],
    );
    res.json(result.rows.map(registrationPayload));
  } catch (error: unknown) {
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
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/registrations
 * 提交报名：展会存在 → 报名方式开放 → 没有重复报名 → 在报名窗口内 → 字段合法 → 落库。
 *
 * 「没有重复报名」放在报名窗口之前：已经报过的人再点一次，提示「已提交过该展会的报名」
 * 比「报名已截止」更准确（否则展会截止后，老报名人连自己报过都看不出来）。
 *
 * 受限账号（`users.status = 'limited'`，管理员不受限）由 `assertNotLimited()` 给 403：
 * 判定放在 `mutate()` **外面**，否则会被收成 200 + `ok:false`，前端拿不到状态码。
 * 撤销自己的报名不在受限范围内（见 `DELETE /:id`）。
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    assertNotLimited(requireUser(req, '请先登录后再报名'), 'register');
  } catch (error: unknown) {
    next(error);
    return;
  }
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
    const existing = await query(
      `
            SELECT id FROM registrations
            WHERE exhibition_id = $1 AND visitor_id = $2 AND status <> 'cancelled'
            LIMIT 1
        `,
      [exhibitionId, user.userId],
    );
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
    const answers = String(req.body.answers === undefined || req.body.answers === null ? '' : req.body.answers);
    const maxAnswer = Number((await readLimits()).answer) || 0;
    if (maxAnswer > 0 && answers.length > maxAnswer) {
      throw badRequest(`报名填写内容最多 ${maxAnswer} 个字符`);
    }
    // 字段合法：按这场展会的收集项校验必填与选项（没配收集项时列表为空，就没有要校验的答案），
    // 页面的校验被绕过后同样拦得住。
    validateAnswers(await loadFields(exhibitionId), answers);

    // 无需审核的展会提交后直接通过，需审核的留在待审核。
    const autoApproved = exhibition.status === 'optional';
    const status = autoApproved ? 'approved' : 'pending';
    const id = `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await query(
        `
                INSERT INTO registrations
                    (id, exhibition_id, visitor_id, visitor_name, visitor_type, answers, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
        [id, exhibitionId, user.userId, visitorName, visitorType, answers, status],
      );
    } catch (error: unknown) {
      // 23505：并发下同一用户同时提交两次时由部分唯一索引拦下，按重复报名处理，不要变成 500。
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
        throw badRequest(DUPLICATE_MESSAGE);
      }
      throw error;
    }

    const created = await loadRegistration(id);
    return {
      autoApproved,
      statusLabel: labels.REGISTRATION_STATUS[status],
      registration: registrationPayload(created!),
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
    const result = await query<{ id: string; visitor_id: string | null; status: string }>(
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
    // 已参加是终态（与审核状态机口径一致）：现场核销过的记录不能由用户自己撤销，
    // 否则出勤记录可以事后抹掉。
    if (row.status === 'attended') {
      throw badRequest('已参加的报名不能再撤销');
    }
    await query(
      `
            UPDATE registrations
            SET status = 'cancelled', updated_at = now()
            WHERE id = $1
        `,
      [row.id],
    );
    return {};
  });
});

export default router;
