import { describe, expect, it } from 'vitest';
import { QueryCache } from './query-cache';

describe('QueryCache', () => {
  it('deduplicates fresh reads and invalidates by prefix', async () => {
    const cache = new QueryCache(60_000);
    let calls = 0;
    const read = () => { calls += 1; return Promise.resolve({ calls }); };
    const first = await cache.get('exhibitions.list:{}', read);
    const second = await cache.get('exhibitions.list:{}', read);
    expect(first).toBe(second);
    expect(calls).toBe(1);
    cache.invalidate('exhibitions');
    await cache.get('exhibitions.list:{}', read);
    expect(calls).toBe(2);
  });

  it('does not repopulate after clear while a read is in flight', async () => {
    const cache = new QueryCache();
    let release!: (value: string) => void;
    const pending = cache.get('profile:/profile:{}', () => new Promise<string>((resolve) => { release = resolve; }));
    cache.clear();
    release('old session');
    await pending;
    expect(cache.peek('profile:/profile:{}')).toBeUndefined();
  });

  it('invalidate 作废在途请求：旧结果不写回，下一次读重新发起', async () => {
    const cache = new QueryCache(60_000);
    let release!: (value: string) => void;
    const stale = cache.get('users.list:{}', () => new Promise<string>((resolve) => { release = resolve; }));
    // 写接口成功后失效：这一趟是「写之前」发出的读，回来的还是旧数据
    cache.invalidate('users');
    release('旧数据');
    await stale;
    expect(cache.peek('users.list:{}')).toBeUndefined();

    // 下一次读不能再搭上那趟旧车，而是真的重新取一次
    let calls = 0;
    const fresh = await cache.get('users.list:{}', () => { calls += 1; return Promise.resolve('新数据'); });
    expect(fresh).toBe('新数据');
    expect(calls).toBe(1);
    expect(cache.peek('users.list:{}')).toBe('新数据');
  });
});
