/**
 * 会话与令牌。
 *
 * - **访问令牌**是短时效 JWT（默认 15 分钟），放在 `Authorization: Bearer`；
 * - **刷新令牌**是随机串，只把 sha256 哈希落库，可撤销、可轮换；
 * - 登录、刷新、退出都会更新 `refresh_tokens`，因此「退出登录」是真的失效
 *   （令牌在数据库里被撤销），不只是客户端把本地缓存丢掉。
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../config/pool');
const { accessSecret, refreshSecret, accessExpiresIn, refreshExpiresIn } = require('../config/auth');
const { unauthorized } = require('./errors');

/** 刷新令牌的有效期（天）：从 JWT_REFRESH_EXPIRES_IN（如 7d）解析。 */
function refreshDays() {
  const match = /^(\d+)d$/.exec(String(refreshExpiresIn));
  return match ? Number(match[1]) : 7;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 签发访问令牌。 */
function signAccessToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    accessSecret,
    { expiresIn: accessExpiresIn },
  );
}

/**
 * 新建一个刷新令牌并落库。
 * 刷新令牌本身是随机串，不是 JWT：它必须能被撤销，落在数据库里才作数。
 */
async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query(`
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
    `, [crypto.randomUUID(), userId, hashToken(token), String(refreshDays())]);
  // 顺手清掉过期与已撤销的：不清的话这张表会随每次登录一直长。
  purgeStaleTokens();
  return token;
}

/** 清理已经过期或已撤销的刷新令牌（失败不影响登录）。 */
function purgeStaleTokens() {
  return query(`
        DELETE FROM refresh_tokens
        WHERE expires_at < now() - interval '1 day'
           OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')
    `).catch((error) => {
    console.warn('清理过期刷新令牌失败：', error.message);
  });
}

/** 登录成功后一次性签发两个令牌。 */
async function issueSession(user) {
  return {
    token: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
  };
}

/**
 * 用刷新令牌换一套新令牌（轮换：旧的立即作废）。
 * 校验顺序：存在 → 未撤销 → 未过期，任何一步不通过都按「登录已失效」处理。
 *
 * **撤销必须是原子的**：`SELECT` 出来的 `revoked_at` 只是给人看的快速路径，
 * 真正说了算的是 `UPDATE … WHERE revoked_at IS NULL` 的 `rowCount`。以前是
 * 「先 SELECT 判断、再按 id UPDATE」，同一个刷新令牌并发用两次时两个请求都会通过
 * 判断、各换一套新令牌（TOCTOU）；现在只有把这一行从「未撤销」改成「已撤销」的那个
 * 请求能拿到新令牌，另一个按重放处理。
 */
async function rotateRefreshToken(token) {
  const hash = hashToken(token);
  const result = await query(`
        SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1
    `, [hash]);
  if (result.rows.length === 0) {
    throw unauthorized('登录状态已失效，请重新登录');
  }
  const row = result.rows[0];
  if (row.revoked_at) {
    throw unauthorized('登录状态已失效，请重新登录');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw unauthorized('登录已过期，请重新登录');
  }
  const user = await query('SELECT id, username, role, status FROM users WHERE id = $1', [row.user_id]);
  if (user.rows.length === 0 || user.rows[0].status === 'banned') {
    throw unauthorized('账号不可用，请重新登录');
  }
  const revoked = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [row.id],
  );
  if (revoked.rowCount !== 1) {
    // 并发重放：这一行已经被另一个请求撤销掉了，这个令牌不能再换令牌。
    throw unauthorized('登录状态已失效，请重新登录');
  }
  const account = user.rows[0];
  return {
    user: account,
    token: signAccessToken(account),
    refreshToken: await issueRefreshToken(account.id),
  };
}

/** 退出登录：撤销该刷新令牌；访问令牌等它自然过期。 */
async function revokeRefreshToken(token) {
  if (!token) {
    return false;
  }
  const result = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token)],
  );
  return result.rowCount > 0;
}

/** 撤销某个用户的全部刷新令牌（改密码、封禁账号时用）。 */
async function revokeAllForUser(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

module.exports = {
  signAccessToken,
  issueRefreshToken,
  issueSession,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  purgeStaleTokens,
  hashToken,
  refreshSecret,
};
