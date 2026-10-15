/**
 * 导航协调：集中处理路由请求的取消、过期响应与切换方向。
 *
 * 方向只在这里算一次，`App.vue` 把它写到 `.app[data-direction]`，
 * motion.css 据此决定页面是前进、后退还是原地替换的过渡。
 */
import { ref, type Ref } from 'vue';

export type NavDirection = 'forward' | 'back' | 'none';

/**
 * 底部导航的顺序：只用来判断标签页之间是往左还是往右滑。
 * 与 `app/shell.ts` 的 `tabItems()` 顺序一致（排除掉没有能力时不显示的项）。
 */
const TAB_ORDER = ['home', 'my-registrations', 'exhibitor', 'admin', 'profile'];

export interface NavigationScope {
  id: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}

/** 路径深度：`/detail/3` 比 `/home` 深一层，用来判断是进入还是返回。 */
function depth(path: string): number {
  return String(path || '')
    .split('/')
    .filter(Boolean).length;
}

class NavigationCoordinator {
  private sequence = 0;
  private active: { id: number; controller: AbortController } | undefined;

  readonly direction: Ref<NavDirection> = ref('none');

  /**
   * 标签页之间的滑动方向：按底部导航的左右顺序算（`forward` = 往右滑进新页）。
   *
   * 单独一支信号是因为标签页不能用 `direction`：`forward` / `back` 的过渡带淡入，
   * 淡入期间会露出外壳背景 —— 浅色模式下就是「切换时闪一下白」。标签页改用只位移不淡入的
   * 过渡（见 `motion.css` 的 `tab-in-*`），所以方向单独记。
   */
  readonly tabMove: Ref<NavDirection> = ref('none');

  begin(): NavigationScope {
    this.active?.controller.abort();
    const id = this.sequence + 1;
    this.sequence = id;
    const current = { id, controller: new AbortController() };
    this.active = current;
    return this.current()!;
  }

  /** 页面每次取数时取得当前导航；原地切分区后也会获得新的生命周期。 */
  current(): NavigationScope | undefined {
    const current = this.active;
    if (!current) return undefined;
    return { id: current.id, signal: current.controller.signal, isCurrent: () => this.active?.id === current.id };
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }

  /**
   * 记录这一次切换的方向。
   * 底部导航之间是平级切换：`direction` 记 `none`（不做前进 / 后退），
   * 左右顺序记在 `tabMove` 上，动画是只位移不淡入的横向滑动。
   */
  track(
    to: { path: string; meta?: Record<string, unknown> },
    from: { path: string; meta?: Record<string, unknown>; matched?: unknown[] },
  ): void {
    // 冷启动的第一次跳转：`from` 是路由的起始位置（没有匹配到任何记录），
    // 这时不该放「进入下一页」的过渡——首帧应当是静态落地的。
    if (Array.isArray(from.matched) && from.matched.length === 0) {
      this.direction.value = 'none';
      this.tabMove.value = 'none';
      return;
    }
    // 同一屏内只换了 query（管理页的分区、搜索词这类）：页面没有真的换，
    // 这里就**一个信号都不动**。动了反而会把动画名从 tab-in-* 切成 route-in，
    // 浏览器于是给同一个元素重放一次淡入 —— 那正是「切分区闪一下」的来源。
    if (to.path === from.path) return;
    const toTab = typeof to.meta?.tab === 'string' ? to.meta.tab : '';
    const fromTab = typeof from.meta?.tab === 'string' ? from.meta.tab : '';
    if (toTab && fromTab) {
      this.direction.value = 'none';
      const next = TAB_ORDER.indexOf(toTab);
      const previous = TAB_ORDER.indexOf(fromTab);
      // 顺序表里认不出的 id（新增了标签页却忘了登记）就不动，避免算出反方向。
      this.tabMove.value =
        next < 0 || previous < 0 || next === previous ? 'none' : next > previous ? 'forward' : 'back';
      return;
    }
    this.tabMove.value = 'none';
    const next = depth(to.path);
    const previous = depth(from.path);
    this.direction.value = next > previous ? 'forward' : next < previous ? 'back' : 'none';
  }
}

export const navigation = new NavigationCoordinator();
