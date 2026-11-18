/**
 * 展会的「我的」范围。
 *
 * 展会列表接口是公开的（月历、分享页、搜索都要看全部），所以「展商后台」和
 * 「报名管理」不能直接复用不带条件的列表：所有人都只能看到自己举办的活动；
 * 管理员也一样，要看全部请走管理后台的展会管理页。
 *
 * 服务端仍然会对每个写操作再判一次归属；这里只决定页面展示哪些展会，
 * 不把前端判断当安全边界。
 */
import type { User } from '@/api/types';

function userIdOf(user: User | null | undefined): string {
  return String(user?.id ?? '').trim();
}

/** 当前用户筛选「我的活动」列表要带的条件。 */
export function exhibitionOwnerQuery(user: User | null | undefined): { exhibitorId: string } {
  const id = userIdOf(user);
  // 没有用户 id 时用一个不可能命中的值，宁可空列表也不要把全部展会显示成「我的」。
  return { exhibitorId: id || '__none__' };
}

/** 当前用户能否管理这场展会；与 `server/src/domain/permissions.ts` 的规则一致。 */
export function canManageExhibition(
  user: User | null | undefined,
  exhibition: Record<string, unknown> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.can?.admin === true) return true;
  if (user.role !== 'exhibitor') return false;
  const owner = String(exhibition?.exhibitorId ?? '').trim();
  const id = userIdOf(user);
  return Boolean(owner && id && owner === id);
}
