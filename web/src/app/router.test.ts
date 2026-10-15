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
    await router.push('/registration-form/exh-1');
    expect(router.currentRoute.value.path).toBe('/home');
  });

  it('访客只能待在首页，其它页面一律回登录页', async () => {
    const router = createAppRouter(createMemoryHistory());
    // 访客 payload 与后端 `guestPayload()` 一致：`loggedIn: false` 且**不带 `id`**
    // （`applyUser()` 用「带了 id」兜底判定登录态，所以这里多写一个 id 就不是访客了）。
    useSessionStore().applyUser({
      loggedIn: false,
      guest: true,
      role: 'guest',
      roleLabel: '访客',
      can: { register: false, profile: false, exhibitor: false, admin: false, limited: false },
    });
    await router.push('/home');
    expect(router.currentRoute.value.path).toBe('/home');

    const protectedPaths = [
      '/search',
      '/detail/exh-1',
      '/registration-form/exh-1',
      '/user-public/exhibitor',
      '/my-registrations',
      '/registration-detail/reg-1',
      '/meeting-detail/meet-1',
      '/profile',
      '/settings',
      '/security',
      '/exhibitor',
      '/meeting-settings',
      '/meeting-apply/exhibitor-1',
      '/admin/meetings/exhibitor-1',
      '/admin/exhibitions/exhibitor-1',
      '/exhibition-form',
      '/exhibition-form/exh-1',
      '/review',
      '/checkin',
      '/rich-editor',
      '/admin',
    ];
    for (const path of protectedPaths) {
      await router.push(path);
      expect(router.currentRoute.value.path, `${path} 应当要求登录`).toBe('/login');
      // 带上原地址，登录后能送回用户本来要去的地方
      expect(router.currentRoute.value.query.redirect, `${path} 应当带上 redirect`).toBe(path);
    }
  });
});
