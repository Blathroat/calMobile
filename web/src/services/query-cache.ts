/**
 * 查询缓存与并发请求协调器，避免旧响应覆盖新视图。
 *
 * **键的约定**：键是普通字符串，由 `api/client.ts` 拼成 `前缀:路径:参数`。失效是按前缀匹配的，
 * 所以读键的前缀与写接口声明的失效前缀必须同族：`registrations.record` 能被 `registrations`
 * 命中，写成 `registration.record` 就永远失效不到。
 *
 * **`invalidate(prefix)` 与 `clear()` 的区别**：
 * - `invalidate` 按前缀删值，并且**把同前缀的在途请求一起作废**：这些请求是失效之前发出的，
 *   回来的是写操作之前的旧数据，写回缓存等于让刚写完的界面又读到旧值。作废后同键的下一次
 *   读会重新发起（不会搭上那趟旧车）。
 * - `clear()` 清空一切并推进代数，用于身份变化（登录 / 退出 / 切账号）：在途结果一律丢弃，
 *   否则会把上一个用户的数据给下一个用户。
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
  // 每个键的作废次数：invalidate 时自增，让失效之前发出的那次读不再写回。
  // 用「每键计数」而不是一个共享的集合：否则同一键后来重新发起读会把标记清掉，
  // 之前那趟旧请求回来时又会被当成有效结果写回。
  private readonly epochs = new Map<string, number>();

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
    // 记下发起时的代数与这一键的作废次数：期间 clear 过或 invalidate 过，结果都不能写回。
    const generation = this.generation;
    const epoch = this.epochOf(key);
    const task = read().then((value) => {
      const valid = generation === this.generation && epoch === this.epochOf(key);
      if (valid) this.values.set(key, { value, at: Date.now() });
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
   * 按前缀失效：删掉所有以 `prefix` 开头的缓存键，并作废同前缀的在途请求。
   * 不传前缀等于清空值表（在途请求同样一起作废；身份变化请用 `clear()`）。
   * 写接口成功之后才调用，前缀要和读键的前缀同一族。
   */
  invalidate(prefix?: string): void {
    const matches = (key: string) => !prefix || key.startsWith(prefix);
    // 匹配的是拼好的完整键，所以前缀必须落在键的起始处才对得上。
    for (const key of [...this.values.keys()]) if (matches(key)) this.values.delete(key);
    for (const key of [...this.inflight.keys()]) {
      if (!matches(key)) continue;
      // 从在途表里摘掉：下一次读要重新发起，而不是搭上这趟「写操作之前」的车。
      this.inflight.delete(key);
      // 作废计数 +1：这趟旧请求回来时不写回（后发起的读有自己的计数，不受影响）。
      this.epochs.set(key, this.epochOf(key) + 1);
    }
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
    this.epochs.clear();
  }

  /** 这一键当前的作废次数；没有记录就是 0。 */
  private epochOf(key: string): number {
    return this.epochs.get(key) ?? 0;
  }
}
