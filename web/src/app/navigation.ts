/** 集中处理路由请求的取消与过期响应，页面无需各自维护序号。 */
export interface NavigationScope {
  id: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}

class NavigationCoordinator {
  private sequence = 0;
  private active: { id: number; controller: AbortController } | undefined;

  begin(): NavigationScope {
    this.active?.controller.abort();
    const current = { id: ++this.sequence, controller: new AbortController() };
    this.active = current;
    return { id: current.id, signal: current.controller.signal, isCurrent: () => this.active?.id === current.id };
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }
}

export const navigation = new NavigationCoordinator();
