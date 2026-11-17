import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { createJoinRouter } from './router';
import { useSessionStore } from '@/stores/session';

describe('join router', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('opens a shared exhibition link without login', async () => {
    const router = createJoinRouter(createMemoryHistory());
    await router.push('/e/exh-1');
    expect(router.currentRoute.value.path).toBe('/e/exh-1');
    expect(router.currentRoute.value.meta.title).toBe('exhibition.detail.title');
    expect(router.currentRoute.value.meta.requiresAuth).toBeUndefined();
  });

  it('lets anonymous visitors open the registration form and the query link', async () => {
    const router = createJoinRouter(createMemoryHistory());
    await router.push('/e/exh-1/register');
    expect(router.currentRoute.value.path).toBe('/e/exh-1/register');
    expect(router.currentRoute.value.meta.requiresAuth).toBeUndefined();
    await router.push('/e/exh-1/status?token=abc');
    expect(router.currentRoute.value.path).toBe('/e/exh-1/status');
    expect(router.currentRoute.value.query.token).toBe('abc');
  });

  it('keeps the exhibitor public page behind login', async () => {
    const router = createJoinRouter(createMemoryHistory());
    await router.push('/u/exhibitor');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/u/exhibitor');
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
    expect(router.currentRoute.value.meta.title).toBe('join.title');
  });

  it('opens meeting detail on its own path', async () => {
    const router = createJoinRouter(createMemoryHistory());
    useSessionStore().applyUser({ id: 'u1', loggedIn: true, guest: false, role: 'user', can: { register: true } });
    await router.push('/mine/m/meet-1');
    expect(router.currentRoute.value.path).toBe('/mine/m/meet-1');
    expect(router.currentRoute.value.meta.title).toBe('meeting.title');
  });

  it('keeps the private meeting link behind login', async () => {
    const router = createJoinRouter(createMemoryHistory());
    await router.push('/m/usr-2');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/m/usr-2');
  });

  it('sends a limited account away from the registration form but keeps the public detail', async () => {
    const router = createJoinRouter(createMemoryHistory());
    useSessionStore().applyUser({ id: 'u1', loggedIn: true, guest: false, role: 'user', can: { register: false } });
    // 详情页是公开信息，受限账号也能看；不能报名时在页面上说明，不在这里踢走。
    await router.push('/e/exh-1');
    expect(router.currentRoute.value.path).toBe('/e/exh-1');
    await router.push('/e/exh-1/register');
    expect(router.currentRoute.value.path).toBe('/mine');
    await router.push('/m/usr-2');
    expect(router.currentRoute.value.path).toBe('/mine');
  });
});
