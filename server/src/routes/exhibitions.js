/**
 * exhibitions：列表 / 月视图 / 分类 / 详情 / 新建 / 更新 / 删除 / 报名方式 / 收集项。
 *
 * 响应形状与前端页面消费的字段一致（`pages/*.js` 直接读这些字段）：
 * - **读取类**（GET）直接返回数据本身；
 * - **写入类**（POST / PUT / DELETE）返回 `{ ok, error, ... }` 信封，校验失败也是
 *   HTTP 200 + `{ ok:false, error }`，页面按 `.ok` 判断；
 * - **认证 / 授权 / 资源不存在**走 HTTP 状态码（401 / 403 / 404 + `{ error }`）：
 *   权限判定必须放在 `mutate()` 之外，否则会被收成 200 信封，页面拿不到 401/403。
 *
 * 日期只存 `exhibition_date`，年 / 月 / 日一律由 `EXHIBITION_COLUMNS` 在 SQL 里派生
 * （`to_char` + `EXTRACT`），路由里不要对日期做 `new Date(...)` 的本地时区换算。
 */

const express = require('express');
const { query, getClient } = require('../config/pool');
const { EXHIBITION_COLUMNS, EXHIBITION_FROM } = require('../domain/queries');
const { exhibitionPayload, fieldPayload } = require('../domain/payloads');
const labels = require('../domain/labels');
const { requireExhibitor, assertCanManageExhibition, assertNotLimited } = require('../domain/permissions');
const { readSection } = require('../domain/settings');
const { limits, text, int, bool, isoDate, timeRange, stringList } = require('../domain/validation');
const { badRequest, notFound } = require('../domain/errors');
const { mutate } = require('../domain/respond');
const { authenticate, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * 报名收集项的默认三项：这场展会没有配置过（或被清空）收集项时返回它。
 *
 * 取值与 `db:seed` 写入的默认收集项一致；报名提交时的必填 / 选项校验
 * （见 registrations.js 的 `validateAnswers()`）也走同一份默认值，
 * 因此「没有配置收集项」不等于「什么都能提交」。
 */
const DEFAULT_FIELDS = [
  { title: '姓名 / 公司名称', type: '文本', required: true, options: [] },
  { title: '参观身份', type: '单选', required: true, options: ['专业观众', '采购负责人', '媒体'] },
  { title: '报名需求', type: '多选', required: false, options: ['希望安排展商洽谈', '需要停车位', '需要翻译服务'] },
];

/** 收集项类型：与 `exhibition_fields.type` 的 CHECK 约束一致。 */
const FIELD_TYPES = ['文本', '单选', '多选'];

/** 一场展会的收集项条数上限：挡住超大请求体带来的批量写入。 */
const MAX_FIELDS = 50;

/** 报名方式取值非法时的统一提示。 */
const STATUS_HINT = '报名方式只能是 需审核 / 无需审核 / 仅展示 / 截止报名 / 已结束';

/** 展会不存在时的统一提示（与前端「找不到展会」的说明文案一致）。 */
const NOT_FOUND_TEXT = '展会不存在或已删除';

// ── 工具 ────────────────────────────────────────────────────────

/** 新建主键：与 auth.js 的 `usr-…` 同一种风格，避免自增序列互相打架。 */
function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 事务外壳：回调拿到 client，抛错自动回滚。 */
async function transaction(run) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** 展商 / 管理员专用写接口的前置检查：401 / 403 是 HTTP 状态码，不被 mutate 收成信封。 */
function exhibitorOnly(req, res, next) {
  try {
    requireExhibitor(req);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * 受限账号的写操作拦截（文案表见 `domain/permissions.js` 的 `LIMITED_ACTIONS`）。
 *
 * 两个位置上的要求都写在这里，各处只传动作键：
 * - **必须排在 `exhibitorOnly` 之前**：受限的普通用户两条规则都不满足，先撞角色检查
 *   会得到「只有展商或管理员可以执行此操作」，而页面需要的是「账号已被限制」这个原因；
 * - **挂在 `mutate()` 之外**：403 才不会被收成 200 + `ok:false`。
 *
 * 编辑 / 删除 / 改状态 / 改收集项全都要拦：受限账号连自己已有的展会也不能再动，
 * 只保留「看」的部分（列表、月视图、详情、收集项读取）与报名审核。
 */
function notLimited(action) {
  return (req, res, next) => {
    try {
      assertNotLimited(req.user, action);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** 读取一场展会的原始行（含 `exhibitor_id`，权限判定要用它）。 */
async function findRow(id) {
  const result = await query(`SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM} WHERE e.id = $1`, [id]);
  return result.rows[0] || null;
}

/** 取展会行并校验当前用户可以管理它：不存在 404，不是自己办的 403。 */
async function manageableRow(req, id) {
  const row = await findRow(id);
  if (!row) {
    throw notFound(NOT_FOUND_TEXT);
  }
  assertCanManageExhibition(req.user, row);
  return row;
}

/** `?query=` 的模糊匹配串：用户输入的 % 和 _ 按字面匹配，不当通配符。 */
function likePattern(keyword) {
  return `%${keyword.replace(/([\\%_])/g, '\\$1')}%`;
}

/** 请求体里是否显式给了这个键：给了就整体替换，没给就沿用原值。 */
function given(body, key) {
  return Boolean(body) && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

/** 简介正文是不是 HTML：按开头的块级标签嗅探，写入与读取用同一套规则。 */
function looksLikeHtml(value) {
  return /^\s*<(p|div|h[1-6]|ul|ol|blockquote|br|strong|em)\b/.test(String(value || ''));
}

/** 首页日历的落点月份：最早一个有展会的月份；没有展会时用当前月（与 bootstrap 一致）。 */
async function landingMonth() {
  const result = await query(`
        SELECT EXTRACT(YEAR FROM exhibition_date)::int  AS year,
               EXTRACT(MONTH FROM exhibition_date)::int AS month
        FROM exhibitions
        ORDER BY exhibition_date
        LIMIT 1
    `);
  if (result.rows.length > 0) {
    return { year: result.rows[0].year, month: result.rows[0].month };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** 月视图 / 列表共用的精简卡片：只保留日历与卡片渲染要用的字段。 */
function monthSummary(item) {
  return {
    id: item.id,
    day: item.day,
    title: item.title,
    time: item.time,
    venue: item.venue,
    status: item.status,
    modeLabel: item.modeLabel,
    openForRegistration: item.openForRegistration,
    imageUri: item.imageUri,
    category: item.category,
  };
}

// ── 报名收集项 ──────────────────────────────────────────────────

/**
 * 报名收集项：按 `position` 顺序取。
 *
 * 没有配置过（或被清空）时回退到默认三项，`id` 为空串——页面据此仍能渲染出一份可填的
 * 报名表，提交时 `registrations.js` 也用同一份默认值校验（导出给那边复用）。
 */
async function loadFields(exhibitionId) {
  const result = await query(
    `
        SELECT id, title, type, required, options
        FROM exhibition_fields
        WHERE exhibition_id = $1
        ORDER BY position, id
    `,
    [exhibitionId],
  );
  if (result.rows.length === 0) {
    return DEFAULT_FIELDS.map((item) => fieldPayload({ ...item, id: '' }));
  }
  return result.rows.map(fieldPayload);
}

/** 校验请求体里的收集项：非法抛 400，返回按数组顺序规整好的结果。 */
function normalizeFields(raw, config) {
  if (!Array.isArray(raw)) {
    throw badRequest('收集项需为数组');
  }
  if (raw.length > MAX_FIELDS) {
    throw badRequest(`收集项最多 ${MAX_FIELDS} 项`);
  }
  return raw.map((item) => {
    const source = item && typeof item === 'object' ? item : {};
    const type = String(source.type === undefined || source.type === null ? '文本' : source.type).trim();
    if (!FIELD_TYPES.includes(type)) {
      throw badRequest('收集项类型只能是 文本 / 单选 / 多选');
    }
    return {
      title: text(source.title, { label: '收集项标题', max: config.fieldTitle }),
      type,
      required: bool(source.required, false),
      // 文本项不存选项，避免留下渲染不出来的脏数据。
      options: type === '文本' ? [] : stringList(source.options, { label: '选项' }),
    };
  });
}

/** 覆盖收集项：删掉旧的，再按数组顺序写新的（由调用方决定事务边界）。 */
async function replaceFields(client, exhibitionId, fields) {
  await client.query('DELETE FROM exhibition_fields WHERE exhibition_id = $1', [exhibitionId]);
  for (const [index, item] of fields.entries()) {
    await client.query(
      `
            INSERT INTO exhibition_fields (id, exhibition_id, title, type, required, options, position)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
      [newId('field'), exhibitionId, item.title, item.type, item.required, JSON.stringify(item.options), index],
    );
  }
}

// ── 展会写入 ────────────────────────────────────────────────────

/**
 * 请求体 → 展会字段。
 *
 * 更新时只覆盖请求体里**出现过的**键，没出现的沿用原值：富文本编辑页只回传
 * title / venue / date / description 等少数字段，不能因为少发就把封面、二维码、
 * 收集项一起清掉。
 *
 * `existing` 为空表示新建：这时日期、时间必填，状态默认「需审核」。
 */
async function exhibitionInput(body, existing) {
  const config = await limits();
  const source = body || {};
  const current = existing || {};
  const creating = !existing;

  const title = text(source.title, { label: '展会名称', max: config.exhibitionTitle, required: false });
  if (!title) {
    throw badRequest('展会名称不能为空');
  }

  const venue =
    given(source, 'venue') || creating
      ? text(source.venue, { label: '展会地点', max: config.exhibitionVenue, required: false })
      : current.venue || '';
  const category =
    given(source, 'category') || creating
      ? text(source.category, { label: '展会分类', max: config.category, required: false })
      : current.category || '';
  const date =
    given(source, 'date') || creating
      ? isoDate(source.date, { label: '展会日期', required: true })
      : current.exhibition_date;
  const time =
    given(source, 'time') || creating ? timeRange(source.time, { label: '展会时间', required: true }) : current.time;

  let status = current.status || 'review';
  if (given(source, 'status') && String(source.status).trim() !== '') {
    status = labels.toExhibitionStatus(source.status);
    if (!status) {
      throw badRequest(STATUS_HINT);
    }
  }

  const registrationStart =
    given(source, 'registrationStart') || creating
      ? isoDate(source.registrationStart, { label: '报名开始日期' })
      : current.registration_start || '';
  const registrationEnd =
    given(source, 'registrationEnd') || creating
      ? isoDate(source.registrationEnd, { label: '报名截止日期' })
      : current.registration_end || '';
  if (registrationStart && registrationEnd && registrationEnd < registrationStart) {
    throw badRequest('报名截止日期不能早于开始日期');
  }

  const description = given(source, 'description')
    ? String(source.description === undefined || source.description === null ? '' : source.description)
    : current.description || '';
  // 存库的格式要和对外返回的一致：读取时按正文嗅探 HTML（见 payloads.js），
  // 这里在写入时做同一件事，否则同一段富文本会被当成 Markdown 渲染。
  const requestedFormat = given(source, 'descriptionFormat')
    ? source.descriptionFormat === 'html'
      ? 'html'
      : 'md'
    : current.description_format || 'md';
  const descriptionFormat = requestedFormat === 'html' || looksLikeHtml(description) ? 'html' : 'md';

  return {
    title,
    venue,
    category,
    date,
    time,
    status,
    registrationStart,
    registrationEnd,
    description,
    descriptionFormat,
    highlights: given(source, 'highlights')
      ? stringList(source.highlights, { label: '展会亮点' })
      : Array.isArray(current.highlights)
        ? current.highlights
        : [],
    imageUri: given(source, 'imageUri') ? String(source.imageUri || '') : current.image_uri || '',
    // 新建时给一个默认备注：列表与详情页会直接显示它。
    exhibitorNote: given(source, 'exhibitorNote')
      ? String(source.exhibitorNote || '')
      : creating
        ? '主办方公开信息'
        : current.exhibitor_note || '',
    qrEnabled: given(source, 'qrEnabled') ? bool(source.qrEnabled, false) : Boolean(current.qr_enabled),
    // 收集项允许跟展会一起保存（页面表单就是这么发的）；没带就保持原样。
    fields: Array.isArray(source.fields) && source.fields.length > 0 ? normalizeFields(source.fields, config) : null,
  };
}

// ── 路由（`/month`、`/categories` 必须声明在 `/:id` 之前）────────

/**
 * GET /api/v1/exhibitions
 * 展会列表；`?query=` 在标题 / 地点 / 分类 / 简介上模糊匹配。返回数组。
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const keyword = String(req.query.query || '').trim();
    const params = [];
    let where = '';
    if (keyword) {
      params.push(likePattern(keyword));
      where = 'WHERE e.title ILIKE $1 OR e.venue ILIKE $1 OR e.category ILIKE $1 OR e.description ILIKE $1';
    }
    const result = await query(
      `
            SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM}
            ${where}
            ORDER BY e.exhibition_date, e.id
        `,
      params,
    );
    res.json(result.rows.map(exhibitionPayload));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/exhibitions/month?year=&month=&day=
 *
 * 月视图：`{ year, month, day, monthLabel, eventDays, exhibitions, selected }`。
 *
 * 请求哪个月就返回哪个月（空月份不回落到有展会的月份，「首次打开看哪个月」由
 * bootstrap 的 `calendar.landing` 决定）；`day` 缺省或 <= 0 时落到当月第一个有展会的
 * 日期，显式给了日期就原样返回——那天没有展会时 `selected` 是空数组，由页面显示空状态。
 */
router.get('/month', optionalAuth, async (req, res, next) => {
  try {
    let requestedYear = req.query.year;
    let requestedMonth = req.query.month;
    if (!requestedYear || !requestedMonth) {
      const landing = await landingMonth();
      requestedYear = requestedYear || landing.year;
      requestedMonth = requestedMonth || landing.month;
    }
    const year = int(requestedYear, { label: '年份', min: 1970, max: 9999 });
    const month = int(requestedMonth, { label: '月份', min: 1, max: 12 });
    let day = int(req.query.day, { label: '日期', min: 0, max: 31, fallback: 0 });

    const result = await query(
      `
            SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM}
            WHERE EXTRACT(YEAR FROM e.exhibition_date)::int = $1
              AND EXTRACT(MONTH FROM e.exhibition_date)::int = $2
            ORDER BY e.exhibition_date, e.id
        `,
      [year, month],
    );

    const items = result.rows.map(exhibitionPayload);
    const eventDays = [...new Set(items.map((item) => item.day))].sort((a, b) => a - b);
    if (day <= 0) {
      day = eventDays[0] || 0;
    }
    res.json({
      year,
      month,
      day,
      monthLabel: `${year} 年 ${month} 月`,
      eventDays,
      exhibitions: items.map(monthSummary),
      selected: items.filter((item) => item.day === day).map(monthSummary),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/exhibitions/categories
 * 展会分类来自服务器设置（管理-设置里维护的那一份）。返回字符串数组。
 */
router.get('/categories', optionalAuth, async (req, res, next) => {
  try {
    const categories = await readSection('categories');
    res.json(Array.isArray(categories) ? categories : []);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/exhibitions/:id
 * 详情：`{ found, exhibition, fields }`；不存在时 HTTP 200 + `{ found:false, error }`。
 */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const row = await findRow(req.params.id);
    if (!row) {
      res.json({ found: false, error: NOT_FOUND_TEXT });
      return;
    }
    res.json({
      found: true,
      exhibition: exhibitionPayload(row),
      fields: await loadFields(row.id),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/exhibitions
 * 新建展会：展商 / 管理员可用，`exhibitor_id` 记成当前登录用户（管理员也记自己）。
 *
 * 受限账号（管理员不受限）不能再发布新展会 → 403（`notLimited('exhibition')` 排在角色检查前，
 * 受限的普通用户也能拿到「账号已被限制」这个原因）。
 */
router.post('/', authenticate, notLimited('exhibition'), exhibitorOnly, (req, res, next) => {
  mutate(res, next, async () => {
    const input = await exhibitionInput(req.body);
    const id = newId('exh');
    await transaction(async (client) => {
      await client.query(
        `
                INSERT INTO exhibitions (id, title, venue, time, exhibition_date, status, category,
                    description, description_format, highlights, image_uri, exhibitor_note,
                    registration_start, registration_end, qr_enabled, exhibitor_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            `,
        [
          id,
          input.title,
          input.venue,
          input.time,
          input.date,
          input.status,
          input.category,
          input.description,
          input.descriptionFormat,
          JSON.stringify(input.highlights),
          input.imageUri,
          input.exhibitorNote,
          input.registrationStart || null,
          input.registrationEnd || null,
          input.qrEnabled,
          req.user.userId,
        ],
      );
      if (input.fields) {
        await replaceFields(client, id, input.fields);
      }
    });
    return { exhibition: exhibitionPayload(await findRow(id)) };
  });
});

/**
 * PUT /api/v1/exhibitions/:id
 * 更新展会：只有自己办的展会（或管理员）能改；受限账号一律 403「不能修改展会」。
 */
router.put('/:id', authenticate, notLimited('exhibitionUpdate'), exhibitorOnly, async (req, res, next) => {
  try {
    const existing = await manageableRow(req, req.params.id);
    await mutate(res, next, async () => {
      const input = await exhibitionInput(req.body, existing);
      await transaction(async (client) => {
        await client.query(
          `
                    UPDATE exhibitions SET
                        title = $2, venue = $3, time = $4, exhibition_date = $5, status = $6,
                        category = $7, description = $8, description_format = $9, highlights = $10,
                        image_uri = $11, exhibitor_note = $12, registration_start = $13,
                        registration_end = $14, qr_enabled = $15, updated_at = now()
                    WHERE id = $1
                `,
          [
            existing.id,
            input.title,
            input.venue,
            input.time,
            input.date,
            input.status,
            input.category,
            input.description,
            input.descriptionFormat,
            JSON.stringify(input.highlights),
            input.imageUri,
            input.exhibitorNote,
            input.registrationStart || null,
            input.registrationEnd || null,
            input.qrEnabled,
          ],
        );
        if (input.fields) {
          await replaceFields(client, existing.id, input.fields);
        }
      });
      return { exhibition: exhibitionPayload(await findRow(existing.id)) };
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/exhibitions/:id
 * 删除展会；报名与收集项按外键 `ON DELETE CASCADE` 一起清掉。
 * 受限账号一律 403「不能删除展会」（破坏性操作比编辑更该拦）。
 */
router.delete('/:id', authenticate, notLimited('exhibitionDelete'), exhibitorOnly, async (req, res, next) => {
  try {
    const existing = await manageableRow(req, req.params.id);
    await mutate(res, next, async () => {
      await query('DELETE FROM exhibitions WHERE id = $1', [existing.id]);
      return {};
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/exhibitions/:id/status
 * 只改报名方式 / 状态；`status` 接受中文标签或英文代码。
 * 这属于报名设置，受限账号一律 403「不能修改报名设置」。
 */
router.put('/:id/status', authenticate, notLimited('exhibitionStatus'), exhibitorOnly, async (req, res, next) => {
  try {
    const existing = await manageableRow(req, req.params.id);
    await mutate(res, next, async () => {
      const status = labels.toExhibitionStatus(req.body && req.body.status);
      if (!status) {
        throw badRequest(STATUS_HINT);
      }
      await query('UPDATE exhibitions SET status = $2, updated_at = now() WHERE id = $1', [existing.id, status]);
      return { exhibition: exhibitionPayload(await findRow(existing.id)) };
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/exhibitions/:id/fields
 * 报名收集项数组；没有配置过时返回默认三项（页面据此渲染出一份可填的报名表）。
 */
router.get('/:id/fields', optionalAuth, async (req, res, next) => {
  try {
    res.json(await loadFields(req.params.id));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/exhibitions/:id/fields
 * 覆盖收集项：整体替换（删掉旧的，按数组顺序写新的）；受限账号一律 403「不能修改报名设置」。
 */
router.put('/:id/fields', authenticate, notLimited('exhibitionFields'), exhibitorOnly, async (req, res, next) => {
  try {
    const existing = await manageableRow(req, req.params.id);
    await mutate(res, next, async () => {
      const fields = normalizeFields(req.body && req.body.fields, await limits());
      await transaction((client) => replaceFields(client, existing.id, fields));
      return { fields: await loadFields(existing.id) };
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
// 报名提交时的必填 / 选项校验要用同一份收集项（含「没配置就回退默认三项」的规则），
// 因此把取数函数与默认值导出给 registrations.js 复用，避免两处各写一遍默认项。
module.exports.loadFields = loadFields;
module.exports.DEFAULT_FIELDS = DEFAULT_FIELDS;
