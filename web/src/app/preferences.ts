/**
 * 个人偏好：明暗模式与强调色。
 *
 * 两者的规则一致 —— **账号是权威来源**（`users.ui_mode` / `users.ui_theme`），
 * 本机只缓存一份给首帧用（见 `index.html` 的内联脚本）。切换时先落本地令牌
 * （界面立刻变），再写后端；写失败要回滚，不能让「看起来生效了」留在屏幕上。
 */
import { api } from '@/app/runtime';
import { applyAccentIndex, applyMode } from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSettingsStore } from '@/stores/settings';
import { t } from '@/i18n';

/** 修改外观模式：本地生效 → 落库；失败回滚并抛错，由页面提示。 */
export const saveUiMode = preferenceSaver(
  () => useSettingsStore().mode,
  applyMode,
  (mode) => api.settings.saveUiMode(mode),
);

/** 修改强调色：本地生效 → 落库；失败回滚并抛错。 */
export const saveAccentIndex = preferenceSaver(
  () => Number(useBootstrapStore().theme.index) || 0,
  applyAccentIndex,
  (index) => api.settings.saveUiTheme(index),
);

/** 每个会话、每类偏好独立排队；退出后旧写入不能回滚外观或借用新账号。 */
function preferenceSaver<T>(
  read: () => T,
  apply: (value: T) => T,
  persist: (value: T) => Promise<{ ok?: boolean; error?: unknown }>,
): (value: T) => Promise<void> {
  let current: { signal: AbortSignal; queue: Promise<void>; pending: number; latest: number; confirmed: T } | undefined;

  return (value) => {
    const signal = api.session.signal;
    const previous = read();
    const next = apply(value);
    if (!current || current.signal !== signal) {
      current = { signal, queue: Promise.resolve(), pending: 0, latest: 0, confirmed: previous };
    }
    const state = current;
    if (next === previous && state.pending === 0) return Promise.resolve();
    // 一轮连续选择只在开始时取已保存值，不能把中途的乐观状态当作回滚目标。
    if (state.pending === 0) state.confirmed = previous;
    state.pending += 1;
    const revision = ++state.latest;
    const saving = state.queue.then(async () => {
      try {
        signal.throwIfAborted();
        const result = await persist(next);
        signal.throwIfAborted();
        if (result?.ok !== true) throw new Error(String(result?.error || t('exhibition.form.saveFailed')));
        state.confirmed = next;
      } catch (reason) {
        if (!signal.aborted && revision === state.latest) apply(state.confirmed);
        throw reason;
      } finally {
        state.pending -= 1;
      }
    });
    // 前一次失败不能阻塞后续写入；原异常仍由 saving 交回对应页面调用者。
    state.queue = saving.catch(() => undefined);
    return saving;
  };
}
