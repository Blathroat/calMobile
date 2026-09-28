/**
 * 导航协调：集中处理路由请求的取消、过期响应与切换方向。
 *
 * 方向只在这里算一次，`App.vue` 把它写到 `.app[data-direction]`，
 * motion.css 据此决定页面是前进、后退还是原地替换的过渡。
 */
import { ref, type Ref } from 'vue';

export type NavDirection = 'forward' | 'back' | 'none';

export interface NavigationScope {
  id: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}

/** 路径深度：`/detail/3` 比 `/home` 深一层，用来判断是进入还是返回。 */
function depth(path: string): number {
  return String(path || '').split('/').filter(Boolean).length;
}

class NavigationCoordinator {
  private sequence = 0;
  private active: { id: number; controller: AbortController } | undefined;

  readonly direction: Ref<NavDirection> = ref('none');

  begin(): NavigationScope {
    this.active?.controller.abort();
    const id = this.sequence + 1;
    this.sequence = id;
    const current = { id, controller: new AbortController() };
    this.active = current;
    return { id: current.id, signal: current.controller.signal, isCurrent: () => this.active?.id === current.id };
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }

  /**
   * 记录这一次切换的方向。
   * 底部导航之间是平级切换，按「原地替换」处理，不做左右滑动的观感。
   */
  track(
    to: { path: string; meta?: Record<string, unknown> },
    from: { path: string; meta?: Record<string, unknown>; matched?: unknown[] },
  ): void {
    // 冷启动的第一次跳转：`from` 是路由的起始位置（没有匹配到任何记录），
    // 这时不该放「进入下一页」的过渡——首帧应当是静态落地的。
    if (Array.isArray(from.matched) && from.matched.length === 0) {
      this.direction.value = 'none';
      return;
    }
    const tabbed = to.meta?.tab !== undefined && from.meta?.tab !== undefined;
    if (tabbed) {
      this.direction.value = 'none';
      return;
    }
    const next = depth(to.path);
    const previous = depth(from.path);
    this.direction.value = next > previous ? 'forward' : next < previous ? 'back' : 'none';
  }
}

export const navigation = new NavigationCoordinator();
