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
});
