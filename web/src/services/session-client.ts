import type { HttpClient } from './http-client';

export interface SessionTokens { token: string; refreshToken?: string; }

export class SessionClient {
  private accessToken = '';
  private refreshToken = '';

  constructor(private readonly http: HttpClient) {}

  get token(): string | undefined { return this.accessToken || undefined; }
  get refreshTokenValue(): string | undefined { return this.refreshToken || undefined; }

  setTokens(tokens: SessionTokens): void {
    this.accessToken = tokens.token;
    this.refreshToken = tokens.refreshToken ?? '';
  }

  clear(): void {
    this.accessToken = '';
    this.refreshToken = '';
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const result = await this.http.request<SessionTokens>('/auth/refresh', {
        method: 'POST', body: { refreshToken: this.refreshToken },
      }, false);
      if (!result.token) return false;
      this.setTokens(result);
      return true;
    } catch {
      return false;
    }
  }
}
