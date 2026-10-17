/**
 * 跨页面会话状态：当前用户、是否已登录、是否受限，以及路由守卫要用的权限表。
 *
 * 服务端始终是身份与权限的最终权威：这里存的只是**最近一次响应的副本**，
 * 不是持久化的账号数据；令牌失效时由 `api/client.ts` 清会话与缓存，外壳负责回登录页。
 *
 * 谁写：`app/runtime.ts`（bootstrap 的 `user` 段）、登录 / 注册 / 资料 / 安全各页面在拿到
 * 新用户后回写、`api/client.ts` 登出时调 `clear()`。
 * 谁读：`app/router.ts` 的守卫（`loggedIn` / `role` / `can`）、`app/App.vue`（底部导航项）、
 * 页面里的 `limited` 与 `user.can.xxx`（按钮可用性）。
 *
 * 不变量与坑：
 * - `applyUser()` 每次都先用 `emptyUser()` 打底再合并：后端少发的字段退回 guest + 空权限表，
 *   不会把上一个账号的昵称、头像留在屏幕上。
 * - `loggedIn` 由「后端显式 `loggedIn === true`」或兜底的「带了 `id`」推出；访客 payload
 *   两个都没有，所以访客始终是未登录状态。
 * - `guest` 与 `loggedIn` 互斥（`guest` 只在未登录且后端没显式否认时为 true），别单独改其中一个。
 * - `can()` 是**默认放行**（只有显式 `false` 才拦），与 `stores/capabilities.ts` 的 `has()`
 *   （默认拒绝）语义相反；空权限表下它会把一切都放行，因此守卫必须先用 `requiresAuth` 挡住匿名访问。
 * - state 不持久化：冷启动时是空会话，真实登录态等 `bootApp()` 落定（见 `main.ts`）。
 */
import { t } from '@/i18n';
import { defineStore } from 'pinia';
import type { User } from '@/api/types';

export interface SessionState {
  /** 是否已登录；后端漏发 `loggedIn` 时用「带了 `id`」兜底判定 */
  loggedIn: boolean;
  /** 认证端明确拒绝续期后置位，由应用外壳负责跳回登录页。 */
  expired: boolean;
  /** 是否访客态；只在未登录时为 true，与 `loggedIn` 互斥 */
  guest: boolean;
  /** 最近一次后端下发的用户对象（字段全是可选的），读时自己兜底 */
  user: User;
  /**
   * 资料写入的代数。上传头像、保存资料、退出登录都会加一。
   * 更早发出的 `GET /profile` 回来后不得再 `applyUser`，否则会把新头像盖回旧地址。
   */
  profileEpoch: number;
}

/**
 * 空用户兜底：角色 guest、标签取注入文案、权限表为空。
 * @returns 一份全新的用户对象，避免多个 store 实例共享同一引用
 */
const emptyUser = (): User => ({ role: 'guest', roleLabel: t('auth.login.guest'), can: {} });

/** 当前会话；写入口是 `applyUser()` / `clear()` / `expire()`，别直接改 state。 */
export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({ loggedIn: false, expired: false, guest: true, user: emptyUser(), profileEpoch: 0 }),
  getters: {
    /** 当前角色代码（后端下发英文代码，展示用 `user.roleLabel`）；缺失时按 guest 处理。 */
    role: (state) => String(state.user.role ?? 'guest'),
    /** 受限账号：能看不能改（不能发布 / 修改 / 删除展会、不能核销），页面据此禁用按钮。 */
    limited: (state) => state.user.can?.limited === true,
    /**
     * 权限查询（默认放行）。
     * @param capability 权限键名（`register` / `profile` / `exhibitor` / `admin` 等）
     * @returns 只有后端显式下发 `false` 才返回 false；键缺失、权限表为空都返回 true
     */
    can: (state) => (capability: string) => state.user.can?.[capability] !== false,
  },
  actions: {
    /**
     * 用后端下发的用户对象覆盖当前会话（先拿空用户打底，理由见文件头）。
     * @param user 后端返回的 `user`；缺省表示「后端没给用户信息」，此时退回未登录的访客态
     */
    applyUser(user: User = {}) {
      this.user = { ...emptyUser(), ...user };
      this.loggedIn = user.loggedIn === true || user.id !== undefined;
      this.guest = user.guest !== false && !this.loggedIn;
      this.expired = false;
    },
    /** 登出 / 令牌失效时复位到访客态；不负责清后端缓存（那是 `api/client.ts` 的事）。 */
    /** 记一次更新的资料写入，让尚在途中的旧资料响应作废。 */
    bumpProfile() {
      this.profileEpoch += 1;
    },
    clear() {
      this.loggedIn = false;
      this.expired = false;
      this.guest = true;
      this.user = emptyUser();
      // 加一而不是归零：退出前发出的资料请求仍持有旧代数，回来时不能把用户写回来。
      this.profileEpoch += 1;
    },
    /** 令牌被认证端拒绝：与用户主动退出区分，供外壳带回原地址重新登录。 */
    expire() {
      this.clear();
      this.expired = true;
    },
    /**
     * 本地记下一条「已看过的一次性提示」（乐观更新）。
     * 落库由 `composables/useHint.ts` 负责；写失败也不回滚，提示少显示一次比弹错误好。
     * @param key 提示短码，见 `HintKey`
     */
    markHint(key: string) {
      const seen = Array.isArray(this.user.seenHints) ? this.user.seenHints : [];
      if (seen.includes(key)) return;
      this.user = { ...this.user, seenHints: [...seen, key] };
    },
  },
});
