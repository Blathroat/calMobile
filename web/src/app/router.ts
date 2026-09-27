import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router';
import HomePage from '@/pages/HomePage.vue';
import LoginPage from '@/pages/LoginPage.vue';
import RegisterPage from '@/pages/RegisterPage.vue';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue';
import DetailPage from '@/pages/DetailPage.vue';
import RegistrationDetailPage from '@/pages/RegistrationDetailPage.vue';
import RegistrationFormPage from '@/pages/RegistrationFormPage.vue';
import MyRegistrationsPage from '@/pages/MyRegistrationsPage.vue';
import { useSessionStore } from '@/stores/session';
import { navigation } from './navigation';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    roles?: string[];
    capability?: string;
  }
}

export function createAppRouter(history: RouterHistory = createWebHashHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: '/home' },
      { path: '/login', component: LoginPage },
      { path: '/register', component: RegisterPage },
      { path: '/forgot-password', component: ForgotPasswordPage },
      { path: '/home', component: HomePage },
      { path: '/detail/:id', component: DetailPage },
      { path: '/registration-form/:id', component: RegistrationFormPage, meta: { requiresAuth: true, capability: 'register' } },
      { path: '/my-registrations', component: MyRegistrationsPage, meta: { requiresAuth: true } },
      { path: '/registration-detail/:id', component: RegistrationDetailPage, meta: { requiresAuth: true } },
      { path: '/profile', component: HomePage, meta: { requiresAuth: true } },
      { path: '/admin', component: HomePage, meta: { requiresAuth: true, roles: ['admin'] } },
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
  return router;
}

export const router = createAppRouter();
