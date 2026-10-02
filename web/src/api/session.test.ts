import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './client';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.unstubAllGlobals(); delete window.CalMobileNative; });

describe('会话身份隔离', () => {
  it('退出后未完成的刷新不能恢复旧令牌或重放旧请求', async () => {
    const renewal = deferred<Response>();
    const fetcher = vi.fn(async (url: string) => url.endsWith('/auth/refresh')
      ? renewal.promise : response({ error: '过期' }, 401));
    vi.stubGlobal('fetch', fetcher);
    const api = createApi('http://test');
    api.session.setTokens({ token: 'old', refreshToken: 'refresh-old' });
    const pending = api.profile.get().catch((error) => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    api.session.clear();
    renewal.resolve(response({ token: 'late', refreshToken: 'refresh-late' }));
    await pending;
    expect(api.session.token).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('换号后旧查询不能作为新账号数据返回', async () => {
    const oldProfile = deferred<Response>();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => (init?.headers as Record<string, string>).Authorization === 'Bearer a'
      ? oldProfile.promise : response({ username: 'b' }));
    vi.stubGlobal('fetch', fetcher);
    const api = createApi('http://test');
    api.session.setTokens({ token: 'a' });
    const pending = api.profile.get().catch((error) => error);
    api.session.setTokens({ token: 'b' });
    expect(await api.profile.get()).toEqual({ username: 'b' });
    oldProfile.resolve(response({ username: 'a' }));
    expect(await pending).toMatchObject({ name: 'TransportError', reason: 'aborted' });
    expect(await api.profile.get()).toEqual({ username: 'b' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('退出立即清令牌，吊销请求不触发续期', async () => {
    const revocation = deferred<Response>();
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => revocation.promise);
    vi.stubGlobal('fetch', fetcher);
    const api = createApi('http://test');
    api.session.setTokens({ token: 'a', refreshToken: 'refresh-a' });
    const pending = api.auth.logout();
    const tokenDuringRevocation = api.session.token;
    let exited = false;
    void pending.then(() => { exited = true; });
    await Promise.resolve();
    const exitedBeforeRevocation = exited;
    revocation.resolve(response({ error: '过期' }, 401));
    await pending;
    expect(exitedBeforeRevocation).toBe(true);
    expect(tokenDuringRevocation).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ refreshToken: 'refresh-a' });
  });

  it('刷新凭据被拒绝后，不能再命中上一身份的资料缓存', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/profile')) return Response.json({ username: (init?.headers as Record<string, string>).Authorization ? 'a' : 'guest' });
      return response({ error: '过期' }, 401);
    });
    vi.stubGlobal('fetch', fetcher);
    const api = createApi('http://test');
    api.session.setTokens({ token: 'a', refreshToken: 'refresh-a' });
    expect(await api.profile.get()).toEqual({ username: 'a' });
    await api.security.get().catch(() => undefined);
    expect(api.session.token).toBeUndefined();
    expect(await api.profile.get()).toEqual({ username: 'guest' });
  });

  it('设备恢复回包迟于退出时不再恢复身份', async () => {
    let loadId = '';
    window.CalMobileNative = { invoke: (action, _payload, callbackId) => {
      if (action === 'session.load') loadId = callbackId;
      else window.CalMobileBridge?.onResult(callbackId, true, {}, null, null);
    } };
    const fetcher = vi.fn(async () => response({ token: 'late' }));
    vi.stubGlobal('fetch', fetcher);
    const api = createApi('http://test');
    const pending = api.session.restore();
    api.session.clear();
    window.CalMobileBridge?.onResult(loadId, true, { refreshToken: 'old', username: 'a' }, null, null);
    expect(await pending).toBe(false);
    expect(api.session.token).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
