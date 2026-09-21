/**
 * 认证路由：登录 / 注册 / 访客 / 退出 / 刷新令牌。
 *
 * 响应保持应用层信封 `{ ok, error, ... }`（前端页面按 `.ok` 判断），
 * HTTP 状态码只用于传输与认证问题：401 / 403 会被前端 api.js 当作错误抛出并就地提示。
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/pool');
const { USER_COLUMNS, USER_FROM } = require('../domain/queries');
const { userPayload, guestPayload } = require('../domain/payloads');
const { capabilities } = require('../domain/permissions');
const { limits } = require('../domain/validation');
const { issueSession, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } = require('../domain/session');
const { issueCode, consumeCode, isCodeRejected, maskEmail } = require('../domain/otp');
const { secondFactorState, verifySecondFactor } = require('../domain/two-factor');
const { issueTicket, findTicket, consumeTicket, countTicketFailure } = require('../domain/preauth');
const { badRequest } = require('../domain/errors');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

/**
 * 登录 / 注册限流：同一 IP + 同一账号 5 分钟内最多 10 次**失败**（见 middleware/rate-limit.js），
 * 挡住脚本化撞库。成功登录不计数，否则演示时连着登录几个人就会把自己关在门外。
 */
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: '尝试过于频繁，请稍后再试',
});

/**
 * 账号不存在时用来「陪着比一次」的哈希（明文是随机的，永远比不中）。
 *
 * 直接用 bcrypt.hashSync 在模块加载时算一次，避免每次登录都重新计算——
 * 它的作用只是让「账号不存在」与「密码错误」两条路径的耗时接近。
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(`missing-${Date.now()}`, 10);

/** 邮箱格式：与 `routes/profile.js` 的校验保持一致（注册与找回密码共用）。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 响应统一信封：成功时 ok=true 且 error 为空串。 */
function failure(message) {
  return { ok: false, error: message };
}

/** 读取一个用户行并拼成前端要的用户态。 */
async function loadUser(id) {
  const result = await query(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  return userPayload(row, capabilities(row.role, row.status));
}

/**
 * POST /api/v1/auth/login
 * 用户名**或已验证邮箱** + 密码换令牌。密码错误与账号不存在给同一条提示，避免暴露账号是否存在。
 *
 * 两种标识不会互相打架：用户名的字符集不允许 `@`，而邮箱一定含 `@`，所以一个标识只会命中一边；
 * 仍然按「用户名优先」排序，是为了万一将来放宽用户名规则时行为也确定。
 */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) {
      res.json(failure('请输入账号与密码'));
      return;
    }
    const result = await query(
      `
            SELECT id, username, email, email_verified, two_factor_enabled, password_hash, status
              FROM users
             WHERE lower(username) = lower($1) OR lower(email) = lower($1)
             ORDER BY (lower(username) = lower($1)) DESC
             LIMIT 1
        `,
      [username],
    );
    const account = result.rows[0];
    // 账号不存在时也走一次 bcrypt：否则「立即返回」与「比对一次再返回」的耗时差
    // 足以让脚本枚举出哪些用户名真实存在（与上面那条「同一条提示」是同一件事）。
    const hash = account ? account.password_hash : DUMMY_PASSWORD_HASH;
    const matched = await bcrypt.compare(password, hash);
    if (!account || !matched) {
      res.json(failure('账号或密码不正确'));
      return;
    }
    if (account.status === 'banned') {
      res.json(failure('账号已被封禁，请联系管理员'));
      return;
    }

    // 开了两步验证：这一步**只发预认证票 + 验证码，不发令牌**。
    // 密码对了不等于登录成功，否则两步验证只是多一步表演。
    if (account.two_factor_enabled === true) {
      if (account.email_verified !== true || !account.email) {
        // 开启两步验证时会校验邮箱可用；走到这里说明邮箱被改坏了（改邮箱也要过验证，
        // 正常改不出来）。这时不能放行，但也要给一句能照着做的话。
        res.json(failure('两步验证邮箱不可用，请联系管理员关闭两步验证'));
        return;
      }
      const ticket = await issueTicket(account.id);
      const factors = await secondFactorState(account.id);
      const emailUsable = Boolean(factors && factors.emailVerified && factors.email);
      // **绑了验证器就不再自动发邮件码**：那封邮件多半用不上，还会撞上同一邮箱
      // 60 秒一条的冷却（用户输错一次验证器码、想重新登录就会拿到 429）。
      // 需要邮箱验证码时，页面用 POST /auth/login/code 主动要一条。
      const sendEmail = emailUsable && !factors.totpBound;
      const sent = sendEmail
        ? await issueCode({
            purpose: 'login',
            email: account.email,
            userId: account.id,
            ip: req.ip || '',
          })
        : null;
      res.json({
        ok: true,
        error: '',
        twoFactorRequired: true,
        ticket: ticket.ticket,
        expiresInSec: ticket.expiresInSec,
        resendAfterSec: sent ? sent.resendAfterSec : 0,
        // 页面据此决定是「验证码已发送到…」还是「请输入验证器里的码」
        emailSent: Boolean(sent),
        maskedEmail: maskEmail(account.email),
        // 告诉页面这个账号能用哪些第二因子：验证器 / 邮箱验证码 / 备用码
        methods: {
          totp: Boolean(factors && factors.totpBound),
          email: emailUsable,
          backup: Boolean(factors && factors.backupCodesLeft > 0),
        },
      });
      return;
    }

    await query('UPDATE users SET last_login_time = now() WHERE id = $1', [account.id]);
    const session = await issueSession(account);
    res.json({ ok: true, error: '', ...session, user: await loadUser(account.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/login/verify
 * 两步验证第二步：预认证票 + 邮箱验证码 → 真正的会话。
 *
 * 顺序有意为之：**先验码、再消费票**。码不对时票据要留着，用户改一下还能接着用；
 * 票据的消费是原子的（`WHERE consumed_at IS NULL`），并发提交两次只有一个能换到会话。
 */
router.post('/login/verify', authLimiter, async (req, res, next) => {
  try {
    const ticket = String(req.body.ticket || '').trim();
    const code = String(req.body.code || '').trim();
    if (!ticket || !code) {
      res.json(failure('请填写验证码'));
      return;
    }
    const found = await findTicket(ticket);
    if (!found) {
      res.json(failure('验证已过期，请重新登录'));
      return;
    }
    const account = await query(
      'SELECT id, username, role, email, email_verified, totp_secret, status FROM users WHERE id = $1',
      [found.userId],
    );
    const row = account.rows[0];
    if (!row || row.status === 'banned') {
      res.json(failure('账号不可用，请联系管理员'));
      return;
    }

    // 第二因子三选一：验证器 → 邮箱验证码 → 备用码（见 domain/two-factor.js）。
    // 顺序在那边定义，这里只管把失败记到票据上：拿到票也不能慢慢地猜。
    try {
      await verifySecondFactor(row, code);
    } catch (error) {
      if (isCodeRejected(error)) {
        await countTicketFailure(found.id, found.attempts);
        res.json(failure(error.message));
        return;
      }
      throw error;
    }

    if (!(await consumeTicket(found.id))) {
      res.json(failure('验证已使用，请重新登录'));
      return;
    }
    await query('UPDATE users SET last_login_time = now() WHERE id = $1', [row.id]);
    const session = await issueSession(row);
    res.json({ ok: true, error: '', ...session, user: await loadUser(row.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/login/code
 * 两步验证：用同一张预认证票重发验证码（票据本身没消费掉就还有效）。
 */
router.post('/login/code', authLimiter, async (req, res, next) => {
  try {
    const ticket = String(req.body.ticket || '').trim();
    const found = await findTicket(ticket);
    if (!found) {
      res.json(failure('验证已过期，请重新登录'));
      return;
    }
    const account = await query('SELECT id, email, email_verified FROM users WHERE id = $1', [found.userId]);
    const row = account.rows[0];
    if (!row || row.email_verified !== true || !row.email) {
      res.json(failure('两步验证邮箱不可用，请联系管理员关闭两步验证'));
      return;
    }
    const sent = await issueCode({
      purpose: 'login',
      email: row.email,
      userId: row.id,
      ip: req.ip || '',
    });
    res.json({ ok: true, error: '', ...sent, maskedEmail: maskEmail(row.email) });
  } catch (error) {
    next(error);
  }
});

/**
 * 注册冲突检查：用户名与邮箱都要唯一。
 *
 * 邮箱的唯一性最终由 `users_email_unique_idx`（大小写无关、空串除外）兜底；
 * 这里先查一次，是为了在**发码之前**就能给出一句能看懂的话 —— 等用户收完码、输完码
 * 才被告知「该用户名已被注册」太气人。
 *
 * @returns {string} 给用户看的文案；没有冲突就是空串。
 */
async function registrationConflict(username, email) {
  if (!email) {
    return '请输入有效的邮箱地址';
  }
  const existing = await query(
    `
        SELECT lower(username) AS username, lower(email) AS email
          FROM users
         WHERE lower(username) = lower($1) OR lower(email) = lower($2)
    `,
    [username, email],
  );
  if (existing.rows.some((row) => row.username === username.toLowerCase())) {
    return '该用户名已被注册';
  }
  if (existing.rows.some((row) => row.email === email.toLowerCase())) {
    return '该邮箱已被注册';
  }
  return '';
}

/**
 * POST /api/v1/auth/register
 * 注册第一步：校验输入、把待建账号暂存进验证码记录，并把验证码发到邮箱。
 *
 * **这一步不建账号、不发令牌**：邮箱验证通过（`POST /auth/register/verify`）才真的建号。
 * 好处是库里不存在「注册了但邮箱没验证」的半成品账号，也就不需要为这种状态设计一整套
 * 功能限制；待建账号（用户名 + 密码哈希 + 昵称）暂存在 `email_codes.payload` 里，
 * 24 小时后随过期码一起清掉，没验证就等于没注册过。
 */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const textLimits = await limits();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const email = String(req.body.email || '').trim();

    if (username.length < textLimits.usernameMin || username.length > textLimits.usernameMax) {
      res.json(failure(`用户名长度需在 ${textLimits.usernameMin}-${textLimits.usernameMax} 个字符之间`));
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
      res.json(failure('用户名只能包含字母、数字、下划线、点或横线'));
      return;
    }
    if (password.length < textLimits.passwordMin || password.length > textLimits.passwordMax) {
      res.json(failure(`密码长度需在 ${textLimits.passwordMin}-${textLimits.passwordMax} 个字符之间`));
      return;
    }
    if (!email || !EMAIL_PATTERN.test(email) || email.length > 120) {
      res.json(failure('请输入有效的邮箱地址'));
      return;
    }

    const conflict = await registrationConflict(username, email);
    if (conflict) {
      res.json(failure(conflict));
      return;
    }

    // 密码在这一步就变成哈希：待建账号里不该有明文密码，哪怕它只活 10 分钟。
    const passwordHash = await bcrypt.hash(password, 10);
    const ticket = await issueCode({
      purpose: 'register',
      email,
      payload: { username, passwordHash, nickname: username },
      ip: req.ip || '',
    });
    res.json({ ok: true, error: '', ...ticket });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/register/verify
 * 注册第二步：验证码通过 → 建账号 → 发会话。
 *
 * 新账号直接写 `email_verified = true`：这个邮箱刚刚被验证过，它就是被验证的那一个。
 */
router.post('/register/verify', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    const code = String(req.body.code || '').trim();
    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'register', email, code });
    } catch (error) {
      // 码不对 / 过期 / 次数用尽都是**可预期的规则失败**：200 + ok:false，页面就地提示，
      // 与「账号或密码不正确」同一套处理；限流（429）等另走 4xx。
      if (isCodeRejected(error)) {
        res.json(failure(error.message));
        return;
      }
      throw error;
    }
    const pending = consumed.payload || {};
    const username = String(pending.username || '').trim();
    if (!username || !pending.passwordHash) {
      res.json(failure('注册信息已失效，请重新填写'));
      return;
    }

    // 发码到输码之间用户名/邮箱可能已被别人占用。唯一索引是最后一道防线，
    // 这里再查一次，为的是给一句能看懂的话，而不是让 pg 的 23505 冒成 500。
    const conflict = await registrationConflict(username, consumed.email);
    if (conflict) {
      res.json(failure(conflict));
      return;
    }

    const id = `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await query(
        `
                INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified, email_verified_at)
                VALUES ($1, $2, $3, $4, $5, 'user', true, now())
            `,
        [id, username, pending.passwordHash, consumed.email, pending.nickname || username],
      );
    } catch (error) {
      // 唯一索引冲突：两个请求几乎同时验证同一个用户名或邮箱。
      if (error && error.code === '23505') {
        res.json(failure('该用户名或邮箱已被注册'));
        return;
      }
      throw error;
    }
    const session = await issueSession({ id, username, role: 'user' });
    res.json({ ok: true, error: '', ...session, user: await loadUser(id) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/password/forgot
 * 找回密码第一步：把验证码发到该邮箱。
 *
 * **响应与耗时都不透露这个邮箱注册过没有**：不存在的邮箱同样走一遍发码限流与落库
 * （`issueCode({ silent: true })`），只是不发邮件；响应体两种情况完全一致。
 * 所以界面上要写「如果该邮箱已注册，验证码会发送到该邮箱」，而不是「已发送」。
 *
 * 只有**已验证邮箱**的账号能找回：邮箱是身份的凭据，没验证过的邮箱等于没有凭据。
 */
router.post('/password/forgot', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    if (!email || !EMAIL_PATTERN.test(email) || email.length > 120) {
      res.json(failure('请输入有效的邮箱地址'));
      return;
    }
    const found = await query(
      `
            SELECT id FROM users
             WHERE lower(email) = lower($1) AND email_verified = true AND status <> 'banned'
        `,
      [email],
    );
    const account = found.rows[0] || null;
    const ticket = await issueCode({
      purpose: 'reset',
      email,
      userId: account ? account.id : null,
      silent: !account,
      ip: req.ip || '',
    });
    res.json({ ok: true, error: '', ...ticket });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/password/reset
 * 找回密码第二步：验证码通过 → 改密码 → 撤销该用户全部刷新令牌。
 *
 * 撤销刷新令牌是这条路径的关键：找回密码通常意味着「密码可能已经泄露」，
 * 不把其它设备上的登录状态一起断掉，等于只换了门锁却没赶人。
 */
router.post('/password/reset', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '');
    const confirm = String(req.body.confirmPassword || '');

    // 先校验密码再消费验证码：密码填错不该把这枚码烧掉，用户改一下还能继续用。
    if (newPassword !== confirm) {
      res.json(failure('两次输入的新密码不一致'));
      return;
    }
    const bounds = await limits();
    if (newPassword.length < bounds.passwordMin || newPassword.length > bounds.passwordMax) {
      res.json(failure(`密码长度需在 ${bounds.passwordMin}-${bounds.passwordMax} 个字符之间`));
      return;
    }

    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'reset', email, code });
    } catch (error) {
      if (isCodeRejected(error)) {
        res.json(failure(error.message));
        return;
      }
      throw error;
    }

    const found = await query('SELECT id FROM users WHERE lower(email) = lower($1) AND status <> $2', [
      consumed.email,
      'banned',
    ]);
    if (found.rows.length === 0) {
      // 验证码是真的（说明这个邮箱收到过我们发的码），但账号在期间被删或封禁了。
      res.json(failure('账号不存在或已停用，请联系管理员'));
      return;
    }
    const userId = found.rows[0].id;
    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
      userId,
      await bcrypt.hash(newPassword, 10),
    ]);
    await revokeAllForUser(userId);
    res.json({ ok: true, error: '' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/guest
 * 「以访客身份浏览」：不建账号、不发令牌，只返回访客态。
 */
router.post('/guest', (req, res) => {
  res.json({ ok: true, error: '', user: guestPayload() });
});

/**
 * POST /api/v1/auth/logout
 * 撤销刷新令牌；访问令牌等自然过期。
 */
router.post('/logout', async (req, res, next) => {
  try {
    await revokeRefreshToken(String(req.body.refreshToken || ''));
    res.json({ ok: true, error: '' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/refresh
 * 用刷新令牌换新的访问令牌（旧的刷新令牌立即作废）。
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const token = String(req.body.refreshToken || '');
    if (!token) {
      throw badRequest('缺少刷新令牌');
    }
    const rotated = await rotateRefreshToken(token);
    res.json({
      ok: true,
      error: '',
      token: rotated.token,
      refreshToken: rotated.refreshToken,
      user: await loadUser(rotated.user.id),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/auth/logout-all
 * 改密码、封禁等场景：撤销该用户全部刷新令牌。
 */
router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await revokeAllForUser(req.user.userId);
    res.json({ ok: true, error: '' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
