/**
 * 两步验证的**预认证票**。
 *
 * 密码对了两步验证还没过时，不能发访问令牌 —— 否则「密码泄露」就已经等于「账号到手」，
 * 那两步验证只是多一步表演。所以这一步改为发一张**临时的、单次使用的票据**：
 * 客户端拿它 + 邮箱验证码来换真正的会话（`POST /auth/login/verify`）。
 *
 * 与刷新令牌同一套做法：只存 sha256 哈希、可撤销（`consumed_at`）、有有效期；
 * 区别是它必须**单次使用**且很短命（5 分钟），只用于把「密码对」换成「过码了」。
 */

import crypto from 'node:crypto';
import { query } from '../config/pool';

/** 票据有效期（分钟）。 */
export const TICKET_TTL_MIN = 5;

/** 单张票据最多验证几次；超过就作废（防止拿到票据后慢慢猜码）。 */
export const MAX_TICKET_ATTEMPTS = 5;

export function hashTicket(ticket: string): string {
  return crypto.createHash('sha256').update(String(ticket)).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 清理过期或已消费的票据（失败不影响登录）。 */
export function purgeStaleTickets(): Promise<unknown> {
  return query(`
        DELETE FROM preauth_tickets
         WHERE expires_at < now() - interval '1 hour'
            OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 hour')
    `).catch((error: unknown) => {
    console.warn('清理过期预认证票失败：', errorMessage(error));
  });
}

/**
 * 给某个用户签一张预认证票。
 *
 * @returns `ticket` 是明文，**只在这一次响应里出现**。
 */
export async function issueTicket(userId: string): Promise<{ ticket: string; expiresInSec: number }> {
  const ticket = crypto.randomBytes(32).toString('hex');
  await query(
    `
        INSERT INTO preauth_tickets (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
    `,
    [crypto.randomUUID(), userId, hashTicket(ticket), String(TICKET_TTL_MIN)],
  );
  void purgeStaleTickets();
  return { ticket, expiresInSec: TICKET_TTL_MIN * 60 };
}

interface TicketRow {
  id: string;
  user_id: string;
  attempts: number;
}

/**
 * 读一张**仍然可用**的票据（不改状态）：验证码不对时票据要留着让用户重试。
 */
export async function findTicket(ticket: string): Promise<{ id: string; userId: string; attempts: number } | null> {
  const result = await query<TicketRow>(
    `
        SELECT id, user_id, attempts
          FROM preauth_tickets
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
    `,
    [hashTicket(ticket)],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { id: row.id, userId: row.user_id, attempts: Number(row.attempts) };
}

/** 记一次失败的验证；到上限就把票据作废。返回是否还能继续用。 */
export async function countTicketFailure(id: string, attempts: number): Promise<boolean> {
  const next = Number(attempts) + 1;
  await query(
    `
        UPDATE preauth_tickets
           SET attempts = $2::int,
               consumed_at = CASE WHEN $2::int >= $3::int THEN now() ELSE consumed_at END
         WHERE id = $1
    `,
    [id, next, MAX_TICKET_ATTEMPTS],
  );
  return next < MAX_TICKET_ATTEMPTS;
}

/**
 * 消费一张票据（只用于「验证码已经过了」之后）。
 *
 * 与刷新令牌轮换同一个道理：判断用 `WHERE consumed_at IS NULL` 的 `rowCount`，
 * 并发提交两次时只有一次能换到会话。
 */
export async function consumeTicket(id: string): Promise<boolean> {
  const result = await query('UPDATE preauth_tickets SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [
    id,
  ]);
  return result.rowCount === 1;
}
