import { describe, expect, it, vi } from 'vitest';
import { QueryCache, withForcedReads } from './query-cache';

describe('QueryCache', () => {
  it('deduplicates fresh reads and invalidates by prefix', async () => {
    const cache = new QueryCache(60_000);
    let calls = 0;
    const read = () => {
      calls += 1;
      return Promise.resolve({ calls });
    };
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
    const pending = cache.get(
      'profile:/profile:{}',
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    cache.clear();
    release('old session');
    await pending;
    expect(cache.peek('profile:/profile:{}')).toBeUndefined();
  });

  it('invalidate 作废在途请求：旧结果不写回，下一次读重新发起', async () => {
    const cache = new QueryCache(60_000);
    let release!: (value: string) => void;
    const stale = cache.get(
      'users.list:{}',
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    // 写接口成功后失效：这一趟是「写之前」发出的读，回来的还是旧数据
    cache.invalidate('users');
    release('旧数据');
    await stale;
    expect(cache.peek('users.list:{}')).toBeUndefined();

    // 下一次读不能再搭上那趟旧车，而是真的重新取一次
    let calls = 0;
    const fresh = await cache.get('users.list:{}', () => {
      calls += 1;
      return Promise.resolve('新数据');
    });
    expect(fresh).toBe('新数据');
    expect(calls).toBe(1);
    expect(cache.peek('users.list:{}')).toBe('新数据');
  });

  it('过期后仍保留旧值，强制刷新不走新鲜短路', async () => {
    vi.useFakeTimers();
    try {
      const cache = new QueryCache(1_000);
      await cache.get('profile', async () => '旧');
      vi.advanceTimersByTime(1_001);
      let release!: (value: string) => void;
      const pending = cache.get(
        'profile',
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      );
      expect(pending.revalidating).toBe(true);
      expect(pending.cached).toBe('旧');
      expect(cache.peek('profile')).toBe('旧');
      release('新');
      await expect(pending).resolves.toBe('新');
      expect(cache.peek('profile')).toBe('新');

      const fresh = cache.get('profile', async () => '不该再取');
      expect(fresh.revalidating).toBe(false);
      expect(fresh.cached).toBe('新');
      await fresh;

      let forcedCalls = 0;
      const forced = cache.get(
        'profile',
        async () => {
          forcedCalls += 1;
          return '强制';
        },
        true,
      );
      expect(forced.revalidating).toBe(true);
      expect(forced.cached).toBe('新');
      expect(cache.peek('profile')).toBe('新');
      await forced;
      expect(forcedCalls).toBe(1);
      expect(cache.peek('profile')).toBe('强制');

      let pulled = 0;
      await withForcedReads(async () => {
        const again = cache.get('profile', async () => {
          pulled += 1;
          return '下拉';
        });
        expect(again.revalidating).toBe(true);
        await again;
      });
      expect(pulled).toBe(1);
      expect(cache.peek('profile')).toBe('下拉');
    } finally {
      vi.useRealTimers();
    }
  });
});
