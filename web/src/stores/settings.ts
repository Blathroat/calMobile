/**
 * 显示设置 store：`ui.mode`（明暗模式）。
 *
 * 明暗模式的权威来源是账号（`users.ui_mode`）：本机只缓存一份给首帧不闪白（`index.html`
 * 的内联脚本读缓存）。所以这里的 `setMode()` 只改内存，落库与失败回滚由
 * `app/preferences.ts` 负责 —— 页面里别直接改这个 store 冒充「已经保存」。
 *
 * 谁写：`app/runtime.ts` 用 bootstrap 的 `ui` 段初始化；
 * `app/theme.ts` 的 `applyMode()` 改 `mode`（切换、初始化、回滚都走它）。
 * 谁读：`app/theme.ts`（`effectiveMode()` 与同步给原生的外观镜像）。
 *
 * 不变量与坑：
 * - 只保留 `ui` 一段：bootstrap 的 `theme` 段（色板与全局默认下标）由 `stores/bootstrap.ts`
 *   持有，这里曾经也存一份但没有任何消费者，已删掉，别再复制回来。
 * - `ui` 是浅合并，缺字段保留旧值；`mode` 只认 `auto` / `light` / `dark` 三值，
 *   读出来一律 String 并兜底 `auto`；非法值（后端回空串、回 null）按跟随系统处理，不会报错。
 * - 没有清空动作：登出后模式沿用本机值，下次登录由 bootstrap 覆盖。
 */
import { defineStore } from 'pinia';
import type { JsonObject } from '@/api/types';

/** 外观与显示偏好；`ui.mode` 是目前唯一的业务字段。 */
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    // 首帧兜底：跟随系统，避免 `index.html` 缓存缺失时闪一次浅色
    ui: { mode: 'auto' } as JsonObject,
  }),
  getters: {
    /** 当前明暗模式；缺省即 `auto`（跟随系统），最终明暗由 `app/theme.ts` 判定。 */
    mode: (state) => String(state.ui.mode ?? 'auto'),
  },
  actions: {
    /**
     * 浅合并后端下发的设置；只接受对象，其余（null / 数组 / 标量）直接忽略。
     * 不校验 `ui.mode` 的取值：非法值交给 `mode` getter 与 `effectiveMode()` 兜底。
     * @param settings bootstrap 里的 `{ ui }`；缺省时是空操作
     */
    apply(settings: JsonObject = {}) {
      if (settings.ui && typeof settings.ui === 'object') this.ui = { ...this.ui, ...(settings.ui as JsonObject) };
    },
    /**
     * 只改内存里的模式（本地先生效，界面立刻变）。
     * @param mode 目标模式；落库与失败回滚见 `app/preferences.ts` 的 `saveUiMode()`
     */
    setMode(mode: 'auto' | 'light' | 'dark') {
      this.ui.mode = mode;
    },
  },
});
