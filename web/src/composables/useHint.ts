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
import { useBootstrapStore } from '@/stores/bootstrap';
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
    // 隐私模式可能拒绝写入本机存储：当前页面照样收起这条提示，不因为存不下而卡住。
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
  const bootstrap = useBootstrapStore();
  const busy = ref(false);
  const localSeen = ref(readLocalHints().includes(key));

  const seen = computed(() => session.user.seenHints?.includes(key) === true);
  /**
   * 访客分支要等启动数据落定（`bootstrap.booted`）再显示：`main.ts` 先挂载外壳、后恢复会话，
   * 这段窗口里登录用户还是访客态，本机键又几乎永远是空的，会让账号上已读的提示闪一下；
   * 用户在窗口里点「知道了」还会把本机键当成访客已读写进去。
   */
  const visible = computed(() => (session.loggedIn ? !seen.value : bootstrap.booted && !localSeen.value));

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
      // 落库失败不回滚：本次已经收起，不为这种非阻塞提示弹错误（见文件头）。
    } finally {
      busy.value = false;
    }
  }

  return { visible, dismiss };
}
