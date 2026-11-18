/**
 * 业务响应的类型约定。
 *
 * 这里的接口**只描述前端真正读过的字段**，并且都继承 `JsonObject`（`Record<string, unknown>`），
 * 因此后端新增字段不需要同步改前端。代价是类型不设防：字段名拼错不会编译报错，只会在运行时
 * 变成 `undefined`，页面读可选字段时仍要自己兜底。
 *
 * 几条容易踩的约定：
 * - `Id` 一律当字符串用：后端下发的就是字符串，页面里不要 `Number(id)` 之后又传回去。
 * - 详情接口用 `found` 表达「查不到」，不走 404：调用方必须先判 `found` 再读 `exhibition` /
 *   `registration`，否则会对着 `undefined` 取属性。
 * - `ok?: boolean` 只出现在写接口的返回体里，而且**规则失败已经在 http 层抛成 `ApiError`**；
 *   能 resolve 出来的结果基本都不是 `ok: false`，别再补一层 `if (!result.ok)` 当成失败分支。
 * - `?` 的含义是「前端不依赖」，不是「暂时可能没有」：随手把可选字段收紧成必填，
 *   会让测试里的精简 mock 和旧版本服务端的响应编不过。
 */

/** 业务实体的主键。后端下发字符串，因此这里不写成 number，页面也不要转换。 */
export type Id = string;

/** 任意 JSON 对象。用于字段随版本变化的接口（资料、安全、设置等），不在这里逐个建模。 */
export type JsonObject = Record<string, unknown>;

/**
 * 登录 / 注册 / 访客登录的令牌结果。
 * 两步验证未通过时后端**不发任何令牌**，此时 `token` 与 `refreshToken` 都是空的 ——
 * 调用方要按「还需要验证」处理，而不是当成登录失败。
 */
export interface AuthResult extends JsonObject {
  token?: string;
  refreshToken?: string;
}

/** 用户协议（公开读取）：正文是 Markdown，交给渲染入口清洗。 */
export interface AgreementInfo extends JsonObject {
  enabled: boolean;
  version: number;
  content: string;
  updatedAt: string;
}

/** 启动数据里的用户协议摘要：登录/注册页据此决定是否展示勾选，不下载正文。 */
export interface AgreementSummary extends JsonObject {
  enabled: boolean;
  version: number;
  updatedAt: string;
}

/** 操作日志的一条记录（管理后台「最近日志」页）。 */
export interface LogEntry extends JsonObject {
  id: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
  actorName: string;
  actorId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string;
  createdAt: string;
}

/** 日志存储用量与上限（MB / 字节）。 */
export interface LogStats extends JsonObject {
  storageMb: number;
  limitBytes: number;
  usedBytes: number;
  entryCount: number;
}

/** 最近日志接口的返回体：列表 + 当前用量。 */
export interface LogsResult extends JsonObject {
  logs: LogEntry[];
  stats: LogStats;
}

/**
 * 当前登录用户。`role` 与 `statusCode` 是英文代码，展示时用
 * `services/status.ts` 的 `roleLabel()` / `userStatusLabel()` 取文案；
 * `roleLabel` / `status` 是服务端下发的**兼容字段**（旧快照还在用），新代码不要读。
 * `can` 是权限位，页面按 `can.exhibitor` / `can.admin` 决定入口显隐；它只是界面依据，
 * 真正的授权由后端判定，不能拿它当安全边界。
 */
export interface User extends JsonObject {
  id?: string;
  username?: string;
  nickname?: string;
  role?: string;
  /** 服务端下发的旧展示字段，新代码用 `roleLabel(role)`。 */
  roleLabel?: string;
  /** 限时展商的到期时间（ISO 字符串）；空串表示永久，到期后角色会变回普通用户。 */
  exhibitorExpiresAt?: string;
  /** 展商时长已经走完（角色已降为普通用户），用于页面说明原因。 */
  exhibitorExpired?: boolean;
  /** 服务端下发的旧展示字段，新代码用 `userStatusLabel(statusCode)`。 */
  status?: string;
  /** 账号状态 code：active / limited / banned。 */
  statusCode?: string;
  /** 管理员用户列表：最近一次登录的地区（如「江苏省苏州市」「内网」）；IP 原文不下发。 */
  lastLoginRegion?: string;
  loggedIn?: boolean;
  guest?: boolean;
  can?: Record<string, boolean>;
  /** 已看过的一次性提示 key（与账号绑定，见 `composables/useHint.ts`）。 */
  seenHints?: string[];
  /** 已同意的用户协议版本（0 = 从未同意）；与 bootstrap 下发的当前版本比较决定是否弹确认。 */
  agreedTermsVersion?: number;
  /** 最后一次同意用户协议的时间（ISO 字符串）。 */
  agreedTermsAt?: string;
}

/**
 * 服务器运行时品牌：PWA 名称、页面标题、描述与主题色。空字段表示沿用构建期默认值。
 * 只在 `bootstrap` 里下发，页面标题/安装信息用它补齐实例身份。
 */
export interface BrandingInfo extends JsonObject {
  appName?: string;
  shortName?: string;
  description?: string;
  appTitle?: string;
  joinTitle?: string;
  lang?: string;
  themeColor?: string;
  themeColorDark?: string;
  backgroundColor?: string;
}

/**
 * 启动数据：身份、权限、限制、主题、日历落点一次性下发。
 * 它是「当前是谁」的来源，所以 `api.bootstrap()` 刻意不走查询缓存，否则切账号后会读到上一个人。
 */
export interface Bootstrap extends JsonObject {
  user?: User;
  loggedIn?: boolean;
  /** 用户协议摘要（没有正文）；关闭时所有协议入口都不渲染。 */
  agreement?: AgreementSummary;
  /** 运行时品牌；旧服务器不发这个字段时页面沿用构建期默认值。 */
  branding?: BrandingInfo;
}

/** 列表里的展会。其余字段随管理员配置的自定义字段变化，这里只固定页面一定会用到的。 */
export interface Exhibition extends JsonObject {
  id: Id;
  title: string;
  date?: string;
  /** 闭展日期（`YYYY-MM-DD`）；空串表示单日展会。 */
  endDate?: string;
}

/**
 * 展会详情。`found` 为假时后端返回 `found: false` 的正常响应（可能带 `error` 文案），
 * 而不是 404；因此读 `exhibition` / `fields` 之前必须先判 `found`。
 */
export interface ExhibitionDetail extends JsonObject {
  found: boolean;
  exhibition?: Exhibition;
  fields?: Array<JsonObject & { title?: string; type?: string; required?: boolean; options?: string[] }>;
  error?: string;
}

/** 报名记录。`status` 是英文代码（待审 / 通过 / 驳回），中文映射只在服务端 labels 里做。 */
export interface Registration extends JsonObject {
  id: Id;
  status?: string;
}
/** 报名详情，同 `ExhibitionDetail`：用 `found` 表达查不到，不是抛异常。 */
export interface RegistrationDetail extends JsonObject {
  found: boolean;
  registration?: Registration;
  error?: string;
  /** 失败原因的稳定错误码（与 `error` 一起下发），页面按码本地化。 */
  errorCode?: string;
}
/**
 * 提交报名的返回体。匿名报名（报名站分享链接、未登录）多返回一次性的 `queryToken`，
 * 登录报名没有这个字段；`autoApproved` 与 `statusLabel` 两者都有。
 */
export interface RegistrationSubmitResult extends ApiResult {
  autoApproved?: boolean;
  statusLabel?: string;
  /** 查询报名的凭据，只在创建响应里出现一次，之后拿不回来。 */
  queryToken?: string;
  registration?: Registration;
}
/**
 * 用查询凭据把匿名报名关联到当前账号。
 * `claimed` 为 false 表示报名本来就已经属于当前账号（重复认领幂等成功）。
 */
export interface RegistrationClaimResult extends ApiResult {
  claimed?: boolean;
  registration?: Registration;
}
/**
 * 写接口的统一返回体。
 * `ok: false` 的规则失败已经被 `HttpClient` 抛成 `ApiError`，所以 resolve 出来的结果通常 `ok` 为真；
 * 保留这个字段只是为了兼容仍然直接读它的调用点。
 */
export interface ApiResult extends JsonObject {
  ok?: boolean;
  error?: string;
}

/** 搜索一次返回展会与用户两组结果（见 server/src/routes/search-hono.ts）。 */
export interface SearchResult extends JsonObject {
  query: string;
  exhibitions: Exhibition[];
  users: User[];
  count: number;
}

/** 报名管理一次返回记录与各状态数量（见 server/src/routes/review-hono.ts）。 */
export interface ReviewList extends JsonObject {
  exhibitionId: string;
  status: string;
  records: Registration[];
  counts: Record<string, number>;
}

/**
 * 最新版本与下载地址（`GET /app/release`，公开）。
 *
 * `source` 是管理端设置的下载源：`github` 时 `version` / `notes` 来自最新 release，
 * 直链时两者为空。`url` 为空表示管理员还没配下载地址，界面不要渲染下载入口。
 */
export interface ReleaseInfo extends JsonObject {
  source: 'url' | 'github';
  version: string;
  notes: string;
  url: string;
  publishedAt: string;
}
