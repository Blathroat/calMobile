interface CacheEntry<T> { value: T; at: number; }

export class QueryCache {
  private readonly values = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs = 20_000) {}

  peek<T>(key: string): T | undefined {
    return this.values.get(key)?.value as T | undefined;
  }

  async get<T>(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value as T;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const task = read().then((value) => {
      this.values.set(key, { value, at: Date.now() });
      return value;
    }).finally(() => {
      if (this.inflight.get(key) === task) this.inflight.delete(key);
    });
    this.inflight.set(key, task);
    return task;
  }

  invalidate(prefix?: string): void {
    if (!prefix) { this.values.clear(); return; }
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
  }
}
