/**
 * 有未保存改动时拦截离开，弹底部面板确认。
 *
 * 返回的 Promise 让路由导航**停在原地**等用户选完：选「放弃更改」就继续原来的导航
 * （返回键仍是真正的返回，不会变成一次新的 push），选「继续编辑」或点遮罩则取消这次导航。
 * 同一时间只允许一个确认面板；确认期间再次触发的导航直接取消，避免两层面板叠在一起。
 *
 * 保存成功等「本来就要离开」的路径，调用方先把脏标记清掉再导航，不要在这里开旁路。
 *
 * @param dirty 当前是否有未保存的改动。
 * @param options.skip 例外目标（例如从展会表单进简介编辑器、登录失效回登录页）。
 * @param options.onLeave 导航真的放行时调用（取消导航不调用）：页面可在这里清内存稿等。
 */
import { onBeforeRouteLeave } from 'vue-router';
import { openSheet } from '@/services/sheet';
import { t } from '@/i18n';

export function useUnsavedGuard(
  dirty: () => boolean,
  options: { skip?: (to: { path: string }) => boolean; onLeave?: () => void } = {},
): void {
  let deciding = false;

  onBeforeRouteLeave(async (to) => {
    if (options.skip?.(to)) return true;
    if (!dirty()) {
      options.onLeave?.();
      return true;
    }
    if (deciding) return false;
    deciding = true;
    const leave = await new Promise<boolean>((resolve) => {
      let discard = false;
      openSheet({
        title: t('common.unsavedTitle'),
        message: t('common.unsavedMessage'),
        actions: [
          { label: t('common.keepEditing'), onClick: (close) => close() },
          {
            label: t('common.discardChanges'),
            variant: 'danger',
            onClick: (close) => {
              discard = true;
              close();
            },
          },
        ],
        // 点遮罩、按返回键或 Esc 关闭面板，都按「继续编辑」处理。
        onClose: () => resolve(discard),
      });
    });
    deciding = false;
    if (leave) options.onLeave?.();
    return leave;
  });
}
