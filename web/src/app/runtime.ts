import { createApi } from '@/api/client';
import type { Bootstrap } from '@/api/types';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';

export const api = createApi();

let bootPromise: Promise<void> | undefined;

export function bootApp(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = api.bootstrap().then((data) => {
    const session = useSessionStore();
    const bootstrap = useBootstrapStore();
    const capabilities = useCapabilitiesStore();
    const settings = useSettingsStore();
    session.applyUser(data.user);
    bootstrap.apply(data);
    capabilities.apply(asObject(data.capabilities));
    settings.apply({ theme: data.theme, ui: data.ui });
  }).catch((error) => {
    bootPromise = undefined;
    throw error;
  });
  return bootPromise;
}

export function resetBootForTests(): void {
  bootPromise = undefined;
}

export function applyRuntimeBootstrap(data: Bootstrap): void {
  useSessionStore().applyUser(data.user);
  useBootstrapStore().apply(data);
  useCapabilitiesStore().apply(asObject(data.capabilities));
  useSettingsStore().apply({ theme: data.theme, ui: data.ui });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
