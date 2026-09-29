/** 管理访问令牌生命周期，刷新令牌不扩散到页面层。 */
import { nativeBridge } from './native-bridge';
import type { HttpClient } from './http-client';

export interface SessionTokens { token: string; refreshToken?: string; }

/**
 * 会话令牌。
 *
 * 访问令牌只在内存（短命，且每次请求都要带），刷新令牌写入**设备私有存储**
 * （原生 `SessionStore`），这样冷启动不必重新登录；写失败不影响本次会话，
 * 只影响「下次还能不能免登录」，因此都吞掉错误。
 */
export class SessionClient {
  private accessToken = '';
  private refreshToken = '';
  private username = '';

  constructor(private readonly http: HttpClient) {}

  get token(): string | undefined { return this.accessToken || undefined; }
  get refreshTokenValue(): string | undefined { return this.refreshToken || undefined; }

  setTokens(tokens: SessionTokens, username = ''): void {
    this.accessToken = tokens.token;
    this.refreshToken = tokens.refreshToken ?? '';
    this.username = username || this.username;
    void this.persist();
  }

  clear(): void {
    this.accessToken = '';
    this.refreshToken = '';
    this.username = '';
    void this.forget();
  }

  /**
   * 冷启动恢复会话：设备里存着刷新令牌就换一张新的访问令牌。
   * 令牌过期或被撤销时返回 false（并顺手清掉，免得每次启动都白试一次）。
   */
  async restore(): Promise<boolean> {
    const stored = await this.load();
    if (!stored.refreshToken) return false;
    this.refreshToken = stored.refreshToken;
    this.username = stored.username;
    const renewed = await this.refresh();
    if (!renewed) this.clear();
    return renewed;
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const result = await this.http.request<SessionTokens>('/auth/refresh', {
        method: 'POST', body: { refreshToken: this.refreshToken },
      }, false);
      if (!result.token) return false;
      this.setTokens(result, this.username);
      return true;
    } catch {
      return false;
    }
  }

  private async load(): Promise<{ refreshToken: string; username: string }> {
    try {
      const stored = await nativeBridge.call('session.load', {});
      return {
        refreshToken: String(stored?.refreshToken ?? ''),
        username: String(stored?.username ?? ''),
      };
    } catch {
      // 浏览器里没有原生桥：按「没有会话」处理，登录页照常可用。
      return { refreshToken: '', username: '' };
    }
  }

  private async persist(): Promise<void> {
    try {
      await nativeBridge.call('session.save', { refreshToken: this.refreshToken, username: this.username });
    } catch {
      // 写不进去只影响免登录，不影响本次会话
    }
  }

  private async forget(): Promise<void> {
    try {
      await nativeBridge.call('session.clear', {});
    } catch {
      // 同上
    }
  }
}
