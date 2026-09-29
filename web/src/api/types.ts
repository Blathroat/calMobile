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

/**
 * 当前登录用户。`role` 是英文代码，展示用 `roleLabel`（中文映射只在服务端做）。
 * `can` 是权限位，页面按 `can.exhibitor` / `can.admin` 决定入口显隐；它只是界面依据，
 * 真正的授权由后端判定，不能拿它当安全边界。
 */
export interface User extends JsonObject {
  id?: string;
  username?: string;
  nickname?: string;
  role?: string;
  roleLabel?: string;
  status?: string;
  loggedIn?: boolean;
  guest?: boolean;
  can?: Record<string, boolean>;
  /** 已看过的一次性提示 key（与账号绑定，见 `composables/useHint.ts`）。 */
  seenHints?: string[];
}

/**
 * 启动数据：身份、权限、限制、主题、日历落点一次性下发。
 * 它是「当前是谁」的来源，所以 `api.bootstrap()` 刻意不走查询缓存，否则切账号后会读到上一个人。
 */
export interface Bootstrap extends JsonObject {
  user?: User;
  loggedIn?: boolean;
}

/** 列表里的展会。其余字段随管理员配置的自定义字段变化，这里只固定页面一定会用到的三个。 */
export interface Exhibition extends JsonObject {
  id: Id;
  title: string;
  date?: string;
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
export interface Registration extends JsonObject { id: Id; status?: string; }
/** 报名详情，同 `ExhibitionDetail`：用 `found` 表达查不到，不是抛异常。 */
export interface RegistrationDetail extends JsonObject {
  found: boolean;
  registration?: Registration;
  error?: string;
}
/**
 * 写接口的统一返回体。
 * `ok: false` 的规则失败已经被 `HttpClient` 抛成 `ApiError`，所以 resolve 出来的结果通常 `ok` 为真；
 * 保留这个字段只是为了兼容仍然直接读它的调用点。
 */
export interface ApiResult extends JsonObject { ok?: boolean; error?: string; }

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
