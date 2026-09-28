/**
 * 能力 store：后端下发的布尔开关表（bootstrap 的 `capabilities` 段）加设备侧补充的事实。
 *
 * 与 `stores/session.ts` 的 `user.can` **不是一回事**，别互相替代：
 * - `user.can` 是权限，决定导航项与路由守卫，语义是「没显式说 false 就放行」；
 * - 本 store 是能力 / 设备事实（通知权限、摄像头之类），语义是「只有显式为 true 才算有」。
 *
 * 谁写：`app/runtime.ts` 用 bootstrap 的 `capabilities` 段整体下发；
 * `app/theme.ts` 的 `syncDevice()` 拿原生回包补一个 `notifications`。
 * 谁读：`pages/UserSettingsPage.vue` 直接读 `values.notifications`。
 *
 * 不变量与坑：
 * - `apply()` 是浅合并，只增改不删除：后端从「发 true」改成「不发这个键」时，本机仍留着旧 true；
 *   真要下架就显式发 `false`。
 * - 表里没有的键一律按「不具备」处理（默认拒绝），所以取值要写 `values[name] === true`，
 *   别顺手写成 `!== false`。
 * - 没有清空动作，也不随登出复位：通知权限这类设备事实本来就与账号无关。
 */
import { defineStore } from 'pinia';
import type { JsonObject } from '@/api/types';

/** 布尔能力表；表里没有的键一律视为不具备。 */
export const useCapabilitiesStore = defineStore('capabilities', {
  state: () => ({ values: {} as JsonObject }),
  actions: {
    /**
     * 合并一批能力值（浅合并，见文件头）。
     * @param values 键 → 布尔；缺省时是空操作，方便直接透传可能为空的回包
     */
    apply(values: JsonObject = {}) {
      this.values = { ...this.values, ...values };
    },
  },
});
