import { t } from '@/i18n';
/**
 * 路由表与访问守卫。
 *
 * meta 字段就是外壳契约（只有 `app/App.vue` 与 `app/shell.ts` 消费），改字段名要同步改外壳：
 * - `title`：顶栏标题的**文案 key**（不是文案本身），渲染时才 `t()` 翻译，所以不写死中文；
 * - `back`：顶栏是否显示返回键，二级页为 true、标签页为 false；
 * - `tab`：底部导航选中项，**存在即显示底部导航**（外壳只看它是不是 undefined）；
 * - `topAction`：顶栏右侧的页面级操作 `{ icon, to, label }`，目前只有个人页用它进设置；
 * - `bodyGap` / `bodyPad` / `bodyAlign`：内容区间距与对齐，只在要偏离 tokens.css 默认值时写；
 * - `requiresAuth` / `roles` / `capability`：访问约束，只被下面的守卫读取，外壳不关心。
 *
 * 守卫按固定顺序判定，先命中先返回（顺序不能调换）：
 * 1. 登录：`requiresAuth` 且未登录 → 跳 `/login` 并带 `redirect=<原 fullPath>`；
 * 2. 角色：`roles` 不含当前角色 → 回 `/home`；
 * 3. 能力：`capability` 不被 `session.can()` 允许 → 也回 `/home`。
 * 先是登录再是角色 / 能力：未登录时权限表为空而 `can()` 默认放行，若先判能力就会把匿名用户
 * 直接放进需要权限的页面。
 *
 * **访客（guest）只能待首页**：访客不是登录态（`loggedIn === false`），所以除 `/login`、
 * `/register`、`/forgot-password`、`/home` 之外的每一屏都写了 `requiresAuth`。
 *
 * 坑：
 * - `roles` / `capability` 漏写不报错，但等于对所有登录用户开放，记得成对检查；
 * - 越权一律回 `/home`，没有 403 页；`/home` 自身不要求登录，所以不会出现互相弹跳的死循环；
 * - `/` 的 redirect 读 `session.loggedIn` 的**当前值**：冷启动时令牌只在内存里，首帧必然落登录页，
 *   由 `main.ts` 在 bootstrap 落定后用 `replace` 纠正；
 * - 每次导航先 `navigation.begin()` 取消上一次未完成的导航，`afterEach` 再记方向给动效；
 * - 新增页面要同步 `app/shell.test.ts` 的 `ROUTES` 与 `docs/engineering.md` 的屏幕表。
 */
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router';
import HomePage from '@/pages/HomePage.vue';
import LoginPage from '@/pages/LoginPage.vue';
import RegisterPage from '@/pages/RegisterPage.vue';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue';
import ProfilePage from '@/pages/ProfilePage.vue';
import UserSettingsPage from '@/pages/UserSettingsPage.vue';
import SecurityPage from '@/pages/SecurityPage.vue';
import SecurityDevicesPage from '@/pages/SecurityDevicesPage.vue';
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
import MeetingSettingsPage from '@/pages/MeetingSettingsPage.vue';
import MeetingApplyPage from '@/pages/MeetingApplyPage.vue';
import MeetingDetailPage from '@/pages/MeetingDetailPage.vue';
import AdminMeetingsPage from '@/pages/AdminMeetingsPage.vue';
import AdminExhibitionsPage from '@/pages/AdminExhibitionsPage.vue';
import type { BodyGap } from '@/app/shell';
import { navigation } from './navigation';
import { useSessionStore } from '@/stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    /** 需要登录才能进入；未登录时守卫跳登录页并带上 `redirect` */
    requiresAuth?: boolean;
    /** 允许进入的角色代码（`exhibitor` / `admin` 等）；不在列表里回首页 */
    roles?: string[];
    /** 需要的权限键名，交给 `session.can()` 判定（默认放行，只有显式 false 才拦） */
    capability?: string;
    /** 顶栏标题的文案 key（渲染时 t() 翻译），不是标题本身 */
    title?: string;
    /** 是否显示返回键（二级页为 true，标签页为 false） */
    back?: boolean;
    /** 底部导航的选中项；存在即显示底部导航 */
    tab?: string;
    /** 顶栏右侧的页面级操作（例如个人页的「设置」入口），`label` 同样是文案 key */
    topAction?: { icon: string; to?: string; label: string; action?: 'logout' };
    /** 内容区间距：`tight` 用于信息密集页，其余交给 tokens.css 默认值 */
    bodyGap?: BodyGap;
    /** 内容区去掉内边距（整屏自定义布局的页面用） */
    bodyPad?: 'none';
    /** 内容区水平居中（空状态、表单页用） */
    bodyAlign?: 'center';
    /**
     * 换 query 时不重建页面：外壳平时用 `fullPath` 作键，`?tab=` 这类只改 query 的切换
     * 会整页重新挂载、数据重取一遍（表现为分区切换闪一下）。声明这一项的页面自己
     * `watch` query 完成切换，外壳改用 `path` 作键。目前只有管理后台用它。
     */
    queryInPlace?: boolean;
  }
}

/**
 * 创建路由实例并注册守卫。
 * @param history 历史实现；默认 hash 历史（`#/home`），便于 WebView 直接加载本地文件、
 *   刷新不依赖服务端回退路由；只有测试会传 `createMemoryHistory()`
 * @returns 已注册守卫但尚未 `app.use()` 挂载的路由实例
 */
export function createAppRouter(history: RouterHistory = createWebHashHistory()) {
  const router = createRouter({
    history,
    routes: [
      // 冷启动没有会话（令牌只存在内存里），入口与登录页一致；bootstrap 落定后由 main.ts 纠正。
      { path: '/', redirect: () => (useSessionStore().loggedIn ? '/home' : '/login') },
      // 登录页是未登录时的落点，不显示返回键（没有可返回的上一页）
      { path: '/login', component: LoginPage, meta: { title: 's_1yggxgd', bodyGap: 'tight' } },
      { path: '/register', component: RegisterPage, meta: { title: 's_1n008jl', back: true, bodyGap: 'tight' } },
      { path: '/forgot-password', component: ForgotPasswordPage, meta: { title: 's_1qksguo', back: true, bodyGap: 'tight' } },
      { path: '/home', component: HomePage, meta: { title: 's_1ow5v10', tab: 'home', bodyGap: 'tight' } },
      // 首页是访客唯一的去处：日历与当天展会对所有人开放，其余页面一律要求登录
      // （访客登录页的「以访客身份浏览」落点就是它）。要放开某一屏，去掉 requiresAuth 即可。
      { path: '/search', component: SearchPage, meta: { title: 's_367f3v', back: true, requiresAuth: true } },
      { path: '/user-public/:nickname', component: UserPublicPage, meta: { title: 's_1g1m28r', back: true, requiresAuth: true } },
      { path: '/detail/:id', component: DetailPage, meta: { title: 's_1ve1f4n', back: true, bodyGap: 'tight', requiresAuth: true } },
      {
        path: '/registration-form/:id',
        component: RegistrationFormPage,
        // 登录与报名权限都要：requiresAuth 挡住匿名，capability 挡住后端显式禁用的账号
        meta: { title: 's_vrp4t3', back: true, bodyGap: 'tight', requiresAuth: true, capability: 'register' },
      },
      { path: '/my-registrations', component: MyRegistrationsPage, meta: { title: 's_1m2dh8u', tab: 'my-registrations', requiresAuth: true } },
      { path: '/registration-detail/:id', component: RegistrationDetailPage, meta: { title: 's_1e7myaa', back: true, requiresAuth: true } },
      { path: '/meeting-detail/:id', component: MeetingDetailPage, meta: { title: 's_g1bhp7', back: true, requiresAuth: true } },
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
      { path: '/security/devices', component: SecurityDevicesPage, meta: { title: t('s_10pjh16'), back: true, requiresAuth: true } },
      // 展商后台与审核 / 核销 / 富文本编辑器同属展商角色，管理员也能进
      {
        path: '/exhibitor',
        component: ExhibitorPage,
        meta: {
          title: 's_1omalh8',
          tab: 'exhibitor',
          bodyGap: 'tight',
          requiresAuth: true,
          roles: ['exhibitor', 'admin'],
          // 顶栏右侧的加号：与页面里的「新建展会」进同一处，展会多起来时不用先滚到底部。
          // 受限账号点进来也会被那一页的受限态挡住（后端同样 403），这里不额外判断。
          topAction: { icon: 'plus', to: '/exhibition-form', label: 's_p9fllo' },
          queryInPlace: true,
        },
      },
      { path: '/meeting-settings', component: MeetingSettingsPage, meta: { title: 's_1dfgo2m', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      {
        path: '/meeting-apply/:exhibitorId',
        component: MeetingApplyPage,
        meta: { title: 's_ks6zd8', back: true, bodyGap: 'tight', requiresAuth: true, capability: 'register' },
      },
      {
        path: '/admin/meetings/:exhibitorId',
        component: AdminMeetingsPage,
        meta: { title: 's_1lrlx8m', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['admin'] },
      },
      {
        path: '/admin/exhibitions/:exhibitorId',
        component: AdminExhibitionsPage,
        meta: { title: 's_1tkl9jl', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['admin'] },
      },
      { path: '/exhibition-form', component: ExhibitionFormPage, meta: { title: 's_eutzzb', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage, meta: { title: 's_eutzzb', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/review', component: ReviewPage, meta: { title: 's_7xrrf0', back: true, requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/checkin', component: CheckinPage, meta: { title: 's_zqzoiq', back: true, requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      { path: '/rich-editor', component: RichEditorPage, meta: { title: 's_28v8q', back: true, bodyGap: 'tight', requiresAuth: true, roles: ['exhibitor', 'admin'] } },
      // 管理后台只对 admin 开放；`tab: 'admin'` 让底部导航出现管理项。
      // `queryInPlace`：三个分区写在同一屏里，切分区不该把整页重新挂载。
      { path: '/admin', component: AdminPage, meta: { title: 's_cit5ds', tab: 'admin', bodyGap: 'tight', requiresAuth: true, roles: ['admin'], queryInPlace: true } },
    ],
  });

  /**
   * 全局前置守卫：登录 → 角色 → 能力，判定顺序与理由见文件头。
   * 返回 `true` 放行；返回路径或位置对象即改道（vue-router 4 的返回值写法，不用 next()）。
   */
  router.beforeEach((to) => {
    // 先取消上一次还没完成的导航，避免旧页面的懒加载 / 取数在切走后继续写状态
    navigation.begin();
    const session = useSessionStore();
    if (to.meta.requiresAuth && !session.loggedIn) {
      // 带上原 fullPath（含 query），登录成功后按它送回原处
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    // 角色不符回首页而不是登录页：用户已经登录了，再回登录页会像「被登出」
    if (to.meta.roles && !to.meta.roles.includes(session.role)) return '/home';
    // 能力为显式 false 时同样回首页
    if (to.meta.capability && !session.can(to.meta.capability)) return '/home';
    return true;
  });

  // 切换方向写进外壳，motion.css 据此选前进 / 后退 / 原地替换的过渡。
  router.afterEach((to, from) => navigation.track(to, from));

  return router;
}

/** 应用级路由单例：给 `main.ts` 与页面直接用；测试请自己 `createAppRouter(history)`，别共享历史。 */
export const router = createAppRouter();
