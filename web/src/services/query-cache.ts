/**
 * 查询缓存与并发请求协调器，避免旧响应覆盖新视图。
 *
 * **键的约定**：键是普通字符串，由 `api/client.ts` 拼成 `前缀:路径:参数`。失效是按前缀匹配的，
 * 所以读键的前缀与写接口声明的失效前缀必须同族：`registrations.record` 能被 `registrations`
 * 命中，写成 `registration.record` 就永远失效不到。
 *
 * **`invalidate(prefix)` 与 `clear()` 的区别**（最容易踩的一处）：
 * - `invalidate` 只按前缀删掉已缓存的值，**不动在途请求，也不推进代数**。失效之前就发出的那个
 *   读请求回来时仍会把旧值写进缓存 —— 刚写完数据，一个更早发出的读可能把旧值盖回来。
 *   要彻底切断，只能用 `clear()`。
 * - `clear()` 推进代数，让在途请求的结果在落地时被丢弃（不会重新填回缓存），并清空在途表。
 *   身份变化（登录 / 退出 / 切账号）必须走它，否则会把上一个用户的数据给下一个用户。
 *
 * **并发**：同一个键上的并发读共享同一个 Promise，因此只发一次请求；代价是它们拿到**同一个
 * 对象引用**，调用方不要原地修改返回值，那会改到缓存里的对象。
 *
 * 缓存值没有过期通知，只在读的时候按 TTL 判一次，`peek` 连 TTL 都不看。进程内存储，
 * 页面刷新即消失，不做持久化（离线数据不走这里）。
 */

/** 缓存条目：值与写入时间（用来算 TTL 是否新鲜）。 */
interface CacheEntry<T> { value: T; at: number; }

/** 一个进程内、按 TTL 生效的内存缓存。只缓存读接口结果，写接口负责失效。 */
export class QueryCache {
  // 键 → 值 + 写入时间。TTL 只在读取时比一次，不做定时清理，因此长时间不读的旧值会一直占着。
  private readonly values = new Map<string, CacheEntry<unknown>>();
  // 在途请求：同键的并发读共享它，避免同一份数据打两次；请求结束即删。
  private readonly inflight = new Map<string, Promise<unknown>>();
  // 代数：clear 时自增，用来让 clear 之前发出的请求结果作废。
  private generation = 0;

  /**
   * @param ttlMs 缓存有效期（毫秒），缺省 20 秒：短到用户不会看到明显过期的数据，
   *   长到能吸收底部导航来回切换；传 0 相当于每次都重新取。
   */
  constructor(private readonly ttlMs = 20_000) {}

  /**
   * 只看已缓存的值：不触发读取、不考虑 TTL、也不认在途请求。
   * 返回 `undefined` 只表示「此刻没有可用的值」，不代表这个键没有数据。
   */
  peek<T>(key: string): T | undefined {
    // 有值但已过期时这里照样返回它：调用方拿到的是旧值，不是 undefined。
    return this.values.get(key)?.value as T | undefined;
  }

  /**
   * 取一个键：有新鲜缓存就直接返回，有同键在途请求就搭车，否则调用 `read` 取一次。
   *
   * @param key 缓存键，必须带上所有影响结果的参数（参数不同就是两个不同的键）。
   * @param read 真正取数的函数，只在缓存未命中且无在途请求时被调用。
   * @returns 解析后的值；同一键的并发调用者拿到同一个引用。
   * @throws 透传 `read` 的异常：失败结果不写缓存，并且所有搭车的调用者收到同一个错误。
   */
  async get<T>(key: string, read: () => Promise<T>): Promise<T> {
    // 命中且未过期才直接用；过期的当没有，重新取。
    const cached = this.values.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value as T;
    const existing = this.inflight.get(key);
    // 已有同键请求就搭车，否则两个组件同时要同一份数据会各发一次请求。
    if (existing) return existing as Promise<T>;
    // 记下发起时的代数：这期间 clear 过，说明结果属于上一个身份，不能写回。
    const generation = this.generation;
    const task = read().then((value) => {
      if (generation === this.generation) this.values.set(key, { value, at: Date.now() });
      return value;
    }).finally(() => {
      // 只删自己这一条：期间被 clear 掉或已换成新任务时，别误删别人的在途记录。
      if (this.inflight.get(key) === task) this.inflight.delete(key);
    });
    // 先登记再返回：调用方拿到 Promise 后可能立刻再发一次同样的读。
    this.inflight.set(key, task);
    return task;
  }

  /**
   * 按前缀失效：删掉所有以 `prefix` 开头的缓存键。
   * 不传前缀等于清空值表（但不推进代数、不清在途，见类注释）。
   * 写接口成功之后才调用，前缀要和读键的前缀同一族。
   */
  invalidate(prefix?: string): void {
    if (!prefix) { this.values.clear(); return; }
    // 匹配的是拼好的完整键，所以前缀必须落在键的起始处才对得上。
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
  }

  /**
   * 清空缓存并推进代数：在途请求即使成功也不会再写回。
   * 身份变化、退出登录后必须调用，避免把上一个用户的数据给下一个用户。
   */
  clear(): void {
    // 代数先自增：在途请求的 .then 里比的就是它。
    this.generation += 1;
    this.values.clear();
    this.inflight.clear();
  }
}
