/**
 * 展会封面的取值规则：**自己的封面优先，其次管理员设置的缺省封面，都没有就返回空串**。
 *
 * 调用方拿到空串时继续画原来的占位图（`.ph-img` 的斜线方块），因此「缺省封面也为空」
 * 与「这一版之前的行为」完全一致。
 *
 * 为什么做成一个共享函数而不是各页判一次：封面出现在首页卡片、详情大图、我的活动缩略图、
 * 展商后台列表与用户公开页五处，规则分头写迟早会漂移（旧版这里就出现过「详情有图、
 * 列表没图」的不一致）。
 */
import { useBootstrapStore } from '@/stores/bootstrap';

/**
 * @param imageUri 展会自己存的封面地址（媒体短 URL），可能为空
 * @returns 可用的封面地址；两处都为空时返回空串，调用方据此显示占位图
 */
export function coverOf(imageUri: unknown): string {
  const own = String(imageUri ?? '').trim();
  if (own) return own;
  const fallback = useBootstrapStore().cover.defaultCover;
  return String(fallback ?? '').trim();
}
