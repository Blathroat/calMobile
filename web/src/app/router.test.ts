import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { createAppRouter } from './router';
import { bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { rememberSession } from '@/services/session-hint';

// 守卫只在「本机留着登录态提示」时调 bootApp 恢复会话；测试换成能落会话的桩，
// 免得真去发 bootstrap 请求。
vi.mock('@/app/runtime', () => ({ bootApp: vi.fn(async () => undefined) }));

/** 让桩 bootApp「恢复」出一个已登录会话。 */
function bootAsLoggedIn(): void {
  vi.mocked(bootApp).mockImplementation(async () => {
    useSessionStore().applyUser({ id: 'u1', loggedIn: true, guest: false, role: 'user' });
  });
}

describe('router guards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.mocked(bootApp).mockReset();
    vi.mocked(bootApp).mockResolvedValue(undefined);
  });

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

  it('有登录态提示时先等会话恢复，受保护页面不经过登录页', async () => {
    rememberSession();
    bootAsLoggedIn();
    const router = createAppRouter(createMemoryHistory());
    const visited: string[] = [];
    router.afterEach((to) => visited.push(to.path));

    await router.push('/settings');

    expect(bootApp).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/settings');
    // 这一屏等的是恢复结果，不是先落 /login 再由 main.ts 纠正。
    expect(visited).not.toContain('/login');
  });

  it('没有提示时仍重定向到登录页并带上原地址', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/settings');
    expect(bootApp).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/settings');
  });

  it('有提示时直接落到 /login 也先恢复，再送回 redirect 记的原地址', async () => {
    rememberSession();
    bootAsLoggedIn();
    const router = createAppRouter(createMemoryHistory());

    await router.push('/login?redirect=/my-registrations');

    expect(bootApp).toHaveBeenCalledTimes(1);
    // 登录页没有被落到屏幕上：守卫等完恢复直接改道。
    expect(router.currentRoute.value.path).toBe('/my-registrations');
  });

  it('入口同样先等恢复：有提示落首页，没提示落登录页', async () => {
    rememberSession();
    bootAsLoggedIn();
    const withHint = createAppRouter(createMemoryHistory());
    await withHint.push('/');
    expect(withHint.currentRoute.value.path).toBe('/home');
    expect(bootApp).toHaveBeenCalledTimes(1);

    // 换一份没有提示的本机存储与 Pinia，入口行为回到从前。
    vi.mocked(bootApp).mockClear();
    setActivePinia(createPinia());
    localStorage.clear();
    const withoutHint = createAppRouter(createMemoryHistory());
    await withoutHint.push('/');
    expect(withoutHint.currentRoute.value.path).toBe('/login');
    expect(bootApp).not.toHaveBeenCalled();
  });
});
