import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { createJoinRouter } from './router';
import { useSessionStore } from '@/stores/session';

describe('join router', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('sends anonymous visitors to login and keeps the exhibition link', async () => {
    const router = createJoinRouter(createMemoryHistory());
    await router.push('/e/exh-1');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/e/exh-1');
  });

  it('lands logged-in users on my registrations', async () => {
    const router = createJoinRouter(createMemoryHistory());
    useSessionStore().applyUser({ id: 'u1', loggedIn: true, guest: false, role: 'user', can: { register: true } });
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/mine');
  });

  it('turns unknown paths into the link-only page', async () => {
    const router = createJoinRouter(createMemoryHistory());
    await router.push('/home');
    expect(router.currentRoute.value.name).toBe('link-only');
    await router.push('/no-such');
    expect(router.currentRoute.value.name).toBe('link-only');
    expect(router.currentRoute.value.meta.title).toBe('s_14frgky');
  });

  it('sends a limited account away from the registration form', async () => {
    const router = createJoinRouter(createMemoryHistory());
    useSessionStore().applyUser({ id: 'u1', loggedIn: true, guest: false, role: 'user', can: { register: false } });
    await router.push('/e/exh-1');
    expect(router.currentRoute.value.path).toBe('/mine');
  });
});
