/**
 * 用户公开页的身份卡：已参加展会数始终展示，不受「展示我的报名」开关影响；
 * 开关只决定下方报名记录列表是否可见。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import UserPublicPage from './UserPublicPage.vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';

vi.mock('@/app/runtime', () => ({
  api: { users: { publicProfile: vi.fn() } },
}));

const PROFILE = {
  found: true,
  id: 'u1',
  nickname: 'user',
  role: '普通用户',
  roleCode: 'user',
  bio: '简介',
  region: '上海',
  socialMedia: '@user',
  showRegistrations: false,
  attendedCount: 3,
  registrations: [],
  exhibitions: [],
  viewedAsAdmin: false,
};
let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="public-test"></div>';
  vi.mocked(api.users.publicProfile).mockResolvedValue(PROFILE);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountPublic(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 公开页允许本人查看：这里用另一个账号访问，走普通访客视角。
  useSessionStore().applyUser({ id: 'viewer', username: 'viewer', loggedIn: true });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/user-public/:nickname', component: UserPublicPage }],
  });
  await router.push('/user-public/user');
  app = createApp(UserPublicPage).use(pinia).use(router);
  app.mount('#public-test');
}

describe('用户公开页身份卡', () => {
  it('关闭展示报名时仍显示已参加数，报名列表只给隐藏说明', async () => {
    await mountPublic();
    await vi.waitFor(() => expect(document.querySelector('.profile-stats')).not.toBeNull());
    expect(document.querySelector('.profile-stats')?.textContent).toContain('3');
    expect(document.body.textContent).toContain('已参加展会');
    expect(document.body.textContent).toContain('该用户选择不展示报名记录。');
  });

  it('打开展示报名后计数照常显示，列表出现记录', async () => {
    vi.mocked(api.users.publicProfile).mockResolvedValue({
      ...PROFILE,
      showRegistrations: true,
      attendedCount: 4,
      registrations: [{ id: 'r1', exhibitionTitle: '展会甲', statusCode: 'attended' }],
    });
    await mountPublic();
    await vi.waitFor(() => expect(document.body.textContent).toContain('展会甲'));
    expect(document.querySelector('.profile-stats')?.textContent).toContain('4');
  });
});
