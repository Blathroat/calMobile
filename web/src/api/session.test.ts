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
  it('敏感安全操作只提交用途限定身份复核票', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return response({ ok: true, stepUpToken: 'step-up', email: 'new@example.com' });
    }));
    const api = createApi('http://test/api/v1');
    api.session.setTokens({ token: 'access' });

    await api.security.identityEmailCode();
    await api.security.verifyIdentity('totp', '123456', 'email');
    await api.security.totpSetup('setup-proof');
    await api.security.totpEnable('654321', 'confirm-proof');
    await api.security.activateTotp();
    await api.security.disableTwoFactor('factor-proof');
    await api.security.changeEmail('new@example.com', 'email-proof');
    await api.profile.changePassword({ newPassword: 'secret-123', confirmPassword: 'secret-123', stepUpToken: 'password-proof' });

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/api/v1/profile/security/email-code',
      '/api/v1/profile/security/verify',
      '/api/v1/profile/2fa/totp/setup',
      '/api/v1/profile/2fa/totp/enable',
      '/api/v1/profile/2fa/totp/activate',
      '/api/v1/profile/2fa/disable',
      '/api/v1/profile/email',
      '/api/v1/profile/password',
    ]);
    expect(requests[1]?.body).toEqual({ method: 'totp', code: '123456', scope: 'email' });
    expect(requests[2]?.body).toEqual({ stepUpToken: 'setup-proof' });
    expect(requests[3]?.body).toEqual({ code: '654321', stepUpToken: 'confirm-proof' });
    expect(requests[5]?.body).toEqual({ stepUpToken: 'factor-proof' });
    expect(requests[6]?.body).toEqual({ email: 'new@example.com', stepUpToken: 'email-proof' });
    expect(requests[7]?.body).toMatchObject({ stepUpToken: 'password-proof' });
  });

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

  it('认证端拒绝续期时通知应用回登录页，临时网络失败保留会话', async () => {
    const expired = vi.fn();
    const rejectedFetcher = vi.fn(async () => response({ error: '过期' }, 401));
    vi.stubGlobal('fetch', rejectedFetcher);
    const rejectedApi = createApi('http://test', expired);
    rejectedApi.session.setTokens({ token: 'old', refreshToken: 'refresh-old' });
    await rejectedApi.profile.get().catch(() => undefined);
    expect(rejectedApi.session.token).toBeUndefined();
    expect(expired).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const transientExpired = vi.fn();
    const transientApi = createApi('http://test', transientExpired);
    transientApi.session.setTokens({ token: 'old', refreshToken: 'refresh-old' });
    await transientApi.profile.get().catch(() => undefined);
    expect(transientApi.session.token).toBe('old');
    expect(transientExpired).not.toHaveBeenCalled();
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
