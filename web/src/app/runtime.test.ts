import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api, bootApp, resetBootForTests } from './runtime';
import { useSessionStore } from '@/stores/session';

describe('app bootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetBootForTests();
  });

  it('shares one bootstrap promise and applies stores once', async () => {
    const bootstrap = vi.spyOn(api, 'bootstrap').mockResolvedValue({
      user: { id: 'u1', loggedIn: true, guest: false, role: 'user' },
      capabilities: { camera: true },
      brand: { zh: '测试' },
    });
    await Promise.all([bootApp(), bootApp()]);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(useSessionStore().loggedIn).toBe(true);
    expect(useSessionStore().role).toBe('user');
    bootstrap.mockRestore();
  });
});
