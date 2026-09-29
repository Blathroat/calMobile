/**
 * 单屏异步取数的三态封装（data / error / loading）。
 *
 * 分工：**缓存不在这里**。读接口统一走 `api/client.ts` 的 `read()`，命中
 * `services/query-cache.ts` 的查询缓存（键 =「接口前缀 + 路径 + 解析后的参数」，TTL 20s），
 * 所以 `run()` 里重复取同一份数据通常不会真的发包。本 composable 只负责把结果与加载态、
 * 错误态绑到当前组件上；它也**不做跨实例去重**（同一屏两次 `run()` 各自独立）。
 *
 * loading / error 语义：
 * - `loading` 从 `run()` 开始，到**这一次**落定为止；旧请求晚到不会关掉新请求的 loading；
 * - `error` 在每次 `run()` 开始时清空（重试即清掉上一次的错误）；
 * - 失败时 `run()` **返回 undefined 而不抛错**，原因统一包成 `Error` 放进 `error`；
 *   页面必须把 `error` 渲染出来（仓库硬约束「失败必须可见」），不能静默当成加载失败。
 *
 * 坑：
 * - 只有**最新一次** `run()` 能写 `data` / `error` / `loading`（内部序号守卫），
 *   避免慢的旧响应盖掉新视图；反过来「先发起的请求先到」也会被丢弃，要合并并发时自己处理；
 * - 组件卸载不做取消：结果照旧写进 ref，只是没人再读；要真正中止请把 AbortSignal 传给接口。
 */
import { ref } from 'vue';

/**
 * 建一组与组件同生命周期的取数状态。
 * @typeParam T 本次取数成功时的结果类型
 * @returns 三态与执行器：
 * - `data`：最近一次成功的值；没成功过是 `undefined`（用它区分「空数据」与「还没取到」）；
 * - `error`：最近一次失败的错误对象；成功或还没跑过是 `undefined`；
 * - `loading`：当前是否有「最新一次」请求在飞（重试期间一直为 true）；
 * - `run(task)`：执行取数任务，成功返回结果，失败返回 `undefined`（不抛错，错误在 `error` 里）。
 */
export function useAsync<T>() {
  const data = ref<T>();
  const error = ref<Error>();
  const loading = ref(false);
  // 序号守卫：只有最后一次 run 才有资格写 data / error / loading
  let sequence = 0;
  async function run(task: () => Promise<T>): Promise<T | undefined> {
    const current = ++sequence;
    loading.value = true;
    // 重新开始就清掉上一次的错误，否则重试成功还挂着旧失败提示
    error.value = undefined;
    try { const result = await task(); if (current === sequence) data.value = result; return result; }
    // 失败不向调用方抛出：原始 reason 不一定是 Error，统一包装后交给 error 呈现
    catch (reason) { if (current === sequence) error.value = reason instanceof Error ? reason : new Error(String(reason)); return undefined; }
    finally { if (current === sequence) loading.value = false; }
  }
  return { data, error, loading, run };
}
