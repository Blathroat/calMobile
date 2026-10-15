import { describe, expect, it } from 'vitest';
import { ApiError, HttpClient, TransportError } from './http-client';

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('HttpClient', () => {
  it('classifies business and transport failures', async () => {
    const business = new HttpClient({ baseUrl: 'http://test', fetcher: async () => response(403, { error: '无权' }) });
    await expect(business.request('/x')).rejects.toBeInstanceOf(ApiError);
    const transport = new HttpClient({ baseUrl: 'http://test', fetcher: async () => response(502, {}) });
    await expect(transport.request('/x')).rejects.toBeInstanceOf(TransportError);
  });

  it('refreshes once and retries with the new token', async () => {
    let token = 'old';
    let calls = 0;
    const client = new HttpClient({
      baseUrl: 'http://test',
      getAccessToken: () => token,
      refresh: async () => {
        token = 'new';
        return true;
      },
      fetcher: async (_url, init) => {
        calls += 1;
        return response(calls === 1 ? 401 : 200, { token: init?.headers && 'ok' });
      },
    });
    await client.request('/x');
    expect(calls).toBe(2);
  });

  it('超时与调用方取消分开报：reason 分别是 timeout / aborted', async () => {
    /** 永远不回的假请求：只有 abort 时才会 reject。 */
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });

    // 超时自己触发（超时设 10ms）
    const timeoutClient = new HttpClient({ baseUrl: 'http://test', timeoutMs: 10, fetcher: hanging as typeof fetch });
    await expect(timeoutClient.request('/x')).rejects.toMatchObject({ name: 'TransportError', reason: 'timeout' });

    // 调用方主动取消（超时给足，不会先触发）
    const abortable = new HttpClient({ baseUrl: 'http://test', timeoutMs: 5_000, fetcher: hanging as typeof fetch });
    const controller = new AbortController();
    const pending = abortable.request('/x', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'TransportError', reason: 'aborted' });
  });
});
