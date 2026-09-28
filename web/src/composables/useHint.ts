/**
 * 一次性提示：只在「账号还没看过」时显示，用户做完对应动作或点「知道了」之后记到账号上。
 *
 * 状态存在后端 `users.seen_hints`（与账号绑定：换设备、重装都还是已读），本机不存；
 * 后端不可用时**本地也标为已读**——这类提示的作用是「教一次」，为它弹错误提示不值当，
 * 大不了下次进页面再教一次。
 *
 * 用法：
 * ```ts
 * const { visible, dismiss } = useHint('home-calendar-swipe');
 * // 模板里 v-if="visible"，做完动作时 await dismiss()
 * ```
 */
import { computed, ref, type ComputedRef } from 'vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';

/** 提示 key：短码，前后端一致（后端按 `^[a-z0-9][a-z0-9-]{2,39}$` 校验）。 */
export type HintKey = 'home-calendar-swipe' | 'exhibitor-checkin';

export interface HintState {
  /** 是否应当显示这条提示（已登录且没看过） */
  visible: ComputedRef<boolean>;
  /** 记下「看过了」：立即从界面移除，再写后端 */
  dismiss: () => Promise<void>;
}

export function useHint(key: HintKey): HintState {
  const session = useSessionStore();
  const busy = ref(false);

  const seen = computed(() => session.user.seenHints?.includes(key) === true);
  // 访客没有账号可记（也就无从「下次不再显示」），因此访客不显示这类提示。
  const visible = computed(() => session.loggedIn && !seen.value);

  async function dismiss(): Promise<void> {
    if (busy.value || seen.value) return;
    busy.value = true;
    // 本地先生效：提示立刻消失，不等网络。
    session.markHint(key);
    try {
      await api.profile.markHint(key);
    } catch {
      // 落库失败不回滚：下一次进页面会再记一次（见文件头）。
    } finally {
      busy.value = false;
    }
  }

  return { visible, dismiss };
}
