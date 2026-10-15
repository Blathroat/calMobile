/**
 * 浏览器报名站的路由。
 *
 * 只有登录、注册、找回密码、展会报名链接、私人会议申请链接和我的活动。
 * 没有首页日历、展会列表、搜索、资料、展商后台和管理后台。
 * 对不上的地址落到说明页，而不是 App 的 `/home`。
 */
import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import LoginPage from '@/pages/LoginPage.vue';
import RegisterPage from '@/pages/RegisterPage.vue';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue';
import RegistrationFormPage from '@/pages/RegistrationFormPage.vue';
import MyRegistrationsPage from '@/pages/MyRegistrationsPage.vue';
import RegistrationDetailPage from '@/pages/RegistrationDetailPage.vue';
import MeetingApplyPage from '@/pages/MeetingApplyPage.vue';
import MeetingDetailPage from '@/pages/MeetingDetailPage.vue';
import LinkOnlyPage from '@/join/LinkOnlyPage.vue';
import { navigation } from '@/app/navigation';
import { useSessionStore } from '@/stores/session';

export function createJoinRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: () => (useSessionStore().loggedIn ? '/mine' : '/login') },
      { path: '/login', component: LoginPage, meta: { title: 'auth.login.title', bodyGap: 'tight' } },
      {
        path: '/register',
        component: RegisterPage,
        meta: { title: 'auth.register.title', back: true, bodyGap: 'tight' },
      },
      {
        path: '/forgot-password',
        component: ForgotPasswordPage,
        meta: { title: 'auth.forgot.title', back: true, bodyGap: 'tight' },
      },
      {
        path: '/e/:id',
        component: RegistrationFormPage,
        meta: {
          title: 'exhibition.detail.registrationInfo',
          back: true,
          bodyGap: 'tight',
          requiresAuth: true,
          capability: 'register',
        },
      },
      {
        path: '/mine',
        component: MyRegistrationsPage,
        meta: {
          title: 'registration.list.title',
          tab: 'my-registrations',
          requiresAuth: true,
          topAction: { icon: 'lock', label: 'profile.logout', action: 'logout' },
        },
      },
      {
        path: '/mine/m/:id',
        component: MeetingDetailPage,
        meta: { title: 'meeting.title', back: true, requiresAuth: true },
      },
      {
        path: '/mine/:id',
        component: RegistrationDetailPage,
        meta: { title: 'registration.detail.title', back: true, requiresAuth: true },
      },
      {
        path: '/m/:exhibitorId',
        component: MeetingApplyPage,
        meta: {
          title: 'meeting.apply.title',
          back: true,
          bodyGap: 'tight',
          requiresAuth: true,
          capability: 'register',
        },
      },
      { path: '/:pathMatch(.*)*', name: 'link-only', component: LinkOnlyPage, meta: { title: 'join.title' } },
    ],
  });

  router.beforeEach((to) => {
    navigation.begin();
    const session = useSessionStore();
    if (to.meta.requiresAuth && !session.loggedIn) {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    if (to.meta.roles && !to.meta.roles.includes(session.role)) return '/mine';
    if (to.meta.capability && !session.can(to.meta.capability)) return '/mine';
    return true;
  });

  router.afterEach((to, from) => navigation.track(to, from));
  return router;
}

export const router = createJoinRouter();
