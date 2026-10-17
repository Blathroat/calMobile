/**
 * 页面取数三态与生命周期。查询缓存和相同请求去重仍由 api/client.ts 负责。
 *
 * 只有最新请求可以写 data / error / loading 并把结果返回调用方；重试保留已有数据。
 * 重新执行、导航离开或组件卸载都会取消旧任务。失败和取消返回 undefined，当前失败
 * 放入 error，由页面呈现。task 可在多步异步操作之间检查 signal，阻止后续副作用。
 * 取消不终止查询缓存共享的网络请求，只丢弃当前页面已经过期的结果。
 *
 * 任务返回的 Promise 如果带有查询缓存的 `cached`，且页面还没有内容，会同步先画那份旧值。
 * `revalidating === false` 表示新鲜缓存，不进入忙碌。缺省这个字段时仍视为要等网络。
 */
import { onScopeDispose, ref } from 'vue';
import { navigation } from '@/app/navigation';
import type { CachedRead } from '@/services/query-cache';

export function useAsync<T>() {
  const data = ref<T>();
  const error = ref<Error>();
  const loading = ref(false);
  let active: AbortController | undefined;
  let disposed = false;
  let detachNavigation: (() => void) | undefined;

  /** 取消当前消费；保留上一次成功的数据，避免刷新时清空页面。 */
  function cancel(): void {
    active?.abort();
    active = undefined;
    detachNavigation?.();
    detachNavigation = undefined;
    loading.value = false;
  }

  onScopeDispose(() => {
    disposed = true;
    cancel();
  });

  /** 任务中途拿到缓存快照时补画。已有内容或组件已卸载时不动。 */
  function seed(value: T): void {
    if (disposed || data.value !== undefined) return;
    data.value = value;
  }

  async function run(task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (disposed) return undefined;
    cancel();
    const controller = new AbortController();
    active = controller;
    const route = navigation.current();
    route?.signal.addEventListener('abort', cancel, { once: true });
    detachNavigation = () => route?.signal.removeEventListener('abort', cancel);
    const pending = task(controller.signal);
    const tagged = pending as Partial<CachedRead<T>>;
    // 过期缓存先画出来。已有内容时不回退到更早的快照。
    if (tagged.cached !== undefined && data.value === undefined) data.value = tagged.cached;
    // 新鲜缓存不闪忙碌。没有标记的普通 Promise 仍视为要等网络，避免漏掉加载态。
    loading.value = data.value === undefined || tagged.revalidating !== false;
    error.value = undefined;
    try {
      const result = await pending;
      if (active !== controller || controller.signal.aborted) return undefined;
      data.value = result;
      return result;
    } catch (reason) {
      if (active === controller && !controller.signal.aborted) {
        error.value = reason instanceof Error ? reason : new Error(String(reason));
      }
      return undefined;
    } finally {
      if (active === controller) {
        detachNavigation?.();
        detachNavigation = undefined;
        active = undefined;
        loading.value = false;
      }
    }
  }
  return { data, error, loading, run, cancel, seed };
}
