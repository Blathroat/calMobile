/**
 * 浏览器报名站的路由。
 *
 * 登录、注册、找回密码、展会详情与报名（分享链接 `/e/:id`）、报名状态
 * （`/e/:id/status?token=`）、用户公开页（`/u/:nickname`）、私人会议申请链接和我的活动。
 * 没有首页日历、展会列表、搜索、资料、展商后台和管理后台。
 * 对不上的地址落到说明页，而不是 App 的 `/home`。
 *
 * 分享链接的分层：`/e/:id` 先给展会详情（未登录也能看），报名表单在
 * `/e/:id/register`（未登录也能填，只多一项姓名），提交后进带查询凭据的状态页。
 * 报名详情页只在登录后（`/mine/:id`）出现修改与撤销，未登录的入口在状态页页脚给登录 / 注册。
 */
import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import LoginPage from '@/pages/LoginPage.vue';
import RegisterPage from '@/pages/RegisterPage.vue';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue';
import DetailPage from '@/pages/DetailPage.vue';
import RegistrationFormPage from '@/pages/RegistrationFormPage.vue';
import MyRegistrationsPage from '@/pages/MyRegistrationsPage.vue';
import RegistrationDetailPage from '@/pages/RegistrationDetailPage.vue';
import UserPublicPage from '@/pages/UserPublicPage.vue';
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
        // 分享链接的第一屏：公开的展会详情，未登录也能看（「立即报名」在详情页底部）。
        path: '/e/:id',
        component: DetailPage,
        meta: { title: 'exhibition.detail.title', back: true, bodyGap: 'tight' },
      },
      {
        // 未登录也允许报名：守卫只在账号被后端显式禁用时报 capability 不符。
        path: '/e/:id/register',
        component: RegistrationFormPage,
        meta: {
          title: 'exhibition.detail.registrationInfo',
          back: true,
          bodyGap: 'tight',
          capability: 'register',
        },
      },
      {
        // 未登录报名后的状态页：凭据在 `?token=`，页面按公开接口取数。
        path: '/e/:id/status',
        component: RegistrationDetailPage,
        meta: { title: 'registration.detail.title', back: true },
      },
      {
        // 展商公开页在报名站也要求登录：详情页把人送到 `/login?redirect=/u/<昵称>`。
        path: '/u/:nickname',
        component: UserPublicPage,
        meta: { title: 'profile.public.title', back: true, requiresAuth: true },
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
    // 角色与能力只约束已登录的账号：访客的用户态是后端下发的 `guest`，权限表里
    // `register` 明确是 false，照着判会把免登录报名表单挡回登录页。访客能不能报名
    // 由页面自己按参展状态与展会报名窗口决定，服务端再兜一层。
    if (session.loggedIn) {
      if (to.meta.roles && !to.meta.roles.includes(session.role)) return '/mine';
      if (to.meta.capability && !session.can(to.meta.capability)) return '/mine';
    }
    return true;
  });

  router.afterEach((to, from) => navigation.track(to, from));
  return router;
}

export const router = createJoinRouter();
