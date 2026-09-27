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
      baseUrl: 'http://test', getAccessToken: () => token,
      refresh: async () => { token = 'new'; return true; },
      fetcher: async (_url, init) => {
        calls += 1;
        return response(calls === 1 ? 401 : 200, { token: init?.headers && 'ok' });
      },
    });
    await client.request('/x');
    expect(calls).toBe(2);
  });
});
