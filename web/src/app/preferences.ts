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
import { t } from '@/i18n';

/** 修改外观模式：本地生效 → 落库；失败回滚并抛错，由页面提示。 */
export async function saveUiMode(mode: string): Promise<void> {
  const previous = applyMode(mode);
  const result = await api.settings.saveUiMode(mode);
  if (result?.ok !== true) {
    applyMode(previous);
    throw new Error(String(result?.error || t('s_1q9u8le')));
  }
}

/** 修改强调色：本地生效 → 落库；失败回滚并抛错。 */
export async function saveAccentIndex(index: number): Promise<void> {
  const bootstrap = useBootstrapStore();
  const previous = Number(bootstrap.theme.index) || 0;
  const next = applyAccentIndex(index);
  if (next === previous) return;
  const result = await api.settings.saveUiTheme(next);
  if (result?.ok !== true) {
    applyAccentIndex(previous);
    throw new Error(String(result?.error || t('s_1q9u8le')));
  }
}
