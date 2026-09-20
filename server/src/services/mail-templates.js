/**
 * 验证码邮件的文案与结构。
 *
 * 这里是**唯一**允许写死用户可见中文的地方，且不在 `res/values/strings_frontend.xml`：
 * 那套文案由 `scripts/extract-strings.js` 从前端 `assets/web/js` 抽出来喂给 WebView，
 * 而验证码邮件由后端渲染、直接进收件箱，跟前端资源没有关系（`check-strings.js` 只覆盖前端）。
 *
 * 三条内容上的讲究：
 * 1. **中英双语同封**：收件人可能是 QQ / 163 / Gmail，双语正文比猜语言稳；
 * 2. **不放链接**：验证码邮件里带链接，既是钓鱼邮件的典型特征（拉低送达率），
 *    也让用户养成「点邮件里的链接」的坏习惯；
 * 3. **任何来自管理员设置的字段（品牌名）都要转义 / 清洗**：品牌名进 HTML 要转义，
 *    进主题要清掉换行 —— 否则 `\r\n` 就是邮件头注入。
 */

/** 用途 → 中英标签。键与 `email_codes.purpose` 的 CHECK 约束一一对应。 */
const PURPOSES = {
  register: { zh: '注册', en: 'sign-up verification' },
  reset: { zh: '找回密码', en: 'password reset' },
  login: { zh: '登录', en: 'sign-in verification' },
  enable2fa: { zh: '开启两步验证', en: 'two-factor setup' },
  email: { zh: '更换邮箱', en: 'email change' },
};

const PURPOSE_KEYS = Object.keys(PURPOSES);

/**
 * 主题里的用途后缀。
 *
 * 标签都是「您正在做的那件事」（注册 / 开启两步验证…），直接拼「验证码」就会出现
 * 「开启两步验证验证码」这种叠字；标签本身已经以「验证」结尾时只补一个「码」。
 */
function subjectSuffix(zhLabel) {
  return zhLabel.endsWith('验证') ? '码' : '验证码';
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML 转义（品牌名、验证码都从这里过一遍）。 */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * 清洗邮件头字段：换行与其它控制字符会让一个字段变成两个头（邮件头注入），
 * 而主题里的品牌名来自管理员设置，属于用户可控输入。
 */
function sanitizeHeader(value, fallback = '') {
  const text = String(value === undefined || value === null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return text || fallback;
}

/**
 * 生成一封验证码邮件。
 *
 * @param {object} options
 * @param {string} options.purpose  `register` / `reset` / `login` / `enable2fa` / `email`。
 * @param {string|number} options.code 4–8 位数字；格式不对直接抛错，宁可不发也不发一封没码的邮件。
 * @param {number} [options.expiresInMin] 有效期（分钟），与后端实际 TTL 保持一致。
 * @param {{zh?: string, en?: string}} [options.brand] 应用名，来自服务器设置。
 * @returns {{subject: string, text: string, html: string}}
 */
function verificationMail(options = {}) {
  const { purpose, code, expiresInMin, brand } = options;
  const label = PURPOSES[purpose] || PURPOSES.register;
  const zhBrand = sanitizeHeader(brand && brand.zh, '展会排期助手');
  const enBrand = sanitizeHeader(brand && brand.en, 'ExpoHub');

  const digits = String(code === undefined || code === null ? '' : code).trim();
  if (!/^\d{4,8}$/.test(digits)) {
    throw new Error(`验证码必须是 4-8 位数字，收到的是「${digits}」`);
  }
  const minutes = Number(expiresInMin) > 0 ? Number(expiresInMin) : 10;

  const subject = `【${zhBrand}】${label.zh}${subjectSuffix(label.zh)}`;

  const text = [
    '您好，',
    '',
    `您正在${label.zh}（${enBrand} - ${label.en}）。`,
    '',
    `验证码：${digits}`,
    '',
    `验证码 ${minutes} 分钟内有效，请勿转发给他人。`,
    '如果这不是您本人的操作，忽略本邮件即可，账号不会受影响。',
    '',
    '———',
    `${enBrand} - ${label.en} code: ${digits}`,
    `This code expires in ${minutes} minutes. Never share it with anyone.`,
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#F7F6F3;'
      + 'font:16px/1.7 -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#20252B">',
    '<div style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #C5CAD1;'
      + 'border-radius:12px;padding:24px">',
    `<p style="margin:0 0 12px">您好，您正在${escapeHtml(label.zh)}（${escapeHtml(enBrand)}`
      + ` - ${escapeHtml(label.en)}）。</p>`,
    '<p style="margin:0 0 8px;font-size:18px;font-weight:700">验证码</p>',
    '<p style="margin:0 0 16px;font:700 30px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + `letter-spacing:6px;color:#C05621">${escapeHtml(digits)}</p>`,
    `<p style="margin:0 0 16px;color:#626A74">${minutes} 分钟内有效，请勿转发给他人。`
      + '如果这不是您本人的操作，忽略本邮件即可，账号不会受影响。</p>',
    '<hr style="border:none;border-top:1px solid #C5CAD1;margin:20px 0">',
    `<p style="margin:0;color:#626A74;font-size:14px">${escapeHtml(enBrand)} - `
      + `${escapeHtml(label.en)} code: <strong>${escapeHtml(digits)}</strong><br>`
      + `This code expires in ${minutes} minutes. Never share it with anyone.</p>`,
    '</div></body></html>',
  ].join('\n');

  return { subject, text, html };
}

module.exports = {
  PURPOSES,
  PURPOSE_KEYS,
  escapeHtml,
  sanitizeHeader,
  verificationMail,
};
