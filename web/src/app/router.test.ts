import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { createAppRouter } from './router';
import { useSessionStore } from '@/stores/session';

describe('router guards', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('redirects unauthenticated users and rejects wrong roles', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/profile');
    expect(router.currentRoute.value.path).toBe('/login');
    const session = useSessionStore();
    session.applyUser({ id: 'u1', loggedIn: true, guest: false, role: 'user', can: { register: false } });
    await router.push('/admin');
    expect(router.currentRoute.value.path).toBe('/home');
    await router.push('/registration-form');
    expect(router.currentRoute.value.path).toBe('/home');
  });
});
