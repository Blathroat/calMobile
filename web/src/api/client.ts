/**
 * 业务 API 的唯一入口，页面不直接拼接 URL 或处理令牌：页面与 feature composable 只从这里取数据。
 *
 * **职责与边界**：页面不自己 `fetch`、不自己存令牌、也不做本地缓存或本地降级。这三件事分别在
 * `services/http-client.ts`（HTTP 与错误分类）、`services/session-client.ts`（令牌）、
 * `services/query-cache.ts`（缓存）里，本文件只负责「把路径、缓存键、失效前缀绑在一起」。
 * 注意这里失败时只抛 `ApiError` / `TransportError`，不生成任何提示文案，
 * 「失败必须可见」由调用它的页面或 composable 负责。
 *
 * **读接口走缓存，写接口负责失效**：
 * - 读接口经 `read()`，缓存键是 `前缀:路径:稳定参数`。参数先用 `stableKey` 按键名排序再拼，
 *   否则同一次查询只因对象字面量顺序不同就会算出两个键，缓存形同虚设。
 * - 写接口经 `write()`，**只有请求成功后**才执行失效：失败时不清缓存 —— 旧数据虽然旧，
 *   但比什么都没有强，何况清掉也拿不到新数据。少数「写但不需要失效」的调用（改密码、
 *   两步验证、重发验证码）直连 `http.request`，原因写在各自的方法注释里。
 * - 失效是按前缀匹配的，所以写接口的失效前缀必须与读接口的键前缀**同族**：
 *   `registrations` ↔ `registrations.record`。写成 `registration` 就永远命不中，
 *   改完再读会拿到旧值（下面的 `registrations.get` / `users.get` 就是在提醒这件事）。
 * - 这里不做乐观更新，也不把写结果回填缓存：写完统一失效，交给下一次读重新取。
 *
 * **成功即成功**：写接口返回 `ok:false` 的规则失败已经被 `HttpClient` 抛成 `ApiError`，
 * 所以 `await` 没抛异常就可以当成成功，页面不需要再判 `result.ok`。
 *
 * **刻意不缓存的两类**：`bootstrap`（它是「当前是谁」的来源，缓存会串身份）与 `security.*`
 * （两步验证、备用码这类一次性凭据，缓存既没用又危险）。
 *
 * **身份变化必须清空缓存**：`afterAuth` 与 `logout` 都调用 `cache.clear()`；换账号后上一个用户的
 * 数据不能再被任何键命中。
 */
import { HttpClient } from '@/services/http-client';
import { QueryCache } from '@/services/query-cache';
import { SessionClient } from '@/services/session-client';
import { nativeBridge } from '@/services/native-bridge';
import type { ApiResult, AuthResult, Bootstrap, Exhibition, ExhibitionDetail, Id, JsonObject, Registration, RegistrationDetail, ReviewList, SearchResult, User } from './types';

/**
 * 稳定序列化：对象键排序后递归拼接，保证同样内容得到同样的字符串，用作缓存键的一部分。
 * 键顺序不稳（比如不同的构造路径）会让同一个查询产生两个缓存键。
 */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`).join(',')}}`;
}

/**
 * 业务接口集合。
 *
 * 读方法的结果进查询缓存，写方法成功之后按前缀失效缓存；`session` 与 `clearCache` 是本地状态，
 * 不发请求。失败一律抛 `ApiError`（业务失败）或 `TransportError`（传输失败），
 * 详见 `services/http-client.ts`。
 */
export interface ApiClient {
  /** 令牌生命周期。页面只读 `token` / `refreshTokenValue`，刷新由 http 层按需触发。 */
  session: SessionClient;
  /** 启动数据（身份、权限、限制、主题）。刻意不走缓存：切账号后必须拿最新的一份。 */
  bootstrap(): Promise<Bootstrap>;
  /** 登录、注册、找回密码。只有会下发令牌的方法内部才更新会话并清空缓存。 */
  auth: {
    /** 账号密码登录。返回体带令牌即登录成功；也可能是「还需要两步验证」的中间结果（无令牌）。 */
    login(username: string, password: string): Promise<AuthResult>;
    /** 登录的两步验证第二步：`payload` 原样透传，验证码或备用码由页面组装。 */
    loginVerify(payload: JsonObject): Promise<AuthResult>;
    /**
     * 两步验证流程里重发登录验证码（`ticket` 是登录票据，不是令牌）。
     * 返回体带 `resendAfterSec` / `emailSent` 供页面做倒计时，**不发令牌**，所以不走 afterAuth。
     */
    loginCode(ticket: string): Promise<ApiResult>;
    /** 提交注册申请。此时还没有令牌，注册验证通过后才发放。 */
    register(payload: JsonObject): Promise<ApiResult>;
    /** 注册的邮箱验证码确认，成功后发放令牌并清空缓存。 */
    registerVerify(payload: JsonObject): Promise<AuthResult>;
    /** 发送重置密码邮件。邮箱是否注册过都返回成功，避免暴露账号是否存在。 */
    forgotPassword(email: string): Promise<ApiResult>;
    /** 用邮件里的凭据设置新密码。 */
    resetPassword(payload: JsonObject): Promise<ApiResult>;
    /** 访客入口：清掉既有会话，返回后端下发的匿名身份。 */
    guest(): Promise<AuthResult>;
    /** 退出：立即清会话与缓存，再尽力通知后端吊销原刷新令牌。 */
    logout(): Promise<void>;
  };
  /** 个人资料与通知偏好。 `publicProfile` 展示的是 `save` 改过的同一份数据。 */
  profile: {
    /** 当前用户资料。 */
    get(): Promise<JsonObject>;
    /** 保存资料；会同时失效 `profile` 与 `users.public`（资料会出现在公开主页）。 */
    save(payload: JsonObject): Promise<ApiResult>;
    /** 已通过用途受限的身份复核票后修改密码；成功后服务端撤销全部会话。 */
    changePassword(payload: JsonObject): Promise<ApiResult>;
    /** 通知偏好。 */
    notifications(): Promise<JsonObject>;
    /** 保存通知偏好。 */
    saveNotifications(payload: JsonObject): Promise<ApiResult>;
    /**
     * 记下一条「已看过的一次性提示」。
     * 与账号绑定（`users.seen_hints`），换设备仍是已读；幂等，重复提交同一条不报错。
     */
    markHint(hint: string): Promise<JsonObject>;
  };
  /** 安全设置：两步验证与邮箱变更。全部不走缓存（一次性凭据多，缓存无益且有风险）。 */
  security: {
    /** 安全设置概览：两步验证开关、当前邮箱、是否已绑定验证器。 */
    get(): Promise<JsonObject>;
    /** 开启邮箱两步验证第一步：当前身份复核通过后，下发验证码。 */
    enableTwoFactor(stepUpToken: string): Promise<JsonObject>;
    /** 开启两步验证第二步：校验验证码，通过后才真正生效。 */
    verifyTwoFactor(code: string): Promise<JsonObject>;
    /** 向当前邮箱发送一次身份复核码。 */
    identityEmailCode(): Promise<JsonObject>;
    /** 用 TOTP 或邮箱码换取限定操作、五分钟有效的一次性身份复核票。 */
    verifyIdentity(method: 'email' | 'totp', code: string, scope: 'password' | 'email' | 'totp' | 'factor'): Promise<JsonObject>;
    /** 关闭两步验证需要先通过身份复核。 */
    disableTwoFactor(stepUpToken: string): Promise<JsonObject>;
    /** 更换邮箱第一步：给新地址发验证码，此时还没真正更换。 */
    changeEmail(email: string, stepUpToken: string): Promise<JsonObject>;
    /** 更换邮箱第二步：验证新地址；成功后失效 `profile`（用户名/邮箱展示会变）。 */
    verifyEmail(email: string, code: string): Promise<JsonObject>;
    /** 生成 TOTP（验证器应用）绑定用的密钥与二维码地址。 */
    totpSetup(stepUpToken: string): Promise<JsonObject>;
    /** 重新开启保留的验证器密钥，不重新绑定。 */
    activateTotp(): Promise<JsonObject>;
    /** 用验证器当前动态码和一次性身份复核票确认绑定。 */
    totpEnable(code: string, stepUpToken: string): Promise<JsonObject>;
    /** 用密码换取一批备用码；返回即展示，之后不再能取回，页面要提示用户自行保存。 */
    backupCodes(password: string): Promise<JsonObject>;
    /** 当前账号的活动设备；id 是撤销用的不可逆标识，不是设备凭据。 */
    sessions(): Promise<JsonObject>;
    /** 下线指定设备及其活动会话。 */
    revokeSession(deviceId: string): Promise<ApiResult>;
    /** 下线全部设备并清除可信设备记录。 */
    revokeAllSessions(): Promise<ApiResult>;
  };
  /** 展会：列表、月历、详情与管理端编辑。写操作会连带失效报名、审核与搜索。 */
  exhibitions: {
    /** 展会列表；`query` 参与缓存键，筛选条件不同就是不同的缓存。 */
    list(query?: JsonObject): Promise<Exhibition[]>;
    /** 月历数据（按年月聚合）。首页与左右滑动切月要用同一套参数才命中缓存。 */
    month(query: JsonObject): Promise<JsonObject>;
    /** 单个展会详情；查不到时返回 `found:false` 的成功响应，不是 404。 */
    get(id: Id): Promise<ExhibitionDetail>;
    /** 新建或更新：带 `payload.id` 走 PUT，否则 POST —— 页面不用自己区分这两个接口。 */
    save(payload: JsonObject): Promise<ApiResult>;
    /** 删除展会。连带失效报名、审核与搜索：这些数据都引用展会。 */
    remove(id: Id): Promise<ApiResult>;
    /** 改上下架/审核状态；同样连带失效报名与审核列表。 */
    setStatus(id: Id, status: string): Promise<ApiResult>;
    /** 展会分类选项（管理端与筛选共用），键前缀是 `categories`。 */
    categories(): Promise<unknown[]>;
    /** 某个展会的自定义报名字段定义。 */
    fields(id: Id): Promise<unknown[]>;
    /** 保存自定义字段定义；只失效 `fields`，不动展会本体。 */
    saveFields(id: Id, fields: unknown[]): Promise<ApiResult>;
  };
  /** 报名：我的报名列表、详情，以及提交/撤销。 */
  registrations: {
    /** 当前用户的报名列表。 */
    list(): Promise<Registration[]>;
    // 缓存键前缀必须与写接口的 invalidates 前缀同一族：撤销报名失效的是
    // `registrations`，键写成 `registration` 会匹配不上，撤销后再取详情会拿到旧状态。
    /** 报名详情。键是 `registrations.record`，必须落在 `registrations` 前缀下，否则撤销后读到旧值。 */
    get(id: Id): Promise<RegistrationDetail>;
    /** 提交报名；成功后连带失效审核与展会（名额、统计会变）。 */
    submit(payload: JsonObject): Promise<ApiResult>;
    /** 撤销报名；同样连带失效审核与展会。 */
    cancel(id: Id): Promise<ApiResult>;
  };
  /** 审核：管理端按状态查看报名并改状态。 */
  review: {
    /** 一次返回记录与各状态数量（对象，不是数组；见 server/src/routes/review-hono.ts）。 */
    list(query?: JsonObject): Promise<ReviewList>;
    /** 单条报名详情。键是 `review.record`，落在 `review` 前缀下。 */
    get(id: Id): Promise<Registration>;
    /** 审核通过/驳回；连带失效报名与 `users.public`（用户公开主页会显示审核结果）。 */
    updateStatus(id: Id, status: string): Promise<ApiResult>;
  };
  /** 现场核销：用核销码改报名状态。属于写操作，连带失效审核与用户公开资料。 */
  checkIn(code: string): Promise<ApiResult>;
  /** 用户管理（管理员）。 */
  users: {
    /** 用户列表；`query` 参与缓存键。 */
    list(query?: JsonObject): Promise<User[]>;
    // 同上：写接口失效的是 `users`，键也要落在同一个前缀下。
    /** 用户详情。键是 `users.record`，必须落在 `users` 前缀下。 */
    get(id: Id): Promise<User>;
    /** 启用/封禁；失效整个 `users` 前缀（列表与详情同族）。 */
    setStatus(id: Id, status: string): Promise<ApiResult>;
    /** 管理员强制关闭某个用户的两步验证（账号找回用）。 */
    disableTwoFactor(id: Id): Promise<ApiResult>;
    /** 公开主页数据：按用户名/ID 查对外可见的信息。 */
    publicProfile(query: JsonObject): Promise<JsonObject>;
  };
  /** 全局搜索：一次返回展会与用户两组结果（对象，不是数组）。 */
  search(query: string): Promise<SearchResult>;
  /** 系统设置（管理员）：全局限制、分类与默认主题。 */
  settings: {
    /** 读取系统设置。 */
    get(): Promise<JsonObject>;
    /** 保存系统设置；分类可能一起被改，所以同时失效 `categories`。 */
    save(payload: JsonObject): Promise<ApiResult>;
    /** 保存本人的明暗模式偏好（按账号存在 `users.ui_mode`）。 */
    saveUiMode(mode: string): Promise<ApiResult>;
    /** 保存本人的强调色：写调用者自己的 `users.ui_theme`，不动全局默认色板。 */
    saveUiTheme(themeIndex: number): Promise<ApiResult>;
  };
  /** 清空整个查询缓存。身份变化时由 `afterAuth` / `logout` 调用，页面通常不需要自己调。 */
  clearCache(): void;
}

/**
 * 创建 API 实例：把缓存、令牌与 HTTP 三层装配起来，返回页面唯一的数据入口。
 *
 * @param baseUrl 后端基地址。结尾带不带 `/` 都可以（`HttpClient` 会去掉重复的斜杠）。
 * @returns 绑定了独立缓存与令牌状态的 `ApiClient`。实例内部持有缓存，因此全应用只应创建一次
 *   （见 `app/runtime.ts`），多处创建会让缓存与失效各管一半。
 */
export function createApi(
  baseUrl = 'http://127.0.0.1:3000/api/v1',
  onSessionExpired?: () => void,
): ApiClient {
  // 先声明后用：HttpClient 的取令牌与刷新回调都引用 session，构造顺序上只能这样解环。
  let session!: SessionClient;
  let cache!: QueryCache;
  const notifySessionExpired = () => {
    cache.clear();
    onSessionExpired?.();
  };
  const expireSession = () => {
    session.clear();
    notifySessionExpired();
  };
  const http = new HttpClient({
    baseUrl, getAccessToken: () => session.token, getSessionSignal: () => session.signal,
    refresh: () => session.refresh(),
    onSessionExpired: expireSession,
  });
  session = new SessionClient(http, notifySessionExpired);
  cache = new QueryCache();
  let cacheSession = session.signal;
  // 读：键统一拼成 前缀:路径:参数，前缀就是写接口失效时用的那个前缀。
  const read = <T>(key: string, path: string, request: Parameters<HttpClient['request']>[1] = {}) => {
    // 刷新凭据被撤销也会结束会话，不能只有显式登录/退出才清缓存。
    if (cacheSession !== session.signal) {
      cache.clear();
      cacheSession = session.signal;
    }
    return cache.get<T>(`${key}:${path}:${stableKey(request.query ?? {})}`, () => http.request<T>(path, request));
  };
  // 写：只有请求成功后才失效。失败时保留旧缓存 —— 清掉也拿不到新数据，只会白丢可用的值。
  const write = async <T>(path: string, request: Parameters<HttpClient['request']>[1], invalidates: string[] = []) => {
    const result = await http.request<T>(path, request);
    invalidates.forEach((prefix) => cache.invalidate(prefix));
    return result;
  };
  const afterAuth = (result: AuthResult): AuthResult => {
    // 只有真带回令牌才更新会话：两步验证中间结果的 token 是空的，那时还不能算登录。
    if (result.token) {
      const user = (result.user ?? {}) as JsonObject;
      session.setTokens(
        { token: result.token, refreshToken: result.refreshToken },
        String(user.username ?? ''),
      );
    }
    // 无论有没有令牌都清缓存：身份可能已经变了，任何键都可能属于上一个用户。
    cache.clear();
    return result;
  };
  const devicePayload = async (): Promise<JsonObject> => {
    let userAgent = '';
    try { userAgent = navigator.userAgent; } catch { /* SSR 与测试环境使用默认名称 */ }
    const deviceName = nativeBridge.hasNative()
      ? 'Android App'
      : /iPhone|iPad/i.test(userAgent) ? 'iPhone / iPad'
        : /Android/i.test(userAgent) ? 'Android Browser'
          : /Windows/i.test(userAgent) ? 'Windows Browser'
            : /Mac OS/i.test(userAgent) ? 'Mac Browser'
              : /Linux/i.test(userAgent) ? 'Linux Browser' : 'Browser';
    return { deviceToken: await session.deviceToken(), deviceName };
  };

  return {
    session,
    // 不走 read()：身份来源必须是最新的，不能命中缓存。
    bootstrap: () => http.request<Bootstrap>('/bootstrap'),
    auth: {
      login: async (username, password) => afterAuth(await http.request<AuthResult>('/auth/login', {
        method: 'POST', body: { username, password, ...await devicePayload() },
      })),
      loginVerify: async (payload) => afterAuth(await http.request<AuthResult>('/auth/login/verify', {
        method: 'POST', body: { ...payload, ...await devicePayload() },
      })),
      loginCode: (ticket) => http.request<ApiResult>('/auth/login/code', { method: 'POST', body: { ticket } }),
      register: (payload) => http.request<ApiResult>('/auth/register', { method: 'POST', body: payload }),
      registerVerify: async (payload) => afterAuth(await http.request<AuthResult>('/auth/register/verify', {
        method: 'POST', body: { ...payload, ...await devicePayload() },
      })),
      forgotPassword: (email) => http.request<ApiResult>('/auth/password/forgot', { method: 'POST', body: { email } }),
      resetPassword: (payload) => http.request<ApiResult>('/auth/password/reset', { method: 'POST', body: payload }),
      guest: async () => {
        const result = await http.request<AuthResult>('/auth/guest', { method: 'POST' });
        session.clear();
        cache.clear();
        return result;
      },
      logout: async () => {
        const refreshToken = session.refreshTokenValue;
        session.clear();
        cache.clear();
        // 吊销只用原刷新令牌；绝不能续期或等网络回包后才结束本地会话。
        void http.request('/auth/logout', { method: 'POST', body: { refreshToken } }, false).catch(() => undefined);
      },
    },
    profile: {
      get: () => read<JsonObject>('profile', '/profile'),
      save: (payload) => write<ApiResult>('/profile', { method: 'PUT', body: payload }, ['profile', 'users.public']),
      changePassword: (payload) => http.request<ApiResult>('/profile/password', { method: 'POST', body: payload }),
      notifications: () => read<JsonObject>('notifications', '/profile/notifications'),
      saveNotifications: (payload) => write<ApiResult>('/profile/notifications', { method: 'PUT', body: payload }, ['notifications']),
      // 提示状态只进用户态（bootstrap 的 user 段），没有对应的读缓存需要失效。
      markHint: (hint) => http.request<JsonObject>('/profile/hints', { method: 'PUT', body: { hint } }),
    },
    security: {
      // 安全相关全部直连 http：验证码与备用码是一次性的，进缓存既没用也危险。
      get: () => http.request<JsonObject>('/profile/security'),
      identityEmailCode: () => http.request<JsonObject>('/profile/security/email-code', { method: 'POST' }),
      verifyIdentity: (method, code, scope) => http.request<JsonObject>('/profile/security/verify', {
        method: 'POST', body: { method, code, scope },
      }),
      enableTwoFactor: (stepUpToken) => http.request<JsonObject>('/profile/2fa/enable', { method: 'POST', body: { stepUpToken } }),
      verifyTwoFactor: (code) => http.request<JsonObject>('/profile/2fa/enable/verify', { method: 'POST', body: { code } }),
      disableTwoFactor: (stepUpToken) => http.request<JsonObject>('/profile/2fa/disable', { method: 'POST', body: { stepUpToken } }),
      changeEmail: (email, stepUpToken) => http.request<JsonObject>('/profile/email', { method: 'POST', body: { email, stepUpToken } }),
      verifyEmail: (email, code) => write<JsonObject>('/profile/email/verify', { method: 'POST', body: { email, code } }, ['profile']),
      totpSetup: (stepUpToken) => http.request<JsonObject>('/profile/2fa/totp/setup', { method: 'POST', body: { stepUpToken } }),
      activateTotp: () => http.request<JsonObject>('/profile/2fa/totp/activate', { method: 'POST' }),
      totpEnable: (code, stepUpToken) => http.request<JsonObject>('/profile/2fa/totp/enable', { method: 'POST', body: { code, stepUpToken } }),
      backupCodes: (password) => http.request<JsonObject>('/profile/2fa/backup-codes', { method: 'POST', body: { password } }),
      sessions: () => http.request<JsonObject>('/profile/sessions'),
      revokeSession: (deviceId) => write<ApiResult>(`/profile/sessions/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),
      revokeAllSessions: () => write<ApiResult>('/profile/sessions/revoke-all', { method: 'POST' }),
    },
    exhibitions: {
      list: (query = {}) => read<Exhibition[]>('exhibitions.list', '/exhibitions', { query }),
      month: (query) => read<JsonObject>('exhibitions.month', '/exhibitions/month', { query }),
      // 键的前缀是 `exhibitions`，因此展会写操作失效 `exhibitions` 时详情也一起作废。
      get: (id) => read<ExhibitionDetail>('exhibitions.get', `/exhibitions/${encodeURIComponent(id)}`),
      // 有 id 就是更新、没有就是新建；失效 `search` 是因为展会标题/日期会出现在搜索结果里。
      save: (payload) => write<ApiResult>(payload.id ? `/exhibitions/${encodeURIComponent(String(payload.id))}` : '/exhibitions', { method: payload.id ? 'PUT' : 'POST', body: payload }, ['exhibitions', 'search']),
      // 删展会会连带影响报名与审核记录，所以四个前缀都要失效。
      remove: (id) => write<ApiResult>(`/exhibitions/${encodeURIComponent(id)}`, { method: 'DELETE' }, ['exhibitions', 'registrations', 'review', 'search']),
      setStatus: (id, status) => write<ApiResult>(`/exhibitions/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { id, status } }, ['exhibitions', 'registrations', 'review', 'search']),
      categories: () => read<unknown[]>('categories', '/exhibitions/categories'),
      // 字段定义按展会分，键里带上 id 才能区分不同展会；失效前缀是 `fields`。
      fields: (id) => read<unknown[]>('fields', `/exhibitions/${encodeURIComponent(id)}/fields`),
      saveFields: (id, fields) => write<ApiResult>(`/exhibitions/${encodeURIComponent(id)}/fields`, { method: 'PUT', body: { id, fields } }, ['fields']),
    },
    registrations: {
      list: () => read<Registration[]>('registrations', '/registrations'),
      // 缓存键前缀必须与写接口的 invalidates 前缀同一族：撤销报名失效的是
      // `registrations`，键写成 `registration` 会匹配不上，撤销后再取详情会拿到旧状态。
      get: (id) => read<RegistrationDetail>('registrations.record', `/registrations/${encodeURIComponent(id)}`),
      submit: (payload) => write<ApiResult>('/registrations', { method: 'POST', body: payload }, ['registrations', 'review', 'exhibitions']),
      cancel: (id) => write<ApiResult>(`/registrations/${encodeURIComponent(id)}`, { method: 'DELETE' }, ['registrations', 'review', 'exhibitions']),
    },
    review: {
      // `/review` 一次返回记录与各状态数量（见 server/src/routes/review-hono.ts），不是数组。
      list: (query = {}) => read<ReviewList>('review', '/review', { query }),
      // 键 `review.record` 落在 `review` 前缀下，审核改状态后详情才会一起失效。
      get: (id) => read<Registration>('review.record', `/review/${encodeURIComponent(id)}`),
      updateStatus: (id, status) => write<ApiResult>(`/review/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { id, status } }, ['review', 'registrations', 'users.public']),
    },
    // 核销改的是报名状态，因此连带失效审核与用户公开资料。
    checkIn: (code) => write<ApiResult>('/checkin', { method: 'POST', body: { code } }, ['review', 'registrations', 'users.public']),
    users: {
      list: (query = {}) => read<User[]>('users', '/users', { query }),
      // 同上：写接口失效的是 `users`，键也要落在同一个前缀下。
      get: (id) => read<User>('users.record', `/users/${encodeURIComponent(id)}`),
      setStatus: (id, status) => write<ApiResult>(`/users/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { id, status } }, ['users']),
      disableTwoFactor: (id) => write<ApiResult>(`/users/${encodeURIComponent(id)}/two-factor`, { method: 'PUT', body: { id, enabled: false } }, ['users']),
      publicProfile: (query) => read<JsonObject>('users.public', '/users/public', { query }),
    },
    // 搜索一次返回展会与用户两组结果，返回体是对象而不是数组。
    search: (query) => read<SearchResult>('search', '/search', { query: { query } }),
    settings: {
      get: () => read<JsonObject>('settings', '/settings'),
      // 分类会在设置页一起改，所以保存设置时把 `categories` 一并失效。
      save: (payload) => write<ApiResult>('/settings', { method: 'PUT', body: payload }, ['settings', 'categories']),
      saveUiMode: (mode) => write<ApiResult>('/settings/ui-mode', { method: 'PUT', body: { mode } }, ['settings']),
      // 强调色是个人偏好：写调用者自己的 `users.ui_theme`，不动全局默认色板。
      saveUiTheme: (themeIndex) => write<ApiResult>('/settings/ui-theme', { method: 'PUT', body: { themeIndex } }, ['settings']),
    },
    clearCache: () => cache.clear(),
  };
}
