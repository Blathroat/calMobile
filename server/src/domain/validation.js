/**
 * 入参校验。
 *
 * 长度上限一律取管理员在「管理-设置」里配的 `limits`（`app_settings.limits`），
 * 因此服务端与页面用的是同一套上下限，页面被绕过也拦得住。
 *
 * 校验失败抛 `ApiError(400)`：写路由会把它转成 `{ ok:false, error }` 信封返回给页面。
 */

const { badRequest } = require('./errors');
const { readSection } = require('./settings');

/** 当前生效的字符数上限。 */
async function limits() {
  return readSection('limits');
}

/** 必填文本：去空白、校验长度。 */
function text(value, { label, max, required = true } = {}) {
  const result = String(value === undefined || value === null ? '' : value).trim();
  if (!result) {
    if (required) {
      throw badRequest(`请输入${label || '内容'}`);
    }
    return '';
  }
  if (max && result.length > max) {
    throw badRequest(`${label || '内容'}最多 ${max} 个字符`);
  }
  return result;
}

/** 整数：可给范围与默认值。 */
function int(value, { label, min, max, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw badRequest(`请输入${label || '数值'}`);
  }
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    throw badRequest(`${label || '数值'}必须是整数`);
  }
  if (min !== undefined && number < min) {
    throw badRequest(`${label || '数值'}不能小于 ${min}`);
  }
  if (max !== undefined && number > max) {
    throw badRequest(`${label || '数值'}不能大于 ${max}`);
  }
  return number;
}

/** 布尔：接受 true/false、"true"/"false"、1/0。 */
function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return value === 'true' || value === 1 || value === '1';
}

/** 日期：只接受 YYYY-MM-DD，返回 ISO 串或 ''。 */
function isoDate(value, { label, required = false } = {}) {
  const result = String(value === undefined || value === null ? '' : value).trim();
  if (!result) {
    if (required) {
      throw badRequest(`请选择${label || '日期'}`);
    }
    return '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match) {
    throw badRequest(`${label || '日期'}格式应为 YYYY-MM-DD`);
  }
  const [, year, month, day] = match;
  const date = new Date(`${result}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${label || '日期'}不是一个有效日期`);
  }
  // 2026-02-31 这类会被 Date 规范化成 3 月，需要回头比对一次。
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== `${year}-${month}-${day}`) {
    throw badRequest(`${label || '日期'}不是一个有效日期`);
  }
  return result;
}

/** 时间：接受 09:00-17:30 或 09:00。 */
function timeRange(value, { label = '时间', required = true } = {}) {
  const result = String(value === undefined || value === null ? '' : value).trim();
  if (!result) {
    if (required) {
      throw badRequest(`请输入${label}`);
    }
    return '';
  }
  if (!/^\d{2}:\d{2}(-\d{2}:\d{2})?$/.test(result)) {
    throw badRequest(`${label}格式应为 09:00-17:30`);
  }
  return result;
}

/** 字符串数组：用于 highlights、options、categories。 */
function stringList(value, { label, max = 40, itemMax = 60 } = {}) {
  const items = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of items) {
    const text2 = String(item === undefined || item === null ? '' : item).trim();
    if (!text2) {
      continue;
    }
    if (text2.length > itemMax) {
      throw badRequest(`${label || '列表项'}单项最多 ${itemMax} 个字符`);
    }
    result.push(text2);
    if (result.length >= max) {
      break;
    }
  }
  return result;
}

module.exports = {
  limits,
  text,
  int,
  bool,
  isoDate,
  timeRange,
  stringList,
};
