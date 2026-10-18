/**
 * 展商会员时长。
 *
 * 到期不在定时任务里处理：谁都可能长期不登录，定时任务也保证不了「请求到达时已经降级」。
 * 因此按访问惰性结算：
 * - 本人请求在认证解析时结算（`middleware/auth.ts`）；
 * - 读取别人的角色时先定向结算（公开页）或用 `effectiveRole()` 判断（搜索、会议宿主），
 *   不靠结算写库。
 *
 * 结算只写一次：`role` 变成 `user` 后条件更新不再命中，不给每个请求加写查询。
 * 到期时间保留在库里作为「已到期」历史，个人页与管理员列表据此说明原因。
 */

import { query } from '../config/pool.js';

/** 单枚邀请码最多发 10 年展商时长：防止误填位数把身份发成天文数字。 */
export const MEMBERSHIP_MAX_DAYS = 3650;

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 天数夹到 0..3650；非数字按 0（永久）处理。 */
export function clampDurationDays(value: unknown): number {
  const days = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.min(MEMBERSHIP_MAX_DAYS, days));
}

/** 到期时间是否已经走过（NULL 表示永久，永远不算过期）。 */
export function isPastExpiry(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  const date = asDate(expiresAt);
  return date !== null && date.getTime() <= now.getTime();
}

/** 是不是「已到期的限时展商」：只有展商角色参与，管理员和普通用户都不看这个时间。 */
export function isMembershipExpired(
  role: string | null | undefined,
  expiresAt: Date | string | null | undefined,
  now = new Date(),
): boolean {
  return role === 'exhibitor' && isPastExpiry(expiresAt, now);
}

/** 只用于展示：把已到期的展商显示成普通用户，不改库。 */
export function effectiveRole(
  role: string | null | undefined,
  expiresAt: Date | string | null | undefined,
  now = new Date(),
): string {
  return isMembershipExpired(role, expiresAt, now) ? 'user' : String(role ?? '');
}

/** 结算一个已到期的展商：降为普通用户并关掉会议预约。返回是否真的结算了。 */
export async function settleExpiredExhibitor(userId: string): Promise<boolean> {
  try {
    const result = await query(
      `UPDATE users
          SET role = 'user', accept_meetings = false, updated_at = now()
        WHERE id = $1
          AND role = 'exhibitor'
          AND exhibitor_expires_at IS NOT NULL
          AND exhibitor_expires_at <= now()
        RETURNING id`,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error: unknown) {
    // 结算失败不能把请求打挂：调用方仍按到期时间把这次请求当成普通用户。
    console.warn('结算已到期的展商身份失败：', errorMessage(error));
    return false;
  }
}

/** 批量结算，供管理员用户列表这种低频入口调用。 */
export async function settleExpiredExhibitors(): Promise<number> {
  try {
    const result = await query(
      `UPDATE users
          SET role = 'user', accept_meetings = false, updated_at = now()
        WHERE role = 'exhibitor'
          AND exhibitor_expires_at IS NOT NULL
          AND exhibitor_expires_at <= now()`,
    );
    return result.rowCount ?? 0;
  } catch (error: unknown) {
    console.warn('批量结算已到期的展商身份失败：', errorMessage(error));
    return 0;
  }
}
