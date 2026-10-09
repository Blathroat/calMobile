/** 管理访问令牌生命周期，刷新令牌不扩散到页面层。 */
import { nativeBridge } from './native-bridge';
import { ApiError, type HttpClient } from './http-client';

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
  private stableDeviceToken = '';
  private lifetime = new AbortController();

  constructor(private readonly http: HttpClient, private readonly onExpired?: () => void) {}

  get token(): string | undefined { return this.accessToken || undefined; }
  get refreshTokenValue(): string | undefined { return this.refreshToken || undefined; }
  /** 身份变化时取消；普通令牌续期仍属于同一会话。 */
  get signal(): AbortSignal { return this.lifetime.signal; }

  /** 同一安装始终用同一个随机凭据，让后端识别已记住的设备。 */
  async deviceToken(): Promise<string> {
    if (this.stableDeviceToken) return this.stableDeviceToken;
    try {
      const native = await nativeBridge.call('session.device', {});
      const token = String(native?.deviceToken ?? '').trim();
      if (token) {
        this.stableDeviceToken = token;
        return token;
      }
    } catch {
      // 浏览器预览与旧版原生容器改用本机存储；它不影响普通登录。
    }
    try {
      const saved = window.localStorage.getItem('calmobile.device-token') || '';
      if (saved) {
        this.stableDeviceToken = saved;
        return saved;
      }
      const bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      const generated = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem('calmobile.device-token', generated);
      this.stableDeviceToken = generated;
      return generated;
    } catch {
      // 隐私模式禁用本机存储时不发送设备凭据，登录仍可用，但无法记住设备。
      return '';
    }
  }

  setTokens(tokens: SessionTokens, username = ''): void {
    this.replaceLifetime();
    this.acceptTokens(tokens, username);
  }

  private acceptTokens(tokens: SessionTokens, username: string): void {
    this.accessToken = tokens.token;
    this.refreshToken = tokens.refreshToken ?? '';
    this.username = username;
    void this.persist();
  }

  clear(): void {
    this.replaceLifetime();
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
    const signal = this.signal;
    const stored = await this.load();
    if (signal.aborted || !stored.refreshToken) return false;
    this.refreshToken = stored.refreshToken;
    this.username = stored.username;
    const renewed = await this.refresh();
    if (!renewed && !signal.aborted) this.clear();
    return renewed;
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) {
      // 收到受保护接口的 401 后没有可用刷新令牌，当前访问令牌也已被拒绝。
      if (this.accessToken) this.expire();
      return false;
    }
    const signal = this.signal;
    try {
      const result = await this.http.request<SessionTokens>('/auth/refresh', {
        method: 'POST', body: { refreshToken: this.refreshToken },
      }, false);
      if (signal.aborted) return false;
      if (!result.token) {
        this.expire();
        return false;
      }
      this.acceptTokens(result, this.username);
      return true;
    } catch (error) {
      // 网络暂不可用仍可重试；后端明确拒绝刷新才结束当前会话。
      if (!signal.aborted && error instanceof ApiError && (error.status === 401 || error.status === 403)) this.expire();
      return false;
    }
  }

  /** 认证端明确拒绝续期时清令牌，并通知应用清状态与回到登录页。 */
  private expire(): void {
    this.clear();
    this.onExpired?.();
  }

  private replaceLifetime(): void {
    this.lifetime.abort();
    this.lifetime = new AbortController();
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
