/**
 * 邮箱验证码：签发、校验与限流。
 *
 * 用途（`email_codes.purpose`）：`register`（注册）、`reset`（找回密码）、`login`（两步验证）、
 * `enable2fa`（开启两步验证）、`email`（更换邮箱）。
 *
 * 六条设计约束，每条都有对应用例：
 * 1. **只存哈希**：库里存 `sha256(id + ':' + code)`，明文码只出现在发出去的那封邮件里；
 * 2. **码定长 6 位数字、10 分钟过期、单码最多 5 次尝试**，尝试用尽即作废（避免慢慢爆破）；
 * 3. **命中即消费**：校验成功用 `UPDATE … WHERE consumed_at IS NULL` 原子消费，并发用两次只有一个成功；
 * 4. **发码限流按库里计数**（同一用途 + 同一邮箱 60 秒 1 条 / 1 小时 5 条 / 24 小时 15 条，同一 IP 1 小时 20 条）——
 *    不用 `middleware/rate-limit.js` 的内存窗口：那个重启就归零，而验证码是**发出去就要花钱、
 *    还可能被用来骚扰他人**的资源；
 * 5. **先落库、再返回，发信在后台**（`send()` 不 await）：前端 `api.js` 的请求超时是 3 秒，
 *    同步等一次 SMTP 往返会把注册页卡成超时错误；
 * 6. **发信结果写 `mail_log`**：状态页的「邮件通道」自检项读的就是它，「发信成功但用户收不到」
 *    这类故障没有留痕根本查不出来。
 *
 * 分层说明：本文件属于业务层，但会调用 `services/mailer.js` 发信 —— 发信是这件事的副作用，
 * 不放在这里的话，码的有效期、尝试次数与限流就散在路由里了。
 */

const crypto = require('node:crypto');
const { query } = require('../config/pool');
const { ApiError, badRequest } = require('./errors');
const { readSection } = require('./settings');
const { send } = require('../services/mailer');
const { verificationMail, PURPOSE_KEYS } = require('../services/mail-templates');

/** 验证码有效期（分钟）。前端要显示的「10 分钟内有效」跟着它走。 */
const CODE_TTL_MIN = 10;

/**
 * 验证码业务失败：码不对、过期、次数用尽、已被使用、缺参数。
 *
 * 单独一个类型是为了让路由把它翻成 **200 + `{ ok:false, error }`** —— 这类失败是
 * 「可预期的规则失败」（和登录密码错误一样），页面要就地提示，而不是走 4xx 的异常通道。
 * 限流（429）仍然是 `ApiError`：那是另一类语义。
 */
class CodeRejected extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodeRejected';
  }
}

/** 判断是不是「验证码业务失败」，供路由决定用哪种信封。 */
function isCodeRejected(error) {
  return error instanceof CodeRejected;
}

/** 单枚码最多尝试几次；用尽即作废。 */
const MAX_ATTEMPTS = 5;

/** 码长（位）。 */
const CODE_LENGTH = 6;

/** 同一用途 + 同一邮箱的发码节奏。 */
const RESEND_COOLDOWN_SEC = 60;
const SEND_PER_HOUR = 5;
const SEND_PER_DAY = 15;

/** 同一 IP 每小时最多发几条（挡住换邮箱刷发信额度）。 */
const IP_SEND_PER_HOUR = 20;

/** 邮箱一律小写比对：大小写不同不该被当成两个邮箱。 */
function normalizeEmail(email) {
  return String(email === undefined || email === null ? '' : email).trim().toLowerCase();
}

/** 码的哈希：把行 id 当盐，两个用途下同样的码也不会撞哈希。 */
function hashCode(code, id) {
  return crypto.createHash('sha256').update(`${id}:${code}`).digest('hex');
}

/**
 * 等长比较，避免按字节提前返回带来的时间差。
 * 长度不同直接判否 —— `timingSafeEqual` 对不等长入参会抛异常。
 */
function sameHash(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** 均匀的 6 位码（`randomInt` 上限取 10^6，不引入取模偏差）。 */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * 打码后的邮箱：`zhangsan@example.com` → `zh***@example.com`。
 *
 * 两步验证那一步要告诉用户「码发到哪个邮箱了」，但登录页可能被旁人看到，
 * 所以只回打码后的地址（用户自己清楚完整地址是什么）。
 */
function maskEmail(email) {
  const text = normalizeEmail(email);
  const at = text.indexOf('@');
  if (at <= 0) {
    return text ? '***' : '';
  }
  const name = text.slice(0, at);
  return `${name.slice(0, Math.min(2, name.length))}***${text.slice(at)}`;
}

/** 用途校验：写错用途会让 CHECK 约束报 500，不如在这里给 400（这是代码缺陷，不是用户操作失败）。 */
function assertPurpose(purpose) {
  if (!PURPOSE_KEYS.includes(purpose)) {
    throw badRequest('验证码用途不合法');
  }
}

/**
 * 发码限流：全部按 `email_codes` 里的真实行数算，重启不清零。
 * 一分钟内的重复请求给 429（与项目里其它限流一致，前端按 4xx 提示原因）。
 */
async function assertSendAllowed({ purpose, email, ip }) {
  const counted = await query(`
        SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute') AS last_minute,
               count(*) FILTER (WHERE created_at > now() - interval '1 hour')   AS last_hour,
               count(*) FILTER (WHERE created_at > now() - interval '1 day')    AS last_day
          FROM email_codes
         WHERE purpose = $1 AND lower(email) = $2
    `, [purpose, email]);
  const row = counted.rows[0];
  if (Number(row.last_minute) > 0) {
    throw new ApiError(429, `验证码已发送，请 ${RESEND_COOLDOWN_SEC} 秒后再试`);
  }
  if (Number(row.last_hour) >= SEND_PER_HOUR) {
    throw new ApiError(429, '获取验证码过于频繁，请稍后再试');
  }
  if (Number(row.last_day) >= SEND_PER_DAY) {
    throw new ApiError(429, '今天获取验证码的次数已达上限，请明天再试');
  }
  if (ip) {
    const byIp = await query(`
            SELECT count(*)::int AS total FROM email_codes
             WHERE ip = $1 AND created_at > now() - interval '1 hour'
        `, [ip]);
    if (Number(byIp.rows[0].total) >= IP_SEND_PER_HOUR) {
      throw new ApiError(429, '当前网络获取验证码过于频繁，请稍后再试');
    }
  }
}

/** 清理过期的验证码；失败不影响本次发码。 */
function purgeStaleCodes() {
  return query(`
        DELETE FROM email_codes
         WHERE created_at < now() - interval '1 day'
    `).catch((error) => {
    console.warn('清理过期验证码失败：', error.message);
  });
}

/** 发信留痕；失败只记日志 —— 留痕本身不该把发码接口带崩。 */
async function recordMailLog({ to, purpose, result }) {
  try {
    await query(`
            INSERT INTO mail_log (id, to_email, purpose, transport, status, error)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
      crypto.randomUUID(), to, purpose, result.transport || '',
      result.ok ? 'sent' : 'failed', result.ok ? '' : String(result.error || ''),
    ]);
  } catch (error) {
    console.warn('写发信留痕失败：', error.message);
  }
}

/**
 * 把码发出去（不 await）。
 *
 * `brand` 由调用方先读好再传进来：一是品牌名来自服务器设置，二是这样 `send()` 在
 * **同一个 tick** 里就被调用（`memory` 通道的收件箱当场就有邮件，契约用例不必轮询）。
 */
function deliver({
  to, purpose, code, brand,
}) {
  const mail = verificationMail({
    purpose, code, expiresInMin: CODE_TTL_MIN, brand,
  });
  send({
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    fromName: (brand && brand.zh) || '',
    purpose,
  })
    .then((result) => recordMailLog({ to, purpose, result }))
    .catch((error) => console.warn('发送验证码邮件时出错：', error.message));
}

/**
 * 签发一枚验证码并把它发出去。
 *
 * @param {object} options
 * @param {string} options.purpose 用途（见 `PURPOSE_KEYS`）。
 * @param {string} options.email 收件邮箱。
 * @param {string} [options.userId] 已存在的用户（注册用途没有用户，给 null）。
 * @param {object} [options.payload] 挂在这次验证上的数据（注册用途放待建账号）。
 * @param {string} [options.ip] 请求来源，用于按 IP 限流。
 * @param {boolean} [options.silent] 只落库、不发信。找回密码用它保证「这个邮箱注册过没有」
 *   在**响应内容与耗时上都看不出来**：不存在的邮箱照样走一遍发码限流与落库，只是不发邮件
 *   （与登录里「账号不存在也比一次 bcrypt」是同一个考虑）。
 * @returns {Promise<{email: string, purpose: string, expiresInSec: number, resendAfterSec: number}>}
 */
async function issueCode(options = {}) {
  const {
    purpose, userId = null, payload = null, ip = '', silent = false,
  } = options;
  assertPurpose(purpose);
  const email = normalizeEmail(options.email);
  if (!email) {
    throw new CodeRejected('缺少邮箱地址');
  }
  await assertSendAllowed({ purpose, email, ip });

  // 品牌名读不到不该拦住发码：模板里本来就有兜底的应用名。
  const brand = await readSection('brand').catch(() => null);

  const id = `code-${crypto.randomUUID()}`;
  const code = generateCode();
  await query(`
        INSERT INTO email_codes (id, purpose, email, user_id, code_hash, payload, expires_at, ip)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() + ($7 || ' minutes')::interval, $8)
    `, [
    id, purpose, email, userId, hashCode(code, id),
    payload ? JSON.stringify(payload) : null, String(CODE_TTL_MIN), ip,
  ]);
  purgeStaleCodes();
  if (!silent) {
    deliver({
      to: email, purpose, code, brand,
    });
  }

  return {
    email,
    purpose,
    expiresInSec: CODE_TTL_MIN * 60,
    resendAfterSec: RESEND_COOLDOWN_SEC,
  };
}

/**
 * 校验并消费一枚验证码。
 *
 * 失败一律抛 `CodeRejected`，由路由翻成 200 + `{ ok:false, error }`（可预期的规则失败，
 * 页面要就地提示）；文案要说清下一步该干什么（重新获取 / 稍后重试）。
 *
 * @returns {Promise<{email: string, payload: object|null}>} 命中那一行上挂的数据。
 */
async function consumeCode(options = {}) {
  const { purpose } = options;
  assertPurpose(purpose);
  const email = normalizeEmail(options.email);
  const code = String(options.code === undefined || options.code === null ? '' : options.code).trim();
  if (!email || !code) {
    throw new CodeRejected('请填写邮箱与验证码');
  }

  const result = await query(`
        SELECT id, user_id, code_hash, payload, attempts, expires_at
          FROM email_codes
         WHERE purpose = $1 AND lower(email) = $2 AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
    `, [purpose, email]);
  const row = result.rows[0];
  if (!row) {
    throw new CodeRejected('验证码不存在或已被使用，请重新获取');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new CodeRejected('验证码已过期，请重新获取');
  }
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    throw new CodeRejected('验证码尝试次数过多，请重新获取');
  }

  if (!sameHash(hashCode(code, row.id), row.code_hash)) {
    // 记一次失败；到上限就把这枚码作废，别让它继续被猜。
    // `$2` 既写进 `attempts`（integer）又参与比较，必须显式转型：
    // 否则 pg 会报 `inconsistent types deduced for parameter $2`（text versus integer）。
    const attempts = Number(row.attempts) + 1;
    await query(`
            UPDATE email_codes
               SET attempts = $2::int,
                   consumed_at = CASE WHEN $2::int >= $3::int THEN now() ELSE consumed_at END
             WHERE id = $1
        `, [row.id, attempts, MAX_ATTEMPTS]);
    throw new CodeRejected('验证码不正确');
  }

  const used = await query(
    'UPDATE email_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL',
    [row.id],
  );
  if (used.rowCount !== 1) {
    // 并发：同一枚码被两个请求同时提交，只有一个能消费到。
    throw new CodeRejected('验证码已被使用，请重新获取');
  }
  return { email, userId: row.user_id || null, payload: row.payload || null };
}

module.exports = {
  CODE_TTL_MIN,
  MAX_ATTEMPTS,
  CODE_LENGTH,
  RESEND_COOLDOWN_SEC,
  SEND_PER_HOUR,
  SEND_PER_DAY,
  IP_SEND_PER_HOUR,
  CodeRejected,
  isCodeRejected,
  normalizeEmail,
  maskEmail,
  hashCode,
  sameHash,
  generateCode,
  issueCode,
  consumeCode,
  purgeStaleCodes,
};
