/** 短时、单次并绑定当前会话的身份复核凭据。 */

import crypto from 'node:crypto';
import { query, transaction } from '../config/pool.js';
import { ApiError, badRequest } from './errors.js';

export type SecurityStepUpScope = 'password' | 'email' | 'totp' | 'totp-confirm' | 'factor';

/** TOTP 身份复核沿用数据库限额，防止攻击者对六位动态码无限试探。 */
export async function reserveSecurityStepUpAttempt(userId: string, sessionId: string): Promise<void> {
  await transaction(async (client) => {
    // 同一会话的并发 TOTP 提交串行计数，不能靠并发请求突破五次上限。
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [userId, sessionId]);
    const result = await client.query<{ attempts?: number }>(
      `SELECT count(*)::int AS attempts FROM security_stepup_attempts
        WHERE user_id = $1 AND session_id = $2 AND attempted_at > now() - interval '15 minutes'`,
      [userId, sessionId],
    );
    if (Number(result.rows[0]?.attempts) >= 5) throw new ApiError(429, '验证尝试过多，请 15 分钟后再试');
    await client.query('INSERT INTO security_stepup_attempts (id, user_id, session_id) VALUES ($1, $2, $3)', [
      crypto.randomUUID(),
      userId,
      sessionId,
    ]);
  });
}

export async function clearSecurityStepUpFailures(userId: string, sessionId: string): Promise<void> {
  await query('DELETE FROM security_stepup_attempts WHERE user_id = $1 AND session_id = $2', [userId, sessionId]);
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(`security-stepup:${token}`).digest('hex');
}

/** 验证因子之后签发五分钟凭据；数据库只保存哈希。 */
export async function issueSecurityStepUp(
  userId: string,
  sessionId: string,
  scope: SecurityStepUpScope,
): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await query('DELETE FROM security_stepup_tickets WHERE expires_at <= now() OR consumed_at IS NOT NULL');
  await query(
    `INSERT INTO security_stepup_tickets (id, user_id, session_id, scope, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '5 minutes')`,
    [crypto.randomUUID(), userId, sessionId, scope, tokenHash(token)],
  );
  return token;
}

/** 原子消费一次；票据过期、跨会话、错用途或重放都要求重新复核。 */
export async function consumeSecurityStepUp(
  token: unknown,
  userId: string,
  sessionId: string,
  scope: SecurityStepUpScope,
): Promise<void> {
  const value = String(token ?? '').trim();
  if (!value || value.length > 128) throw badRequest('请先验证身份');
  const consumed = await query(
    `UPDATE security_stepup_tickets SET consumed_at = now()
      WHERE token_hash = $1 AND user_id = $2 AND session_id = $3 AND scope = $4
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING id`,
    [tokenHash(value), userId, sessionId, scope],
  );
  if (consumed.rowCount !== 1) throw badRequest('身份验证已过期或已使用，请重新验证');
}
