/**
 * 一次性提示：用户做完对应动作或点「知道了」后记录为已读。
 *
 * 登录用户的状态存在后端 `users.seen_hints`（与账号绑定）。访客状态保存在本机，因为没有账号可关联。
 * 写入失败时当前页面仍立即收起提示，不为这种非阻塞提示弹网络错误。
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
export type HintKey =
  | 'home-calendar-swipe'
  | 'exhibitor-checkin'
  | 'exhibition-detail'
  | 'registration-form'
  | 'registration-status'
  | 'admin-settings-route';

const LOCAL_HINTS_KEY = 'calmobile.seen-hints';

function readLocalHints(): string[] {
  try {
    const stored = localStorage.getItem(LOCAL_HINTS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalHint(key: HintKey): void {
  const seen = readLocalHints();
  if (seen.includes(key)) return;
  try {
    localStorage.setItem(LOCAL_HINTS_KEY, JSON.stringify([...seen, key]));
  } catch {
    // Private browsing may deny storage. The current page still dismisses the hint.
  }
}

export interface HintState {
  /** 当前身份还没看过时是否显示 */
  visible: ComputedRef<boolean>;
  /** 记下「看过了」：立即从界面移除，再写后端 */
  dismiss: () => Promise<void>;
}

export function useHint(key: HintKey): HintState {
  const session = useSessionStore();
  const busy = ref(false);
  const localSeen = ref(readLocalHints().includes(key));

  const seen = computed(() => session.user.seenHints?.includes(key) === true);
  const visible = computed(() => (session.loggedIn ? !seen.value : !localSeen.value));

  async function dismiss(): Promise<void> {
    if (busy.value || (session.loggedIn ? seen.value : localSeen.value)) return;
    busy.value = true;
    const loggedIn = session.loggedIn;
    if (loggedIn) session.markHint(key);
    else localSeen.value = true;
    try {
      if (loggedIn) await api.profile.markHint(key);
      else writeLocalHint(key);
    } catch {
      // 落库失败不回滚：下一次进页面会再记一次（见文件头）。
    } finally {
      busy.value = false;
    }
  }

  return { visible, dismiss };
}
