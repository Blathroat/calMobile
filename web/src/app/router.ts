import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router';
import HomePage from '@/pages/HomePage.vue';
import LoginPage from '@/pages/LoginPage.vue';
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
      { path: '/home', component: HomePage },
      { path: '/profile', component: HomePage, meta: { requiresAuth: true } },
      { path: '/admin', component: HomePage, meta: { requiresAuth: true, roles: ['admin'] } },
      { path: '/registration-form', component: HomePage, meta: { requiresAuth: true, capability: 'register' } },
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
