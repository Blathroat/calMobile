/**
 * 单选按钮该不该改成每项一行。
 *
 * `contentWidths` 是每个选项按钮「文字 + 左右内边距 + 边框」的宽度。
 * 容器够宽、每一项都能在均分后的一格里单行放下时返回 false；有一项放不下就返回 true。
 * 容器还没布局出来（宽度为 0）时不改排，避免首帧闪成竖排。
 */
export function choiceNeedsStack(contentWidths: number[], containerWidth: number, gap: number): boolean {
  if (contentWidths.length <= 1) return false;
  if (!(containerWidth > 0)) return false;
  const slot = (containerWidth - gap * (contentWidths.length - 1)) / contentWidths.length;
  return contentWidths.some((width) => width > slot + 0.5);
}
