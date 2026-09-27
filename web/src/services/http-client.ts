/** 统一封装网络请求、超时、错误分类和访问令牌注入。 */
export class TransportError extends Error {
  override name = 'TransportError';
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  getAccessToken?: () => string | undefined;
  refresh?: () => Promise<boolean>;
}

function queryString(query: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export class HttpClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private refreshing: Promise<boolean> | undefined;

  constructor(private readonly options: HttpClientOptions) {
    // WebView 对原生 fetch 的 this 绑定严格，保存函数后必须绑定全局对象再调用。
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async request<T>(path: string, request: HttpRequest = {}, canRefresh = true): Promise<T> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}${queryString(request.query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const token = this.options.getAccessToken?.();
      const response = await this.fetcher(url, {
        method: request.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });

      if (response.status === 401 && canRefresh && this.options.refresh) {
        this.refreshing ??= this.options.refresh().finally(() => { this.refreshing = undefined; });
        if (await this.refreshing) return this.request<T>(path, request, false);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        throw new TransportError(`响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
      }
      if (response.status >= 500) throw new TransportError(`后端返回 ${response.status}`);
      if (!response.ok) {
        const message = typeof data === 'object' && data !== null && 'error' in data
          ? String(data.error)
          : `请求失败（${response.status}）`;
        throw new ApiError(message, response.status);
      }
      if (typeof data === 'object' && data !== null && 'ok' in data && data.ok === false) {
        throw new ApiError('error' in data ? String(data.error) : '操作失败', response.status);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError || error instanceof TransportError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new TransportError(`后端响应超时（超过 ${this.timeoutMs / 1000} 秒）`);
      }
      throw new TransportError(`连不上后端服务：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
