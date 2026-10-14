/**
 * 浏览器报名站的路由。
 *
 * 只有登录、注册、找回密码、一条展会报名链接和我的报名。
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
import LinkOnlyPage from '@/join/LinkOnlyPage.vue';
import { navigation } from '@/app/navigation';
import { useSessionStore } from '@/stores/session';

export function createJoinRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: () => (useSessionStore().loggedIn ? '/mine' : '/login') },
      { path: '/login', component: LoginPage, meta: { title: 's_1yggxgd', bodyGap: 'tight' } },
      { path: '/register', component: RegisterPage, meta: { title: 's_1n008jl', back: true, bodyGap: 'tight' } },
      { path: '/forgot-password', component: ForgotPasswordPage, meta: { title: 's_1qksguo', back: true, bodyGap: 'tight' } },
      {
        path: '/e/:id',
        component: RegistrationFormPage,
        meta: { title: 's_vrp4t3', back: true, bodyGap: 'tight', requiresAuth: true, capability: 'register' },
      },
      {
        path: '/mine',
        component: MyRegistrationsPage,
        meta: {
          title: 's_1m2dh8u',
          tab: 'my-registrations',
          requiresAuth: true,
          topAction: { icon: 'lock', label: 's_12hokt7', action: 'logout' },
        },
      },
      { path: '/mine/:id', component: RegistrationDetailPage, meta: { title: 's_1e7myaa', back: true, requiresAuth: true } },
      { path: '/:pathMatch(.*)*', name: 'link-only', component: LinkOnlyPage, meta: { title: 's_14frgky' } },
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
