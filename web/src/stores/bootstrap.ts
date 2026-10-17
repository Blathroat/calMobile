/**
 * 启动数据 store：`/bootstrap` 一次性下发的全局快照（品牌、限制、分类、公告、
 * 日历、媒体、上传、审核开关与配色）。
 *
 * 为什么放一处：这些值几乎每屏都要读（表单长度上限、上传上限、日历落点、强调色），
 * 却只在启动时变一次，集中存放可以避免各页各请求一次后端。
 *
 * 谁写：`app/runtime.ts` 的 `applyRuntimeBootstrap()` —— 必须在会话恢复**之后**调用，
 * 否则后端按匿名身份回答、下发的权限与用户都不对；管理员改完设置重新拉取时也走这里。
 * 谁读：`services/validate.ts`（`limits` / `server` / `media`）、`app/theme.ts`
 * （`theme.colors` / `theme.index`）、`app/preload.ts`（`calendar.landing`），
 * 以及各页面里的品牌名、公告与 `review.canRevise`。
 *
 * 不变量与坑：
 * - `apply()` 是逐段**浅合并**：某段缺失或不是对象时保留上一份，页面不会因为后端少发一个键
 *   就丢上限、丢配色；代价是后端**删掉**某个键在这里不会消失，要真下架得显式发新值。
 * - `categories` 是唯一例外：不是数组就整体清空（后端始终按全量数组下发）。
 * - `booted` 只由 `apply()` 置 true，是「后端数据已到」的唯一信号；`App.vue` 用它和
 *   `loggedIn`、`role` 拼成重算外壳的键，别在别处改写它。
 * - 没有清空动作：这些数据与账号无关，登出后继续沿用，重新登录时不会闪回默认值。
 * - `state` 里的值只是首帧兜底（品牌回退中文名 + `calMobile`，其余空对象），
 *   不代表后端一定下发过；读取时一律当作可能缺字段，用完自己兜底。
 */
import { t } from '@/i18n';
import { defineStore } from 'pinia';
import type { Bootstrap, JsonObject } from '@/api/types';

export interface BootstrapState {
  /** 是否已拿到后端启动数据；false 时页面只能用兜底值渲染 */
  booted: boolean;
  /** 展会分类字符串数组；类型上按 `unknown[]` 存，用前自己 `map(String)` */
  categories: unknown[];
  /** 服务端下发的字段长度上限，键名由后端定，`services/validate.ts` 按 key 取 */
  limits: JsonObject;
  /** 站点品牌名（`zh` / `en`）；首帧兜底中文名 + `calMobile` */
  brand: JsonObject;
  /** 公告（`text` / `enabled`），只有 `enabled === true` 时登录页与首页才展示 */
  announcement: JsonObject;
  /** 日历配置，`landing` 是首页落点的 `{ year, month }`（见 `app/preload.ts`） */
  calendar: JsonObject;
  /** 上传上限：`imageCount` / `imageSizeMb` / `videoCount` / `videoSizeMb`；0 是合法值（表示禁用） */
  media: JsonObject;
  /** 服务端约定：`avatarSizeMb` / `avatarFormats`，以及封面用的 `imageFormats` / `videoFormats` */
  server: JsonObject;
  /**
   * 审核策略：`canRevise` 是报名被审核后是否还允许修改；
   * `canReviseAttended` 是「已参加」能否退回重审（后端默认关闭）。
   * 老库可能还没下发新键，读取时按可能缺字段处理。
   */
  review: JsonObject & { canRevise?: boolean; canReviseAttended?: boolean };
  /** 管理员配色：强调色由 `colors[index]` 决定，运行时写进 `--accent*`；下标越界由 `app/theme.ts` 夹回范围 */
  theme: JsonObject;
  /** 缺省展会封面：`defaultCover` 是媒体短 URL，展会自己没有封面时用它（空串表示继续用占位图） */
  cover: JsonObject;
  /** 展商端策略：`maxFutureExhibitions` / `maxFutureMeetings` 为 0 时表示不限 */
  exhibitor: JsonObject;
  /** 报名站根地址（`PUBLIC_BASE_URL`）。空串表示没配域名，分享时不要拼本机地址。 */
  publicBaseUrl: string;
  /** 隐私政策地址（`PRIVACY_POLICY_URL`）。空串表示没配，注册页只显示收集说明。 */
  privacyPolicyUrl: string;
  /** 服务器建议的默认语言包，以及要自动下载的链接。正文不在这里。 */
  lang: { defaultPack: string; packs: { id: string; url: string }[] };
}

/**
 * 与登录态无关的启动数据；`apply()` 是唯一写入口，合并语义见文件头。
 * 注意 `booted === false` 只表示「还没拿到后端数据」，不代表后端数据为空。
 */
export const useBootstrapStore = defineStore('bootstrap', {
  state: (): BootstrapState => ({
    // 只有后端数据落定（或测试直接调 apply）才会变 true
    booted: false,
    categories: [],
    limits: {},
    // 品牌名兜底：文案注入晚于模块求值时 t() 只能退回 key，这里至少保证结构完整
    brand: { zh: t('app.brand'), en: 'calMobile' },
    announcement: {},
    calendar: {},
    media: {},
    server: {},
    review: {},
    theme: {},
    cover: {},
    exhibitor: {},
    publicBaseUrl: '',
    privacyPolicyUrl: '',
    lang: { defaultPack: '', packs: [] },
  }),
  actions: {
    /**
     * 用一份 bootstrap 响应更新快照：逐段浅合并并置位 `booted`。
     * @param data 后端下发的启动数据；可以缺省或只带部分段，缺的段保留上一份已有值，
     *   因此「只回 `ok: true`」也不会把已渲染的内容抹空。不会抛错，也没有返回值。
     */
    apply(data: Bootstrap = {}) {
      this.booted = true;
      // 唯一整体覆盖的段：后端始终按全量数组下发分类，缺字段即视为没有分类
      this.categories = Array.isArray(data.categories) ? data.categories : [];
      // 下面各段浅合并：某个键缺失（或发来 null / 数组）时保留旧值
      this.limits = { ...this.limits, ...asObject(data.limits) };
      this.brand = { ...this.brand, ...asObject(data.brand) };
      this.announcement = { ...this.announcement, ...asObject(data.announcement) };
      this.calendar = { ...this.calendar, ...asObject(data.calendar) };
      this.media = { ...this.media, ...asObject(data.media) };
      this.server = { ...this.server, ...asObject(data.server) };
      this.review = { ...this.review, ...asObject(data.review) };
      this.theme = { ...this.theme, ...asObject(data.theme) };
      this.cover = { ...this.cover, ...asObject(data.cover) };
      this.exhibitor = { ...this.exhibitor, ...asObject(data.exhibitor) };
      if (typeof data.publicBaseUrl === 'string') this.publicBaseUrl = data.publicBaseUrl;
      if (typeof data.privacyPolicyUrl === 'string') this.privacyPolicyUrl = data.privacyPolicyUrl;
      const lang = asLang(data.lang);
      if (lang) this.lang = lang;
    },
  },
});

/**
 * 只放行「纯对象」：数组、null、标量一律当作没下发，返回空对象。
 * @param value 后端下发的任意值
 * @returns 可安全展开的对象（原对象或空对象）
 */
function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asLang(value: unknown): { defaultPack: string; packs: { id: string; url: string }[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { defaultPack?: unknown; packs?: unknown };
  const packs: { id: string; url: string }[] = [];
  if (Array.isArray(record.packs)) {
    for (const item of record.packs) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as { id?: unknown }).id;
      const url = (item as { url?: unknown }).url;
      if (typeof id === 'string' && typeof url === 'string') packs.push({ id, url });
    }
  }
  return { defaultPack: typeof record.defaultPack === 'string' ? record.defaultPack : '', packs };
}
