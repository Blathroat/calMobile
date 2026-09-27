import { createApi } from '@/api/client';
import type { Bootstrap } from '@/api/types';
import { applyMode } from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';

export const api = createApi();

let bootPromise: Promise<void> | undefined;

export function bootApp(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = api.bootstrap().then((data) => {
    applyRuntimeBootstrap(data);
  }).catch((error) => {
    bootPromise = undefined;
    throw error;
  });
  return bootPromise;
}

export function resetBootForTests(): void {
  bootPromise = undefined;
}

/**
 * 把启动数据落到各个 store。
 *
 * 明暗模式与强调色也在这里落一次：后端是偏好的权威来源（`users.ui_mode` /
 * `app_settings`），本机缓存只负责首帧不闪白。
 */
export function applyRuntimeBootstrap(data: Bootstrap): void {
  useSessionStore().applyUser(data.user);
  useBootstrapStore().apply(data);
  useCapabilitiesStore().apply(asObject(data.capabilities));
  useSettingsStore().apply({ theme: data.theme, ui: data.ui });
  applyMode(String(useSettingsStore().mode || 'auto'));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
