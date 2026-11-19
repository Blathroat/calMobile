/**
 * 服务器设置的类型与默认值。
 *
 * 这些值同时被运行时（`domain/settings.ts`）、seed 与迁移 `0006` / `0021` 使用：
 * 色板只在 `THEME_COLORS` 里维护一份，迁移步骤通过 `params` 接收它，避免两处漂移。
 */

export interface ServerSettings {
  theme: { index: number; colors: string[]; accentColor: string };
  ui: { mode: string };
  capabilities: { calendar: boolean; notifications: boolean; richText: boolean; export: boolean };
  categories: string[];
  /**
   * 审核策略。`canRevise`：展商能否改已通过 / 已拒绝的报名；
   * `canReviseAttended`：展商能否把「已参加」退回重审（默认关闭，管理员始终可改）。
   */
  review: { canRevise: boolean; canReviseAttended: boolean; statuses: string[] };
  media: { imageCount: number; imageSizeMb: number; videoCount: number; videoSizeMb: number };
  upload: {
    avatarSizeMb: number;
    avatarFormats: string[];
    imageFormats: string[];
    videoFormats: string[];
    /** 上传目录总上限（MB）。头像、封面和简介媒体都算在里面。 */
    storageMb: number;
    /** 满了以后清最早的文件，或拒绝新上传。 */
    whenFull: 'reject' | 'evict-oldest';
  };
  limits: {
    exhibitionTitle: number;
    exhibitionVenue: number;
    category: number;
    fieldTitle: number;
    /** 报名时每个文本收集项最多填多少字。 */
    textFill: number;
    /** 每个单选选项最多多少字。 */
    radioOption: number;
    /** 每个多选选项最多多少字。 */
    checkOption: number;
    usernameMin: number;
    usernameMax: number;
    passwordMin: number;
    passwordMax: number;
    nickname: number;
    bio: number;
    region: number;
    answer: number;
  };
  /**
   * 匿名报名（报名站分享链接、未登录）相关的展示配置。
   *
   * `nameFieldTitles` 是姓名同义词列表：展商的文本收集项标题命中其中任意一项时，
   * 报名页把额外的「姓名」表单合并掉，直接拿这项收集项当姓名；空数组表示不合并。
   */
  registration: { nameFieldTitles: string[] };
  announcement: { enabled: boolean; text: string };
  brand: { zh: string; en: string };
  /** 缺省展会封面：展会自己没有封面时用它，空串表示继续用占位图。 */
  cover: { defaultCover: string };
  /**
   * 展商端策略：
   * - `maxFutureExhibitions` / `maxFutureMeetings`：同时能筹备的展会 / 私人会议数上限，0 表示不限；
   * - `maxExhibitionDays`：单个展会最长持续天数（按开展～闭展算），0 表示不限。
   */
  exhibitor: { maxFutureExhibitions: number; maxFutureMeetings: number; maxExhibitionDays: number };
  /**
   * 邀请码生成默认值。uses 至少 1；validHours 为 0 表示不过期。
   * durationDays 是兑换后展商身份保留的天数，0 表示永久。
   */
  invite: { uses: number; validHours: number; durationDays: number };
  /**
   * 客户端安装包下载源（管理端设置）。
   *
   * - url：直接用管理员填的直链；
   * - github：追踪 repo 仓库的最新 Release，取第一个 .apk 资产的下载地址。
   * 空串表示没配，更新检查与报名站的下载条据此隐藏下载入口。
   */
  download: { source: 'url' | 'github'; url: string; repo: string };
  /**
   * 用户协议（管理端可选开启）。
   *
   * `content` 是 Markdown 正文；`version` 在正文变化时自增，用来判断已登录用户
   * 是否需要重新确认（只拨开关、不改正文不升版本）。`updatedAt` 是正文最后更新时间。
   */
  agreement: { enabled: boolean; content: string; version: number; updatedAt: string };
  /** 操作日志的存储上限（MB）：超过后自动清理最早的日志。 */
  logs: { storageMb: number };
}

/**
 * 应用配色的默认色板（12 种）。
 *
 * 2026-11 起首色由「钢青」担任，并允许管理设置下发色号覆盖它；原先的焦糖橙移到 1。
 * `users.ui_theme` 里的旧下标由迁移 `0020-theme-accent` 平移，老用户选中的颜色不变；
 * 新用户的默认下标是 0（钢青或管理设置下发的色号）。
 * 其余位置仍按「新色只能往后追加」维护，不要再重排 1..11。
 *
 * 每个色都能同时充当「实心按钮底色 + 白字」：与白色的对比度均 ≥ 4.5:1
 * （最浅的 #C05621 约 4.6:1），与深色模式页面底色（#171A1F）的对比度均 ≥ 2.1:1，
 * 因此深色模式下也认得出是「有彩色」而不是糊成一块深灰。
 *
 * 迁移 `0006` 的 `params` 在 `migrations/index.ts` 里读取它；本文件不依赖迁移模块。
 */
export const THEME_COLORS: readonly string[] = [
  '#41707E', // 0 钢青（默认）：可由管理设置下发色号覆盖
  '#C05621', // 1 焦糖橙：原默认色，老用户已选过它的会由 0020 迁移保持
  '#48515D', // 2 石墨蓝灰：中性冷色，用于沉稳、少彩的界面临时切换
  '#245D3C', // 3 森林绿：成功、环保与健康类主题
  '#2F6F8F', // 4 海湾青蓝：信息、科技与数据类主题
  '#334E7D', // 5 靛蓝：偏正式的商务蓝，比 4 更深更冷
  '#0E6E62', // 6 墨绿（偏青）：介于绿与蓝之间，区分度落在 3 与 4 之间
  '#6B3FA0', // 7 紫：活动、创意与展演类主题
  '#A32C5E', // 8 玫红：促销、节庆等强情绪主题
  '#5F6B2A', // 9 橄榄绿：偏黄绿，和 3 的森林绿、6 的墨绿拉开一档
  '#A33B3B', // 10 深红：比 8 的玫红更沉，适合展陈、纪实类主题
  '#8E4A76', // 11 梅紫：介于 7 的紫与 8 的玫红之间，更柔和
];

export const DEFAULT_SETTINGS: ServerSettings = {
  theme: { index: 0, colors: [...THEME_COLORS], accentColor: THEME_COLORS[0] ?? '#41707E' },
  ui: { mode: 'auto' },
  capabilities: { calendar: false, notifications: false, richText: true, export: true },
  categories: ['智能家居', '物流技术', '医疗健康', '新材料'],
  review: { canRevise: false, canReviseAttended: false, statuses: ['待审核', '已通过', '已拒绝'] },
  // 匿名报名姓名同义词：默认覆盖常见的叫法。展商收集项标题命中时，报名页不再单独要姓名。
  registration: { nameFieldTitles: ['姓名', '昵称', '称呼', '圈名'] },
  media: { imageCount: 8, imageSizeMb: 10, videoCount: 2, videoSizeMb: 50 },
  upload: {
    avatarSizeMb: 2,
    avatarFormats: ['jpg', 'jpeg', 'png', 'webp'],
    imageFormats: ['jpg', 'jpeg', 'png', 'webp'],
    videoFormats: ['mp4', 'mov', 'webm'],
    storageMb: 1024,
    whenFull: 'reject',
  },
  limits: {
    exhibitionTitle: 60,
    exhibitionVenue: 60,
    category: 20,
    fieldTitle: 30,
    textFill: 200,
    radioOption: 60,
    checkOption: 60,
    usernameMin: 3,
    usernameMax: 20,
    passwordMin: 6,
    passwordMax: 32,
    nickname: 20,
    bio: 200,
    region: 40,
    answer: 200,
  },
  announcement: { enabled: false, text: '' },
  brand: { zh: '发现展会', en: 'ExpoHub' },
  // 缺省封面默认留空：升级后的老库行为不变（没有封面的展会继续显示占位图）。
  cover: { defaultCover: '' },
  // 0 = 不限。演示环境默认放开，部署方按运营策略调小。
  exhibitor: { maxFutureExhibitions: 0, maxFutureMeetings: 0, maxExhibitionDays: 0 },
  invite: { uses: 1, validHours: 168, durationDays: 0 },
  // 默认是直链且地址为空：升级后的老库不会凭空多出一个下载入口。
  download: { source: 'url', url: '', repo: '' },
  // 默认不开启：升级后的老库不会凭空出现用户协议入口。
  agreement: { enabled: false, content: '', version: 0, updatedAt: '' },
  // 操作日志默认保留 64 MB，超出自动清理最早的记录。
  logs: { storageMb: 64 },
};
