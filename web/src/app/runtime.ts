import { createApi } from '@/api/client';
import type { Bootstrap } from '@/api/types';
import { applyAccentIndex, applyMode } from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';

export const api = createApi();

let bootPromise: Promise<void> | undefined;

export function bootApp(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = api.session
    // 先从设备存储恢复会话（有刷新令牌就换一张访问令牌），再取启动数据：
    // 顺序反了的话 bootstrap 会以匿名身份回答，页面首帧会停在登录页。
    .restore()
    .catch(() => false)
    .then(() => refreshRuntimeBootstrap())
    .catch((error) => {
      bootPromise = undefined;
      throw error;
    });
  return bootPromise;
}

export function resetBootForTests(): void {
  bootPromise = undefined;
}

/** 每次身份切换后重读整份启动数据，偏好与权限落定后才允许进入下一屏。 */
export async function refreshRuntimeBootstrap(): Promise<void> {
  const signal = api.session.signal;
  const data = await api.bootstrap();
  signal.throwIfAborted();
  applyRuntimeBootstrap(data);
}

/**
 * 把启动数据落到各个 store。
 *
 * 明暗模式与强调色也在这里落一次：后端是偏好的权威来源（`users.ui_mode` /
 * `users.ui_theme`），本机缓存只负责首帧不闪白。
 */
export function applyRuntimeBootstrap(data: Bootstrap): void {
  useSessionStore().applyUser(data.user);
  useBootstrapStore().apply(data);
  useCapabilitiesStore().apply(asObject(data.capabilities));
  // 色板与全局默认下标留在 bootstrap store；这里只落明暗模式那一段。
  useSettingsStore().apply({ ui: data.ui });
  applyMode(String(useSettingsStore().mode || 'auto'));
  // 强调色也缓存一份到本机：下次冷启动的首帧直接是用户选的颜色。
  applyAccentIndex(Number(useBootstrapStore().theme.index) || 0);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
