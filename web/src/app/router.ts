import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router';
import HomePage from '@/pages/HomePage.vue';
import LoginPage from '@/pages/LoginPage.vue';
import RegisterPage from '@/pages/RegisterPage.vue';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue';
import ProfilePage from '@/pages/ProfilePage.vue';
import UserSettingsPage from '@/pages/UserSettingsPage.vue';
import SecurityPage from '@/pages/SecurityPage.vue';
import ExhibitorPage from '@/pages/ExhibitorPage.vue';
import ExhibitionFormPage from '@/pages/ExhibitionFormPage.vue';
import ReviewPage from '@/pages/ReviewPage.vue';
import AdminPage from '@/pages/AdminPage.vue';
import CheckinPage from '@/pages/CheckinPage.vue';
import RichEditorPage from '@/pages/RichEditorPage.vue';
import SearchPage from '@/pages/SearchPage.vue';
import UserPublicPage from '@/pages/UserPublicPage.vue';
import DetailPage from '@/pages/DetailPage.vue';
import RegistrationDetailPage from '@/pages/RegistrationDetailPage.vue';
import RegistrationFormPage from '@/pages/RegistrationFormPage.vue';
import MyRegistrationsPage from '@/pages/MyRegistrationsPage.vue';
import type { BodyGap } from '@/app/shell';
import { navigation } from './navigation';
import { useSessionStore } from '@/stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    roles?: string[];
    capability?: string;
    /** 顶栏标题的文案 key */
    title?: string;
    /** 是否显示返回键（二级页为 true，标签页为 false） */
    back?: boolean;
    /** 底部导航的选中项；存在即显示底部导航 */
    tab?: string;
    /** 顶栏右侧的页面级操作（例如个人页的「设置」入口） */
    topAction?: { icon: string; to: string; label: string };
    bodyGap?: BodyGap;
    bodyPad?: 'none';
    bodyAlign?: 'center';
  }
}

export function createAppRouter(history: RouterHistory = createWebHashHistory()) {
  const router = createRouter({
    history,
    routes: [
      // 冷启动没有会话（令牌只存在内存里），入口与登录页一致；bootstrap 落定后由 main.ts 纠正。
      { path: '/', redirect: () => (useSessionStore().loggedIn ? '/home' : '/login') },
      { path: '/login', component: LoginPage, meta: { title: 's_1yggxgd', bodyGap: 'tight' } },
      { path: '/register', component: RegisterPage, meta: { title: 's_1n008jl', back: true, bodyGap: 'tight' } },
      { path: '/forgot-password', component: ForgotPasswordPage, meta: { title: 's_1qksguo', back: true, bodyGap: 'tight' } },
      { path: '/home', component: HomePage, meta: { title: 's_1ow5v10', tab: 'home', bodyGap: 'tight' } },
      { path: '/search', component: SearchPage, meta: { title: 's_367f3v', back: true } },
      { path: '/user-public/:nickname', component: UserPublicPage, meta: { title: 's_1g1m28r', back: true } },
      { path: '/detail/:id', component: DetailPage, meta: { title: 's_1ve1f4n', back: true, bodyGap: 'tight' } },
      {
        path: '/registration-form/:id',
        component: RegistrationFormPage,
        meta: { title: 's_vrp4t3', back: true, bodyGap: 'tight', requiresAuth: true, capability: 'register' },
      },
      { path: '/my-registrations', component: MyRegistrationsPage, meta: { title: 's_1m2dh8u', tab: 'my-registrations', requiresAuth: true } },
      { path: '/registration-detail/:id', component: RegistrationDetailPage, meta: { title: 's_1e7myaa', back: true, requiresAuth: true } },
      {
        path: '/profile',
        component: ProfilePage,
        meta: {
          title: 's_1kzh3gd',
          tab: 'profile',
          requiresAuth: true,
          // 账号设置、外观、配色、安全与头像都在「用户设置」里，入口放顶栏右侧。
          topAction: { icon: 'settings', to: '/settings', label: 's_1vmubx9' },
        },
      },
      { path: '/settings', component: UserSettingsPage, meta: { title: 's_1vmubx9', back: true, requiresAuth: true } },
      { path: '/security', component: SecurityPage, meta: { title: 's_1iiaolc', back: true, requiresAuth: true } },
      { path: '/exhibitor', component: ExhibitorPage, meta: { title: 's_1omalh8', tab: 'exhibitor', bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/exhibition-form', component: ExhibitionFormPage, meta: { title: 's_eutzzb', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage, meta: { title: 's_eutzzb', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/review', component: ReviewPage, meta: { title: 's_7xrrf0', back: true, requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/checkin', component: CheckinPage, meta: { title: 's_zqzoiq', back: true, requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/rich-editor', component: RichEditorPage, meta: { title: 's_28v8q', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/admin', component: AdminPage, meta: { title: 's_cit5ds', tab: 'admin', bodyGap: 'tight', requiresAuth: true, roles: ['admin'] } },
    ],
  });

  router.beforeEach((to) => {
    navigation.begin();
    const session = useSessionStore();
    if (to.meta.requiresAuth && !session.loggedIn) {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    if (to.meta.roles && !to.meta.roles.includes(session.role)) return '/home';
    if (to.meta.capability && !session.can(to.meta.capability)) return '/home';
    return true;
  });

  // 切换方向写进外壳，motion.css 据此选前进 / 后退 / 原地替换的过渡。
  router.afterEach((to, from) => navigation.track(to, from));

  return router;
}

export const router = createAppRouter();
