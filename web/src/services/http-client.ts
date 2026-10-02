import { t } from '@/i18n';
/**
 * 统一封装网络请求、超时、错误分类和访问令牌注入。
 *
 * 这一层只处理 HTTP 语义，不认业务：2xx 把响应体原样返回，任何失败都抛异常。
 *
 * **两类错误的边界**（页面据此决定文案与是否重试）：
 * - `ApiError` —— **业务失败**：4xx，或 HTTP 200 但响应体里 `ok === false`。请求确实到达了后端、
 *   规则也确实拒绝了，`message` 是可以直接展示给用户的中文；原样重发没有意义。
 * - `TransportError` —— **传输失败**：连不上、响应不是 JSON、5xx、超时。后端状态未知，
 *   `message` 是排障信息，页面应当给「稍后再试」，不要把它当成业务提示展示。
 *   5xx 归传输而不归业务，是因为它多半是后端或代理出问题，不是用户输入的问题。
 *
 * **401 只刷新一次**：收到 401 先刷新令牌，再重放**一次**原请求（`canRefresh` 置 false）。
 * 重放后仍是 401，就把 `ApiError(401)` 交给会话层 —— 刷新接口自己 401 时因此不会无限递归。
 * 并发的多个 401 共用 `refreshing` 同一个 Promise，所以一次会话只会发一次刷新请求。
 *
 * **超时与取消**：超时默认 3 秒，用 `AbortController` + `setTimeout` 实现；调用方传入的 `signal`
 * 与超时共用同一个 controller。两者都以 AbortError 结束，靠 `reason` 分开：
 * `'timeout'` 是自己掐的，`'aborted'` 是调用方取消的（页面切走、重新取数），文案不同也便于排障。
 *
 * 这里不做传输重试（只有 401 刷新后的那次重放）、不缓存、也不解析业务字段：
 * 缓存与失效在 `query-cache.ts` / `api/client.ts`，令牌的存取在 `session-client.ts`。
 */

/** 传输失败的两种可预期原因：自己掐的超时，与调用方取消。其余情况没有码。 */
export type TransportReason = 'timeout' | 'aborted';

/** 传输层失败：请求没得到可用响应，后端可能根本没收到。调用方按「可以重试」处理。 */
export class TransportError extends Error {
  override name = 'TransportError';
  /** 超时 / 取消这类**可预期**的原因；连不上、非 JSON、5xx 没有码。 */
  readonly reason?: TransportReason;

  constructor(message: string, reason?: TransportReason) {
    super(message);
    this.reason = reason;
  }
}

/**
 * 业务失败：后端明确拒绝了这次请求。
 * `status` 是 HTTP 状态码；注意 HTTP 200 + `ok:false` 也会走到这里，此时 `status` 是 200 ——
 * 判断失败类型要看异常类型，不能只看状态码。
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 单次请求的可选项。`query` 里值为 `undefined` / `null` / 空串的键会被丢掉，不会拼进 URL。 */
export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * `HttpClient` 的构造参数。
 * - `timeoutMs`：单次请求超时，缺省 3000 毫秒。
 * - `fetcher`：注入用（测试替身）；缺省时保存全局 fetch，注意构造函数里的 this 绑定说明。
 * - `getAccessToken`：每次请求前现取令牌；返回空就不发 Authorization 头，登录类接口依赖这一点。
 * - `refresh`：刷新令牌；返回 false 表示刷新失败，此时原始的 401 会作为 `ApiError` 抛给上层。
 */
export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  getAccessToken?: () => string | undefined;
  /** 身份切换会作废本次请求；续期不改变此信号。 */
  getSessionSignal?: () => AbortSignal;
  refresh?: () => Promise<boolean>;
}

/** 把查询参数拼成 `?a=1&b=2`；没有有效参数时返回空串（不留一个孤立的 `?`）。 */
function queryString(query: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * 带超时、令牌注入与单次刷新重试的 HTTP 客户端。
 * 一个实例对应一个后端基地址；请求之间除了共用的令牌刷新外不共享状态。
 */
export class HttpClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  // 正在进行的令牌刷新。并发的 401 复用它，避免同时打出多个刷新请求。
  private refreshing: { signal?: AbortSignal; promise: Promise<boolean> } | undefined;

  constructor(private readonly options: HttpClientOptions) {
    // WebView 对原生 fetch 的 this 绑定严格，保存函数后必须绑定全局对象再调用。
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    // 3 秒是移动网络下的折中：再短会把正常慢请求判死，再长页面就一直转圈。
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  /**
   * 发一次请求。
   *
   * @param path 以 `/` 开头的接口路径，拼在 `baseUrl` 之后。
   * @param request 请求方法、查询参数、请求体与可选中止信号。
   * @param canRefresh 内部参数：重放请求时置 false，保证 401 只刷新一次。
   * @returns 解析后的 JSON 响应体，按调用方声明的 `T` 直接返回（**不做运行时字段校验**）。
   * @throws {ApiError} 业务失败：4xx，或 200 + `ok:false`。
   * @throws {TransportError} 传输失败：连不上、响应不是 JSON、5xx 或超时。
   */
  async request<T>(path: string, request: HttpRequest = {}, canRefresh = true): Promise<T> {
    // 去掉 baseUrl 末尾的斜杠：调用方传不传都不该拼出 `//`。
    const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}${queryString(request.query)}`;
    const controller = new AbortController();
    const sessionSignal = this.options.getSessionSignal?.();
    // 超时即 abort，fetch 会以 AbortError 结束；reason 用来把它和「调用方取消」分开。
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    // 调用方取消也走同一个 controller，统一在 finally 里解绑。
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener('abort', abortFromCaller, { once: true });
    sessionSignal?.addEventListener('abort', abortFromCaller, { once: true });
    if (request.signal?.aborted || sessionSignal?.aborted) controller.abort();

    try {
      controller.signal.throwIfAborted();
      const token = this.options.getAccessToken?.();
      const response = await this.fetcher(url, {
        method: request.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          // 只有带请求体时才发 Content-Type：GET 带它没有意义，还可能触发多余的预检。
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          // 未登录干脆不发 Authorization，后端据此回 401，而不是把空令牌当成非法令牌。
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();

      if (response.status === 401 && canRefresh && this.options.refresh) {
        // 并发的 401 共用同一个刷新 Promise；刷新一结束就置空，否则下一次 401 会复用一个已结算的旧结果。
        if (!this.refreshing || this.refreshing.signal !== sessionSignal) {
          const current = {
            signal: sessionSignal,
            promise: this.options.refresh().finally(() => {
              if (this.refreshing === current) this.refreshing = undefined;
            }),
          };
          this.refreshing = current;
        }
        // 刷新成功才重放；canRefresh=false 保证重放后再 401 就直接抛给上层，不再刷新。
        const renewed = await this.refreshing.promise;
        controller.signal.throwIfAborted();
        if (renewed) return this.request<T>(path, request, false);
      }

      let data: unknown;
      try {
        // 先读响应体再判状态：错误响应也靠体里的 error 字段给文案。
        data = await response.json();
      } catch (error) {
        controller.signal.throwIfAborted();
        // 5xx 常返回网关的 HTML 错误页，解析失败同样属于传输失败。
        throw new TransportError(`响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
      }
      controller.signal.throwIfAborted();
      // 5xx 归传输失败：后端或代理异常，不是业务规则的判定结果。
      if (response.status >= 500) throw new TransportError(`后端返回 ${response.status}`);
      if (!response.ok) {
        // 4xx：优先用后端给的 error 文案，没有就退回状态码。
        const message = typeof data === 'object' && data !== null && 'error' in data
          ? String(data.error)
          : `请求失败（${response.status}）`;
        throw new ApiError(message, response.status);
      }
      // 200 + ok:false 是后端的规则失败约定，同样按业务失败抛出，不让页面去判 ok。
      if (typeof data === 'object' && data !== null && 'ok' in data && data.ok === false) {
        throw new ApiError('error' in data ? String(data.error) : t('s_ydow7a'), response.status);
      }
      // 响应体未做运行时校验：字段是否存在、类型对不对，由页面按可选类型自行兜底。
      return data as T;
    } catch (error) {
      if (error instanceof ApiError || error instanceof TransportError) throw error;
      if (controller.signal.aborted) {
        // 以本请求的信号判定来源，兼容 fetch 与页面来自不同 realm 的异常对象。
        // AbortError 只有两个来源：这里掐的超时，或者调用方传进来的 signal。
        // 调用方的 signal 上带 aborted 标记，据此分开报：文案是排障用的，不是给用户看的业务提示。
        if (request.signal?.aborted || sessionSignal?.aborted) throw new TransportError(t('s_1s8cf91'), 'aborted');
        throw new TransportError(`后端响应超时（超过 ${this.timeoutMs / 1000} 秒）`, 'timeout');
      }
      // 其余都是网络层的原生错误（DNS、证书、连接被拒等），后端状态未知。
      throw new TransportError(`连不上后端服务：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // 无论成败都要清定时器，否则每成功一次就多留一个待触发的 abort。
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abortFromCaller);
      sessionSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
