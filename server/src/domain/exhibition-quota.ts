import type { PoolClient } from 'pg';
import { transaction } from '../config/pool.js';
import { badRequest } from './errors.js';
import type { Actor } from './permissions.js';
import { readSection } from './settings.js';

/** 创建与改期共用的额度事务；计数、写展会和写收集项必须在同一个锁周期完成。 */
export async function withExhibitionQuota<T>(
  actor: Actor,
  exhibition: { id?: string; exhibitorId: string | null | undefined; date: string },
  save: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { maxFutureExhibitions } = await readSection('exhibitor');
  return transaction(async (client) => {
    if (exhibition.exhibitorId) {
      // 用户行始终存在，不依赖展商是否已有展会；同一展商的创建和改期由此串行。
      // 管理员仍拿同一把锁，只豁免额度，避免与展商请求使用不同的写入顺序。
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [exhibition.exhibitorId]);
      if (actor.role !== 'admin' && maxFutureExhibitions > 0) {
        const counted = await client.query<{ total: number; occupies_slot: boolean; already_counted: boolean }>(
          `SELECT count(*)::int AS total, $3::date >= CURRENT_DATE AS occupies_slot,
             EXISTS (SELECT 1 FROM exhibitions WHERE id = $2 AND exhibition_date >= CURRENT_DATE) AS already_counted
           FROM exhibitions WHERE exhibitor_id = $1 AND exhibition_date >= CURRENT_DATE
           AND id IS DISTINCT FROM $2`,
          [exhibition.exhibitorId, exhibition.id ?? null, exhibition.date],
        );
        const count = counted.rows[0]!;
        // 以拿锁后的数据库日期判断是否新增占用；调低上限也不冻结现有未来展会的编辑。
        if (count.occupies_slot && !count.already_counted && count.total >= maxFutureExhibitions) {
          throw badRequest(`同时筹备的展会最多 ${maxFutureExhibitions} 个，请调整展会日期或删除已有展会`);
        }
      }
    }
    return save(client);
  });
}
