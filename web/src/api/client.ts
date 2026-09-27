import { HttpClient } from '@/services/http-client';
import { QueryCache } from '@/services/query-cache';
import { SessionClient } from '@/services/session-client';
import type { ApiResult, AuthResult, Bootstrap, Exhibition, Id, JsonObject, Registration, User } from './types';

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`).join(',')}}`;
}

export interface ApiClient {
  session: SessionClient;
  bootstrap(): Promise<Bootstrap>;
  auth: {
    login(username: string, password: string): Promise<AuthResult>;
    loginVerify(payload: JsonObject): Promise<AuthResult>;
    register(payload: JsonObject): Promise<ApiResult>;
    registerVerify(payload: JsonObject): Promise<AuthResult>;
    forgotPassword(email: string): Promise<ApiResult>;
    resetPassword(payload: JsonObject): Promise<ApiResult>;
    guest(): Promise<AuthResult>;
    logout(): Promise<void>;
  };
  profile: {
    get(): Promise<JsonObject>;
    save(payload: JsonObject): Promise<ApiResult>;
    changePassword(payload: JsonObject): Promise<ApiResult>;
    notifications(): Promise<JsonObject>;
    saveNotifications(payload: JsonObject): Promise<ApiResult>;
  };
  exhibitions: {
    list(query?: JsonObject): Promise<Exhibition[]>;
    month(query: JsonObject): Promise<JsonObject>;
    get(id: Id): Promise<Exhibition>;
    save(payload: JsonObject): Promise<ApiResult>;
    remove(id: Id): Promise<ApiResult>;
    setStatus(id: Id, status: string): Promise<ApiResult>;
    categories(): Promise<unknown[]>;
    fields(id: Id): Promise<unknown[]>;
    saveFields(id: Id, fields: unknown[]): Promise<ApiResult>;
  };
  registrations: {
    list(): Promise<Registration[]>;
    get(id: Id): Promise<Registration>;
    submit(payload: JsonObject): Promise<ApiResult>;
    cancel(id: Id): Promise<ApiResult>;
  };
  review: {
    list(query?: JsonObject): Promise<Registration[]>;
    get(id: Id): Promise<Registration>;
    updateStatus(id: Id, status: string): Promise<ApiResult>;
  };
  checkIn(code: string): Promise<ApiResult>;
  users: {
    list(query?: JsonObject): Promise<User[]>;
    get(id: Id): Promise<User>;
    setStatus(id: Id, status: string): Promise<ApiResult>;
    disableTwoFactor(id: Id): Promise<ApiResult>;
    publicProfile(query: JsonObject): Promise<JsonObject>;
  };
  search(query: string): Promise<JsonObject>;
  settings: {
    get(): Promise<JsonObject>;
    save(payload: JsonObject): Promise<ApiResult>;
    saveUiMode(mode: string): Promise<ApiResult>;
  };
  clearCache(): void;
}

export function createApi(baseUrl = 'http://127.0.0.1:3000/api/v1'): ApiClient {
  let session!: SessionClient;
  const http = new HttpClient({ baseUrl, getAccessToken: () => session.token, refresh: () => session.refresh() });
  session = new SessionClient(http);
  const cache = new QueryCache();
  const read = <T>(key: string, path: string, request: Parameters<HttpClient['request']>[1] = {}) =>
    cache.get<T>(`${key}:${path}:${stableKey(request.query ?? {})}`, () => http.request<T>(path, request));
  const write = async <T>(path: string, request: Parameters<HttpClient['request']>[1], invalidates: string[] = []) => {
    const result = await http.request<T>(path, request);
    invalidates.forEach((prefix) => cache.invalidate(prefix));
    return result;
  };
  const afterAuth = (result: AuthResult): AuthResult => {
    if (result.token) session.setTokens({ token: result.token, refreshToken: result.refreshToken });
    cache.clear();
    return result;
  };

  return {
    session,
    bootstrap: () => http.request<Bootstrap>('/bootstrap'),
    auth: {
      login: async (username, password) => afterAuth(await http.request<AuthResult>('/auth/login', { method: 'POST', body: { username, password } })),
      loginVerify: async (payload) => afterAuth(await http.request<AuthResult>('/auth/login/verify', { method: 'POST', body: payload })),
      register: (payload) => http.request<ApiResult>('/auth/register', { method: 'POST', body: payload }),
      registerVerify: async (payload) => afterAuth(await http.request<AuthResult>('/auth/register/verify', { method: 'POST', body: payload })),
      forgotPassword: (email) => http.request<ApiResult>('/auth/password/forgot', { method: 'POST', body: { email } }),
      resetPassword: (payload) => http.request<ApiResult>('/auth/password/reset', { method: 'POST', body: payload }),
      guest: async () => afterAuth(await http.request<AuthResult>('/auth/guest', { method: 'POST' })),
      logout: async () => {
        try { await http.request('/auth/logout', { method: 'POST', body: { refreshToken: session.refreshTokenValue } }); } catch { /* best effort */ }
        session.clear();
        cache.clear();
      },
    },
    profile: {
      get: () => read<JsonObject>('profile', '/profile'),
      save: (payload) => write<ApiResult>('/profile', { method: 'PUT', body: payload }, ['profile', 'users.public']),
      changePassword: (payload) => http.request<ApiResult>('/profile/password', { method: 'POST', body: payload }),
      notifications: () => read<JsonObject>('notifications', '/profile/notifications'),
      saveNotifications: (payload) => write<ApiResult>('/profile/notifications', { method: 'PUT', body: payload }, ['notifications']),
    },
    exhibitions: {
      list: (query = {}) => read<Exhibition[]>('exhibitions.list', '/exhibitions', { query }),
      month: (query) => read<JsonObject>('exhibitions.month', '/exhibitions/month', { query }),
      get: (id) => read<Exhibition>('exhibitions.get', `/exhibitions/${encodeURIComponent(id)}`),
      save: (payload) => write<ApiResult>(payload.id ? `/exhibitions/${encodeURIComponent(String(payload.id))}` : '/exhibitions', { method: payload.id ? 'PUT' : 'POST', body: payload }, ['exhibitions', 'search']),
      remove: (id) => write<ApiResult>(`/exhibitions/${encodeURIComponent(id)}`, { method: 'DELETE' }, ['exhibitions', 'registrations', 'review', 'search']),
      setStatus: (id, status) => write<ApiResult>(`/exhibitions/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { id, status } }, ['exhibitions', 'registrations', 'review', 'search']),
      categories: () => read<unknown[]>('categories', '/exhibitions/categories'),
      fields: (id) => read<unknown[]>('fields', `/exhibitions/${encodeURIComponent(id)}/fields`),
      saveFields: (id, fields) => write<ApiResult>(`/exhibitions/${encodeURIComponent(id)}/fields`, { method: 'PUT', body: { id, fields } }, ['fields']),
    },
    registrations: {
      list: () => read<Registration[]>('registrations', '/registrations'),
      get: (id) => read<Registration>('registration', `/registrations/${encodeURIComponent(id)}`),
      submit: (payload) => write<ApiResult>('/registrations', { method: 'POST', body: payload }, ['registrations', 'review', 'exhibitions']),
      cancel: (id) => write<ApiResult>(`/registrations/${encodeURIComponent(id)}`, { method: 'DELETE' }, ['registrations', 'review', 'exhibitions']),
    },
    review: {
      list: (query = {}) => read<Registration[]>('review', '/review', { query }),
      get: (id) => read<Registration>('review.record', `/review/${encodeURIComponent(id)}`),
      updateStatus: (id, status) => write<ApiResult>(`/review/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { id, status } }, ['review', 'registrations', 'users.public']),
    },
    checkIn: (code) => write<ApiResult>('/checkin', { method: 'POST', body: { code } }, ['review', 'registrations', 'users.public']),
    users: {
      list: (query = {}) => read<User[]>('users', '/users', { query }),
      get: (id) => read<User>('user', `/users/${encodeURIComponent(id)}`),
      setStatus: (id, status) => write<ApiResult>(`/users/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { id, status } }, ['users']),
      disableTwoFactor: (id) => write<ApiResult>(`/users/${encodeURIComponent(id)}/two-factor`, { method: 'PUT', body: { id, enabled: false } }, ['users']),
      publicProfile: (query) => read<JsonObject>('users.public', '/users/public', { query }),
    },
    search: (query) => read<JsonObject>('search', '/search', { query: { query } }),
    settings: {
      get: () => read<JsonObject>('settings', '/settings'),
      save: (payload) => write<ApiResult>('/settings', { method: 'PUT', body: payload }, ['settings', 'categories']),
      saveUiMode: (mode) => write<ApiResult>('/settings/ui-mode', { method: 'PUT', body: { mode } }, ['settings']),
    },
    clearCache: () => cache.clear(),
  };
}
