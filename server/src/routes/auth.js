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
const {
  issueSession, rotateRefreshToken, revokeRefreshToken, revokeAllForUser,
} = require('../domain/session');
const { badRequest } = require('../domain/errors');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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
  return userPayload(row, capabilities(row.role));
}

/**
 * POST /api/v1/auth/login
 * 用户名 + 密码换令牌。密码错误与账号不存在给同一条提示，避免暴露账号是否存在。
 */
router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) {
      res.json(failure('请输入账号与密码'));
      return;
    }
    const result = await query(
      'SELECT id, username, password_hash, status FROM users WHERE lower(username) = lower($1)',
      [username],
    );
    const account = result.rows[0];
    const matched = account ? await bcrypt.compare(password, account.password_hash) : false;
    if (!account || !matched) {
      res.json(failure('账号或密码不正确'));
      return;
    }
    if (account.status === 'banned') {
      res.json(failure('账号已被封禁，请联系管理员'));
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
 * POST /api/v1/auth/register
 * 自助注册固定为普通用户；用户名 / 密码长度按管理员配置的上限校验。
 */
router.post('/register', async (req, res, next) => {
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
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      res.json(failure('请输入有效的邮箱地址'));
      return;
    }
    const existing = await query(
      'SELECT username, email FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)',
      [username, email],
    );
    if (existing.rows.some((row) => row.username.toLowerCase() === username.toLowerCase())) {
      res.json(failure('该用户名已被注册'));
      return;
    }
    if (existing.rows.some((row) => String(row.email).toLowerCase() === email.toLowerCase())) {
      res.json(failure('该邮箱已被注册'));
      return;
    }
    const id = `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const passwordHash = await bcrypt.hash(password, 10);
    await query(`
            INSERT INTO users (id, username, password_hash, email, nickname, role)
            VALUES ($1, $2, $3, $4, $5, 'user')
        `, [id, username, passwordHash, email, username]);
    const session = await issueSession({ id, username, role: 'user' });
    res.json({ ok: true, error: '', ...session, user: await loadUser(id) });
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
