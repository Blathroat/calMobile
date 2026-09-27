import { HttpClient } from '@/services/http-client';
import { QueryCache } from '@/services/query-cache';
import { SessionClient } from '@/services/session-client';

export interface Bootstrap { user?: Record<string, unknown>; [key: string]: unknown; }
export interface Exhibition { id: string; title: string; [key: string]: unknown; }

export function createApi(baseUrl = 'http://127.0.0.1:3000/api/v1') {
  let session!: SessionClient;
  const http = new HttpClient({
    baseUrl,
    getAccessToken: () => session.token,
    refresh: () => session.refresh(),
  });
  session = new SessionClient(http);
  const cache = new QueryCache();
  return {
    session,
    bootstrap: () => http.request<Bootstrap>('/bootstrap'),
    auth: {
      login: async (username: string, password: string) => {
        const result = await http.request<{ token?: string; refreshToken?: string }>('/auth/login', {
          method: 'POST', body: { username, password },
        });
        if (result.token) session.setTokens({ token: result.token, refreshToken: result.refreshToken });
        cache.invalidate();
        return result;
      },
      logout: async () => {
        try { await http.request('/auth/logout', { method: 'POST', body: { refreshToken: session.refreshTokenValue } }); } catch { /* logout is best effort */ }
        session.clear();
        cache.invalidate();
      },
    },
    exhibitions: {
      list: (query: Record<string, unknown> = {}) => cache.get(`exhibitions.list:${JSON.stringify(query)}`, () => http.request<Exhibition[]>('/exhibitions', { query })),
    },
  };
}
