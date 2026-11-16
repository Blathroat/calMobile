/**
 * 首页月历的横向手势判定。
 *
 * 纯函数：离手时决定「切换到邻月」还是「弹回原位」。
 * - 拖过卡片宽度的 1/4：松手就算切换；
 * - 距离不够但甩得够快、且不是几像素的抖动：也算切换；
 * - 其余情况弹回。
 */
export interface CalendarSwipeInput {
  deltaX: number;
  velocityX: number;
  width: number;
}

export interface CalendarSwipeOutcome {
  commit: boolean;
  /** +1 下个月，-1 上个月，0 不切。 */
  direction: number;
}

const DISTANCE_RATIO = 0.25;
const FAST_VELOCITY = 0.45;
const FAST_MIN_DISTANCE = 16;

export function resolveCalendarSwipe(input: CalendarSwipeInput): CalendarSwipeOutcome {
  const width = Number(input.width) || 0;
  const deltaX = Number(input.deltaX) || 0;
  const velocityX = Number(input.velocityX) || 0;
  const distance = Math.abs(deltaX);
  const farEnough = width > 0 && distance >= width * DISTANCE_RATIO;
  const fastEnough = Math.abs(velocityX) >= FAST_VELOCITY && distance >= FAST_MIN_DISTANCE;
  if (!farEnough && !fastEnough) return { commit: false, direction: 0 };
  return { commit: true, direction: deltaX < 0 ? 1 : -1 };
}
