<script setup lang="ts">
/**
 * 屏幕 15 · 管理后台（用户 / 展会 / 设置）
 *
 * 展会卡片与展商后台保持一致；搜索、暂停与导出直接内联在本页。
 * 启动公告、展会分类、审核策略、媒体与上传限制、字符数上限都属于服务器设置，
 * 保存后对所有用户生效，因此统一放在「设置」分区，不再有二级页面。
 *
 * 分段只切本地状态：切分区复用已取到的数据，不整页重建；
 * 搜索框带防抖，避免每次按键都触发一次取数。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, applyRuntimeBootstrap } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import type { SheetAction } from '@/services/sheet';
import { check } from '@/services/validate';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import AppIcon from '@/components/AppIcon.vue';
import SegControl from '@/components/SegControl.vue';
import AdminUsersSection from './AdminUsersSection.vue';
import AdminExhibitionsSection from './AdminExhibitionsSection.vue';
import AdminSettingsSection from './AdminSettingsSection.vue';
import { USER_STATUSES, modeLabel, roleLabel, userStatusLabel } from '@/services/status';
import type { Bootstrap, Exhibition, JsonObject, User } from '@/api/types';
import { t } from '@/i18n';

/**
 * 账号状态面板：`value` 是回传接口、并与 `user.statusCode` 比较的 code（不随语言变），
 * `label` 才是屏幕上的文案。
 */
const USER_STATUS_OPTIONS = USER_STATUSES.map((value) => ({ value, label: userStatusLabel(value) }));
const ROLE_OPTIONS = [
  { code: 'user', label: t('admin.users.roleUser') },
  { code: 'exhibitor', label: t('admin.users.roleExhibitor') },
  { code: 'admin', label: t('admin.users.roleAdmin') },
];

/**
 * 分区用稳定的英文 id 做值（`value` 会写进 URL 的 `?tab=`），标签才是给用户看的文案：
 * 用中文当值会让地址栏里出现百分号转义，也不便于以后改文案。
 */
const TABS = [
  { value: 'users', label: t('admin.users.title') },
  { value: 'exhibitions', label: t('admin.exhibitions.title') },
  { value: 'settings', label: t('settings.title') },
];

const tabIds = new Set(TABS.map((item) => item.value));

/** 用户分区的身份筛选：值沿用协议 code，空串表示「全部」（不发给服务端）。 */
const USER_ROLE_FILTERS = ['user', 'exhibitor', 'admin'];
/** 用户分区的账号状态筛选：与账号状态词表一致，空串表示「全部」。 */
const USER_STATUS_FILTERS: string[] = USER_STATUSES;

/**
 * 字符数上限的唯一清单：控件的键、提交的字段名与后端 `app_settings.limits` 的键名
 * 都从这里派生，新增一项只加一行。取值范围由后端收敛（超出会被夹到合法区间）。
 * 按展会、收集项、账号分成三组，方便在同一张卡里查找。
 */
interface LimitItem {
  key: string;
  label: string;
  hint: string;
  unit: string;
}

const LIMIT_GROUPS: Array<{ id: string; title: string; items: LimitItem[] }> = [
  {
    id: 'exhibition',
    title: t('admin.limits.exhibitionInfo'),
    items: [
      {
        key: 'exhibitionTitle',
        label: t('admin.limits.exhibitionName'),
        hint: t('admin.limits.exhibitionNameMax'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'exhibitionVenue',
        label: t('admin.limits.exhibitionVenue'),
        hint: t('admin.limits.exhibitionVenueMax'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'category',
        label: t('admin.limits.category'),
        hint: t('admin.limits.categoryMax'),
        unit: t('admin.limits.chars'),
      },
    ],
  },
  {
    id: 'collect',
    title: t('admin.limits.collectFields'),
    items: [
      {
        key: 'fieldTitle',
        label: t('admin.limits.fieldHeading'),
        hint: t('admin.limits.sharedFieldHeading'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'textFill',
        label: t('admin.limits.textFill'),
        hint: t('admin.limits.textFillMax'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'radioOption',
        label: t('admin.limits.radioOption'),
        hint: t('admin.limits.radioOptionMax'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'checkOption',
        label: t('admin.limits.checkOption'),
        hint: t('admin.limits.checkOptionMax'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'answer',
        label: t('admin.limits.fullAnswer'),
        hint: t('admin.limits.fullAnswerTotal'),
        unit: t('admin.limits.chars'),
      },
    ],
  },
  {
    id: 'account',
    title: t('admin.limits.account'),
    items: [
      {
        key: 'usernameMin',
        label: t('admin.limits.usernameMin'),
        hint: t('admin.limits.usernameMinChars'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'usernameMax',
        label: t('admin.limits.usernameMax'),
        hint: t('admin.limits.usernameMaxChars'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'passwordMin',
        label: t('admin.limits.passwordMin'),
        hint: t('admin.limits.passwordMinChars'),
        unit: t('admin.limits.passwordPlaces'),
      },
      {
        key: 'passwordMax',
        label: t('admin.limits.passwordMax'),
        hint: t('admin.limits.passwordMaxChars'),
        unit: t('admin.limits.passwordPlaces'),
      },
      {
        key: 'nickname',
        label: t('admin.limits.nicknameMax'),
        hint: t('admin.limits.nicknameMaxChars'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'bio',
        label: t('admin.limits.bioMax'),
        hint: t('admin.limits.bioMaxChars'),
        unit: t('admin.limits.chars'),
      },
      {
        key: 'region',
        label: t('admin.limits.regionMax'),
        hint: t('admin.limits.regionMaxChars'),
        unit: t('admin.limits.chars'),
      },
    ],
  },
];

const LIMIT_ITEMS = LIMIT_GROUPS.flatMap((group) => group.items);

function pairLimits(items: LimitItem[]): LimitItem[][] {
  const rows: LimitItem[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

const router = useRouter();
const route = useRoute();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

/** 当前分区来自 URL：从「查看报名」这类二级页返回时，仍停在进入前的分区。 */
const tab = ref(tabFromQuery());
const query = ref('');
/** 用户分区的两个筛选也以地址栏为准：进页面时读一次，之后由 watch 与筛选操作保持同步。 */
const userRoleFilter = ref(roleFromQuery());
const userStatusFilter = ref(statusFromQuery());
const users = useAsync<User[]>();
const exhibitions = useAsync<Exhibition[]>();
const settingsQuery = useAsync<JsonObject>();

/** 服务端设置的可编辑副本：一次取回，保存时整体回填。 */
const form = reactive({
  brand: { zh: '', en: '' },
  /** 首色调（#RRGGBB），同时覆盖色板下标 0；空串/非法值保存时拒绝。 */
  themeAccent: '#41707E',
  announcement: '',
  announcementEnabled: false,
  categories: '',
  canRevise: false,
  /** 「已参加」能否由展商退回重审；默认关闭（管理员始终可改） */
  canReviseAttended: false,
  imageCount: 8,
  imageSizeMb: 10,
  videoCount: 2,
  videoSizeMb: 50,
  avatarSizeMb: 2,
  avatarFormats: '',
  imageFormats: '',
  videoFormats: '',
  limits: {} as Record<string, number>,
  /** 缺省展会封面（媒体短 URL）：展会自己没有封面时用它，空串表示继续用占位图 */
  defaultCover: '',
  /** 展商可同时筹备的展会数；0 表示不限 */
  maxFutureExhibitions: 0,
  /** 展商可同时筹备的私人会议数；0 表示不限 */
  maxFutureMeetings: 0,
  /** 单个展会最长持续天数（按开展～闭展算）；0 表示不限 */
  maxExhibitionDays: 0,
  /** 服务器存储上限，单位 MB */
  storageMb: 1024,
  /** 存满以后：拒绝新上传，或删掉最早的文件 */
  whenFull: 'reject' as 'reject' | 'evict-oldest',
  /** 操作日志的存储上限，单位 MB；超过后服务端自动清掉最早的日志 */
  logs: { storageMb: 64 },
  /** 生成邀请码时的默认次数与有效小时。0 小时表示不过期。 */
  inviteUses: 1,
  inviteValidHours: 168,
  /** 兑换后展商身份保留的天数；0 表示永久 */
  inviteDurationDays: 0,
  /** 软件包下载源：直链/目录或 GitHub 仓库（owner/repo） */
  download: { source: 'url' as 'url' | 'github', url: '', repo: '' },
  /** 用户协议：开关与 Markdown 正文，随其它设置一起保存（正文变化时服务端自增版本） */
  agreement: { enabled: false, content: '' },
  /** 匿名报名姓名同义词：一行一个标题，保存时拆成数组提交（空列表表示不做姓名合并） */
  registrationNameFieldTitles: '',
});

/** 管理页自己的文案：提示与开关说明放在这里，提取脚本会换成文案 key。 */
const COPY = {
  coverTitle: t('admin.media.defaultCover'),
  coverHint: t('admin.media.defaultCoverFallback'),
  limitIntro: t('admin.limits.charCapIntro'),
  exhibitorSection: t('admin.settings.exhibitorSection'),
  exhibitorLimit: t('admin.limits.concurrentExhibitions'),
  exhibitorLimitHint: t('admin.limits.concurrentExhibitionsRule'),
  meetingLimit: t('admin.limits.concurrentMeetings'),
  meetingLimitHint: t('admin.limits.concurrentMeetingsRule'),
  maxExhibitionDays: t('admin.settings.maxExhibitionDays'),
  maxExhibitionDaysHint: t('admin.settings.maxExhibitionDaysHint'),
  manageExhibitions: t('admin.users.manageExhibitions'),
  manageMeetings: t('admin.users.manageMeetings'),
  adjustStatus: t('admin.users.adjustStatus'),
  adjustRole: t('admin.users.adjustRole'),
  avatarSection: t('admin.media.avatar'),
  avatarFormats: t('admin.media.avatarFormats'),
  avatarFormatsInvalid: t('admin.media.avatarFormatRule'),
  storageTitle: t('admin.media.storage'),
  storageHint: t('admin.media.storageCleanup'),
  storageLimit: t('admin.media.storageCap'),
  storageWhenFull: t('admin.media.whenFull'),
  storageEvict: t('admin.media.evictOldest'),
  storageReject: t('admin.media.rejectUpload'),
};

/**
 * 分区文案：整块下传给对应分区，子组件不再自己拼文案。
 * 表单校验、提示语等本页仍在用的文案留在 COPY 里。
 */
const usersCopy = {
  adjustStatus: COPY.adjustStatus,
  adjustRole: COPY.adjustRole,
  manageExhibitions: COPY.manageExhibitions,
  manageMeetings: COPY.manageMeetings,
};

const settingsCopy = {
  coverTitle: COPY.coverTitle,
  coverHint: COPY.coverHint,
  limitIntro: COPY.limitIntro,
  exhibitorSection: COPY.exhibitorSection,
  exhibitorLimit: COPY.exhibitorLimit,
  exhibitorLimitHint: COPY.exhibitorLimitHint,
  meetingLimit: COPY.meetingLimit,
  meetingLimitHint: COPY.meetingLimitHint,
  maxExhibitionDays: COPY.maxExhibitionDays,
  maxExhibitionDaysHint: COPY.maxExhibitionDaysHint,
  avatarSection: COPY.avatarSection,
  avatarFormats: COPY.avatarFormats,
  storageTitle: COPY.storageTitle,
  storageHint: COPY.storageHint,
  storageLimit: COPY.storageLimit,
  storageWhenFull: COPY.storageWhenFull,
};
const storageUsage = ref({ usedBytes: 0, limitBytes: 1024 * 1024 * 1024, fileCount: 0 });
/**
 * 日志的当前用量：只有管理员会从设置接口拿到。
 * `hasUsage` 为假时设置卡片只显示「—」，不画一条没有数据的进度条。
 */
const logsUsage = ref({ usedBytes: 0, entryCount: 0, hasUsage: false });
const storagePolicies = [
  { value: 'reject', label: COPY.storageReject },
  { value: 'evict-oldest', label: COPY.storageEvict },
];
const coverBusy = ref(false);
/** 缺省封面上传进度（0–100）；null 表示没有上传在跑。 */
const coverProgress = ref<number | null>(null);
const inviteBusy = ref(false);
const invites = ref<
  Array<{
    id: string;
    code: string;
    maxUses: number;
    usedCount: number;
    durationDays: number;
    expiresAt: string;
    status: string;
  }>
>([]);
const settingsError = ref('');
const settingsSaving = ref(false);
/** 用户协议当前生效的版本与更新时间：只读展示，保存后按服务端返回的设置回填。 */
const agreementVersion = ref(0);
const agreementUpdatedAt = ref('');
const loaded = ref(false);
const panelBusy = computed(() =>
  tab.value === 'users'
    ? users.loading.value
    : tab.value === 'exhibitions'
      ? exhibitions.loading.value
      : settingsQuery.loading.value,
);

const userItems = computed<User[]>(() => users.data.value ?? []);
const exhibitionItems = computed<Exhibition[]>(() => exhibitions.data.value ?? []);

// ── 分区取数 ─────────────────────────────────────────────────────

let searchTimer: number | undefined;
let preloadTimer: number | undefined;

/** 搜索框带 220ms 防抖，避免每次按键都触发一次取数。 */
function onSearch(value: string): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    query.value = value.trim();
    loadPanel();
  }, 220);
}

function loadUsers(): Promise<unknown> {
  // 空筛选不发给服务端：地址栏里的空串只是「全部」的表示，不该进查询参数。
  const filters: JsonObject = { query: query.value };
  if (userRoleFilter.value) filters.role = userRoleFilter.value;
  if (userStatusFilter.value) filters.status = userStatusFilter.value;
  return users.run(() => api.users.list(filters));
}

function loadExhibitions(): Promise<unknown> {
  return exhibitions.run(() => api.exhibitions.list({ query: query.value }));
}

function loadPanel(): void {
  // 与 TABS 的 id 比较（不是中文标签）：标签是用来显示的，改文案不该影响取数分支。
  if (tab.value === 'users') {
    void loadUsers();
    return;
  }
  if (tab.value === 'exhibitions') {
    void loadExhibitions();
    return;
  }
  void loadSettings();
}

function changeTab(value: string): void {
  if (value === tab.value) return;
  // 把分区写进地址栏（替换历史，不留下一条只换过 tab 的记录）：
  // 从二级页返回时才能回到同一个分区。
  void router.replace({ query: { ...route.query, tab: value } });
}

/** 用户分区改身份筛选：值写回地址栏，由路由监听统一重新取数。 */
function changeUserRole(value: string): void {
  updateUserFilters(value, userStatusFilter.value);
}

/** 用户分区改状态筛选：同样是写回地址栏再取数，与关键字搜索各自独立。 */
function changeUserStatus(value: string): void {
  updateUserFilters(userRoleFilter.value, value);
}

function updateUserFilters(role: string, status: string): void {
  if (role === userRoleFilter.value && status === userStatusFilter.value) return;
  // 先更新本地值，控件立即可见；地址栏与取数交给下面的 watch（替换历史，不堆记录）。
  userRoleFilter.value = role;
  userStatusFilter.value = status;
  void router.replace({ query: { ...route.query, tab: 'users', role, status } });
}

/** 管理页只放最近日志的入口：列表与统计在 /logs 二级页，不占管理分区。 */
function openLogs(): void {
  void router.push('/logs');
}

/** URL 里的分区 id；非法或缺省时回到第一个分区。 */
function tabFromQuery(): string {
  const value = String(route.query.tab ?? '');
  return tabIds.has(value) ? value : (TABS[0]?.value ?? '');
}

/** URL 里的身份筛选；空串或无法识别的值按「全部」处理。 */
function roleFromQuery(): string {
  const value = String(route.query.role ?? '');
  return USER_ROLE_FILTERS.includes(value) ? value : '';
}

/** URL 里的账号状态筛选；空串或无法识别的值按「全部」处理。 */
function statusFromQuery(): string {
  const value = String(route.query.status ?? '');
  return USER_STATUS_FILTERS.includes(value) ? value : '';
}

// 从二级页返回、或用户直接改地址栏时，让分区与用户筛选都跟着 URL 走。
watch(
  () => route.fullPath,
  () => {
    if (route.path !== '/admin') {
      // 离开管理页时取消尚未触发的搜索防抖，别把旧页面的关键字带到下一次进入。
      window.clearTimeout(searchTimer);
      return;
    }
    const next = tabFromQuery();
    if (next !== tab.value) {
      window.clearTimeout(searchTimer);
      tab.value = next;
      // 搜索词跟着分区走：换分区后旧的筛选不再适用。
      query.value = '';
    }
    // 只改用户筛选时不清搜索防抖：关键字等 220ms 后照常取数，两个条件互不覆盖。
    userRoleFilter.value = roleFromQuery();
    userStatusFilter.value = statusFromQuery();
    loadPanel();
  },
);

/**
 * 预热另外两个分区：切分区时才第一次取数，会先画一段加载态（整页闪一下）。
 * 三个分区的读接口都走查询缓存，这里只是把请求提前到当前分区画完之后发，
 * 切过去时直接命中缓存。失败无所谓：真到那一步会照常报错并给重试。
 */
function preloadPanels(): void {
  preloadTimer = window.setTimeout(() => {
    // 预热只填查询缓存，不写分区状态或尚未打开的设置表单。
    if (tab.value !== 'users') void api.users.list({ query: '' }).catch(() => undefined);
    if (tab.value !== 'exhibitions') void api.exhibitions.list({ query: '' }).catch(() => undefined);
    if (tab.value !== 'settings') void api.settings.get().catch(() => undefined);
  }, 0);
}

onMounted(() => {
  loadPanel();
  preloadPanels();
});

// 设置分区里有正在编辑的表单，下拉不重新取设置，避免盖掉未保存的输入。
usePullRefresh(
  async () => {
    if (tab.value === 'users') await loadUsers();
    else if (tab.value === 'exhibitions') await loadExhibitions();
  },
  computed(() => {
    if (tab.value === 'users') return users.loading.value && users.data.value !== undefined;
    if (tab.value === 'exhibitions') return exhibitions.loading.value && exhibitions.data.value !== undefined;
    return false;
  }),
  computed(() => tab.value === 'users' || tab.value === 'exhibitions'),
);
onBeforeUnmount(() => {
  window.clearTimeout(searchTimer);
  window.clearTimeout(preloadTimer);
});

// ── 用户管理 ─────────────────────────────────────────────────────

/**
 * 状态面板只列出状态名，不再附「· 说明」：说明属于顶部那条账号状态提示，
 * 塞进按钮里会让每个选项都变成一句话，选起来反而更慢。
 */
function openPublic(user: User): void {
  const nickname = String(user.nickname ?? '');
  if (!nickname) return;
  void router.push({
    path: `/user-public/${encodeURIComponent(nickname)}`,
    query: { userId: String(user.id ?? '') },
  });
}

function manageRole(user: User): void {
  const actions: SheetAction[] = ROLE_OPTIONS.map((option) => ({
    label: option.label,
    variant: user.roleCode === option.code ? 'primary' : 'ghost',
    onClick: async (close) => {
      close();
      await updateUserRole(user, option.code, option.label);
    },
  }));
  openSheet({
    title: t('admin.users.adjustRoleFor', { name: String(user.nickname ?? '') }),
    message: t('admin.users.registeredAt', {
      role: roleLabel(String(user.role || user.roleCode || '')),
      time: String(user.registrationTime || t('admin.users.unknown')),
    }),
    actions,
    layout: 'stack',
  });
}

async function updateUserRole(user: User, role: string, label: string): Promise<void> {
  try {
    const result = await api.users.setRole(String(user.id ?? ''), role);
    const ok = result?.ok === true;
    toast(
      String(
        ok
          ? t('admin.users.setTo', { name: String(user.nickname ?? ''), value: label })
          : result?.error || t('admin.users.updateFailed'),
      ),
      ok ? 'success' : 'error',
    );
    if (ok) await loadUsers();
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function manageUser(user: User): void {
  const actions: SheetAction[] = USER_STATUS_OPTIONS.map((option) => ({
    label: option.label,
    variant: user.statusCode === option.value ? 'primary' : 'ghost',
    onClick: async (close) => {
      close();
      await updateUserStatus(user, option.value, option.label);
    },
  }));
  // 不放「取消」：点遮罩、按返回或 Esc 都能关，面板里多一个取消只会让状态选项更不显眼。
  openSheet({
    title: t('admin.users.adjustStatusFor', { name: String(user.nickname ?? '') }),
    message: t('admin.users.registeredAt', {
      role: roleLabel(String(user.role || user.roleCode || '')),
      time: String(user.registrationTime || t('admin.users.unknown')),
    }),
    actions,
    layout: 'stack',
  });
}

/** 「管理展会」跳到以该用户为展商的二级管理页。 */
function openUserExhibitions(user: User): void {
  void router.push(`/admin/exhibitions/${encodeURIComponent(String(user.id ?? ''))}`);
}

/** 同上，「管理私人会议」。 */
function openUserMeetings(user: User): void {
  void router.push(`/admin/meetings/${encodeURIComponent(String(user.id ?? ''))}`);
}

async function updateUserStatus(user: User, status: string, label: string): Promise<void> {
  try {
    // 写接口统一返回 { ok, error }：只判断整个响应是否为真会把失败也当成成功。
    const result = await api.users.setStatus(String(user.id ?? ''), status);
    const ok = result?.ok === true;
    toast(
      String(
        ok
          ? t('admin.users.setTo', { name: String(user.nickname ?? ''), value: label })
          : result?.error || t('admin.users.updateFailed'),
      ),
      ok ? 'success' : 'error',
    );
    if (ok) await loadUsers();
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

/**
 * 关闭某个账号的两步验证 —— 两步验证唯一的兜底出口。
 * 用户邮箱用不了时本人登不进去也关不掉，只有管理员能帮他恢复访问，因此要二次确认。
 */
function disableTwoFactor(user: User): void {
  confirmSheet({
    title: t('admin.users.disableTwoFactor'),
    message: t('admin.users.disableTwoFactorConfirm', { name: String(user.nickname ?? '') }),
    confirmLabel: t('common.close'),
    tone: 'danger',
    onConfirm: async () => {
      try {
        const result = await api.users.disableTwoFactor(String(user.id ?? ''));
        const ok = result?.ok === true;
        toast(
          String(
            ok
              ? t('admin.users.twoFactorDisabled', { name: String(user.nickname ?? '') })
              : result?.error || t('admin.users.updateFailed'),
          ),
          ok ? 'success' : 'error',
        );
        if (ok) await loadUsers();
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

// ── 展会管理 ─────────────────────────────────────────────────────

/** CSV 字段转义：含逗号、引号或换行时用双引号包住，内部引号翻倍。 */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportCsv(): Promise<void> {
  const rows = [
    [
      t('admin.limits.exhibitionName'),
      t('admin.exhibitions.venue'),
      t('admin.exhibitions.date'),
      t('admin.exhibitions.time'),
      t('admin.exhibitions.status'),
      t('admin.exhibitions.category'),
      t('admin.exhibitions.summary'),
    ],
    ...exhibitionItems.value.map((item) => [
      String(item.title ?? ''),
      String(item.venue ?? ''),
      String(item.date ?? item.dateLabel ?? ''),
      String(item.time ?? ''),
      modeLabel(String(item.statusCode ?? '')),
      String(item.category ?? ''),
      String(item.description ?? '').replace(/\n/g, ' '),
    ]),
  ];
  // 带 BOM，Excel 打开中文表头才不会乱码。
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const filename = 'exhibitions.csv';
  try {
    await device.exportCsv(filename, content);
    toast(t('admin.exhibitions.exportedRows', { count: exhibitionItems.value.length, file: filename }), 'success');
  } catch (reason) {
    // 用户在系统保存框点了取消：按码判断，不给红色错误，只说明没有导出。
    if (reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled') {
      toast(t('admin.exhibitions.exportCancelled'));
      return;
    }
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

// ── 服务器设置 ───────────────────────────────────────────────────

const formatPattern = /^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/;
const titleEnPattern = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
/** 用户协议正文上限：与服务端一致（超出时服务端回 `settings.agreementTooLong`）。 */
const AGREEMENT_MAX_CHARS = 200_000;

async function loadSettings(): Promise<void> {
  const data = await settingsQuery.run(() => api.settings.get());
  if (!data) return;
  fillForm(data);
  loaded.value = true;
}

/** 把服务端设置落到表单：缺省项退回 bootstrap 里已经有的值。 */
function fillForm(data: JsonObject): void {
  const brand = (data.brand ?? {}) as JsonObject;
  const announcement = (data.announcement ?? {}) as JsonObject;
  const review = (data.review ?? {}) as JsonObject;
  const media = (data.media ?? {}) as JsonObject;
  const upload = (data.upload ?? {}) as JsonObject;
  const limits = (data.limits ?? {}) as JsonObject;
  const theme = (data.theme ?? {}) as JsonObject;

  form.brand.zh = String(brand.zh ?? bootstrap.brand.zh ?? '');
  form.brand.en = String(brand.en ?? bootstrap.brand.en ?? '');
  form.themeAccent = String(theme.accentColor ?? (Array.isArray(theme.colors) ? theme.colors[0] : '') ?? '#41707E');
  form.announcement = String(announcement.text ?? '');
  form.announcementEnabled = announcement.enabled === true;
  form.categories = (Array.isArray(data.categories) ? data.categories : []).map((item) => String(item)).join('\n');
  form.canRevise = review.canRevise === true;
  form.canReviseAttended = review.canReviseAttended === true;
  form.imageCount = Number(media.imageCount ?? bootstrap.media.imageCount ?? 8);
  form.imageSizeMb = Number(media.imageSizeMb ?? bootstrap.media.imageSizeMb ?? 10);
  form.videoCount = Number(media.videoCount ?? bootstrap.media.videoCount ?? 2);
  form.videoSizeMb = Number(media.videoSizeMb ?? bootstrap.media.videoSizeMb ?? 50);
  form.avatarSizeMb = Number(upload.avatarSizeMb ?? bootstrap.server.avatarSizeMb ?? 2);
  const avatarFormats = Array.isArray(upload.avatarFormats)
    ? upload.avatarFormats
    : Array.isArray(bootstrap.server.avatarFormats)
      ? bootstrap.server.avatarFormats
      : ['jpg', 'jpeg', 'png', 'webp'];
  form.avatarFormats = avatarFormats.map((item) => String(item)).join(',');
  form.imageFormats = (Array.isArray(upload.imageFormats) ? upload.imageFormats : [])
    .map((item) => String(item))
    .join(',');
  form.videoFormats = (Array.isArray(upload.videoFormats) ? upload.videoFormats : [])
    .map((item) => String(item))
    .join(',');
  form.limits = {};
  for (const item of LIMIT_ITEMS) form.limits[item.key] = Number(limits[item.key] ?? bootstrap.limits[item.key] ?? 0);
  const cover = (data.cover ?? {}) as JsonObject;
  const exhibitor = (data.exhibitor ?? {}) as JsonObject;
  form.defaultCover = String(cover.defaultCover ?? bootstrap.cover.defaultCover ?? '');
  form.maxFutureExhibitions = Number(exhibitor.maxFutureExhibitions ?? bootstrap.exhibitor.maxFutureExhibitions ?? 0);
  form.maxFutureMeetings = Number(exhibitor.maxFutureMeetings ?? bootstrap.exhibitor.maxFutureMeetings ?? 0);
  form.maxExhibitionDays = Number(exhibitor.maxExhibitionDays ?? bootstrap.exhibitor.maxExhibitionDays ?? 0);
  const invite = (data.invite ?? {}) as JsonObject;
  form.inviteUses = Number(invite.uses ?? form.inviteUses) || 1;
  const legacyDays = invite.validDays;
  const storedHours =
    invite.validHours ??
    (legacyDays === undefined || legacyDays === null ? form.inviteValidHours : Number(legacyDays) * 24);
  form.inviteValidHours = Number(storedHours);
  if (!Number.isFinite(form.inviteValidHours)) form.inviteValidHours = 168;
  form.inviteDurationDays = Number(invite.durationDays ?? form.inviteDurationDays) || 0;
  const download = (data.download ?? {}) as JsonObject;
  form.download.source = download.source === 'github' ? 'github' : 'url';
  form.download.url = String(download.url ?? '');
  form.download.repo = String(download.repo ?? '');
  // 匿名报名姓名同义词：服务端下发数组，页面上按「一行一个标题」编辑。
  const registration = (data.registration ?? {}) as JsonObject;
  form.registrationNameFieldTitles = (Array.isArray(registration.nameFieldTitles) ? registration.nameFieldTitles : [])
    .map((item) => String(item))
    .join('\n');
  // 用户协议：管理端额外拿到正文。只在数据里真有这一段时才回填，生成邀请码这类局部刷新
  // 不带 agreement 时不能把正在编辑的正文冲掉；版本与更新时间同样按服务端返回更新。
  const agreement = data.agreement;
  if (agreement && typeof agreement === 'object' && !Array.isArray(agreement)) {
    const record = agreement as JsonObject;
    form.agreement.enabled = record.enabled === true;
    form.agreement.content = String(record.content ?? '');
    agreementVersion.value = Number(record.version) || 0;
    agreementUpdatedAt.value = String(record.updatedAt ?? '');
  }
  if (Array.isArray(data.invites)) {
    invites.value = data.invites.map((item) => {
      const row = (item ?? {}) as JsonObject;
      return {
        id: String(row.id ?? ''),
        code: String(row.code ?? ''),
        maxUses: Number(row.maxUses) || 0,
        usedCount: Number(row.usedCount) || 0,
        durationDays: Number(row.durationDays) || 0,
        expiresAt: String(row.expiresAt ?? ''),
        status: String(row.status ?? ''),
      };
    });
  }
  form.storageMb = Number(upload.storageMb ?? 1024);
  form.whenFull = upload.whenFull === 'evict-oldest' ? 'evict-oldest' : 'reject';
  const storage = (data.storage ?? {}) as JsonObject;
  const limitBytes = Number(storage.limitBytes);
  storageUsage.value = {
    usedBytes: Number(storage.usedBytes) || 0,
    limitBytes: Number.isFinite(limitBytes) && limitBytes > 0 ? limitBytes : form.storageMb * 1024 * 1024,
    fileCount: Number(storage.fileCount) || 0,
  };
  // 日志：上限（MB）与当前用量。用量只有管理员能拿到；返回里没有这一段时保留上一次的值，
  // 不能因为一次局部刷新（例如生成邀请码）把卡片上的用量清空。
  const logs = (data.logs ?? {}) as JsonObject;
  form.logs.storageMb = clampLogsMb(logs.storageMb ?? form.logs.storageMb);
  if (logs.usedBytes !== undefined || logs.entryCount !== undefined) {
    logsUsage.value = {
      usedBytes: Number(logs.usedBytes) || 0,
      entryCount: Number(logs.entryCount) || 0,
      hasUsage: true,
    };
  }
}

/** 日志上限：整数 MB，本地先收敛到 1～10240（服务端还会再收一次）。 */
function clampLogsMb(value: unknown): number {
  const number = Number(value) || 64;
  return Math.max(1, Math.min(10240, Math.round(number)));
}

function formatStorage(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const storageFull = computed(
  () => storageUsage.value.limitBytes > 0 && storageUsage.value.usedBytes >= storageUsage.value.limitBytes,
);
const storagePercent = computed(() => {
  const limit = storageUsage.value.limitBytes;
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((storageUsage.value.usedBytes / limit) * 100));
});
const storageCaption = computed(() =>
  t('admin.media.usage', {
    used: formatStorage(storageUsage.value.usedBytes),
    limit: formatStorage(storageUsage.value.limitBytes),
  }),
);

/**
 * 缺省封面：先在设备上选择，再上传到服务器。
 * 只改表单里的值，点「保存设置」才落库。
 * 上传期间在预览位置盖进度遮罩（字节到 100 只算 99，服务器确认后才落 100 并停留约 150ms），
 * 失败 / 取消立即撤掉遮罩。
 */
async function pickDefaultCover(): Promise<void> {
  if (coverBusy.value) return;
  coverBusy.value = true;
  try {
    const stored = await device.importMedia('image');
    if (!stored?.url) {
      toast(t('admin.media.unreadableImage'), 'error');
      return;
    }
    coverProgress.value = 0;
    form.defaultCover = await publishImportedMedia('image', stored, (percent) => {
      coverProgress.value = Math.min(99, Math.max(0, percent));
    });
    coverProgress.value = 100;
  } catch (reason) {
    coverProgress.value = null;
    // 用户在系统选择器点了取消：按稳定错误码判断，不提示错误。
    if (reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled') return;
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    coverBusy.value = false;
  }
}

/** 上限表单的数值读取：空输入按 0 处理，后端会把 0 夹到合法区间。 */
function numberField(key: string): number {
  return Number(form.limits[key]) || 0;
}

async function saveSettings(): Promise<void> {
  settingsError.value = '';
  const checks: Array<[string, string]> = [
    [
      t('admin.settings.brandZh'),
      check(form.brand.zh, { label: t('admin.settings.brandZh'), required: true, max: 20 }),
    ],
    [
      t('admin.settings.brandEn'),
      check(form.brand.en, {
        label: t('admin.settings.brandEn'),
        required: true,
        max: 24,
        pattern: titleEnPattern,
        patternMessage: t('admin.settings.brandEnCharset'),
      }),
    ],
    [
      COPY.avatarFormats,
      check(form.avatarFormats, {
        label: COPY.avatarFormats,
        required: true,
        max: 80,
        pattern: formatPattern,
        patternMessage: t('admin.media.imageSuffixPattern'),
        custom: (value) =>
          value
            .split(',')
            .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
            .filter(Boolean)
            .some((item) => !/^(jpg|jpeg|png|webp)$/.test(item))
            ? COPY.avatarFormatsInvalid
            : '',
      }),
    ],
    [
      t('admin.media.imageFormats'),
      check(form.imageFormats, {
        label: t('admin.media.imageFormats'),
        max: 120,
        pattern: formatPattern,
        patternMessage: t('admin.media.imageSuffixPattern'),
      }),
    ],
    [
      t('admin.media.videoFormats'),
      check(form.videoFormats, {
        label: t('admin.media.videoFormats'),
        max: 120,
        pattern: formatPattern,
        patternMessage: t('admin.media.videoSuffixPattern'),
      }),
    ],
    [
      t('admin.settings.accent'),
      check(form.themeAccent, {
        label: t('admin.settings.accent'),
        required: true,
        max: 7,
        pattern: /^#[0-9A-Fa-f]{6}$/,
        patternMessage: t('admin.settings.accentInvalid'),
      }),
    ],
    // 用户协议：开启时正文不能为空（服务端也会拒）；超长同样在本地先拦，不用等一轮请求。
    [
      t('admin.settings.agreement'),
      form.agreement.enabled && !form.agreement.content.trim()
        ? t('admin.settings.agreementContentRequired')
        : form.agreement.content.length > AGREEMENT_MAX_CHARS
          ? t('admin.settings.agreementTooLong', { max: AGREEMENT_MAX_CHARS })
          : '',
    ],
  ];
  for (const [, message] of checks) {
    if (message) {
      settingsError.value = message;
      toast(message, 'error');
      return;
    }
  }
  settingsSaving.value = true;
  try {
    const payload: JsonObject = {
      appTitleZh: form.brand.zh.trim(),
      appTitleEn: form.brand.en.trim(),
      themeAccent: form.themeAccent.trim(),
      announcement: form.announcement.trim(),
      announcementEnabled: form.announcementEnabled,
      categories: form.categories
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      canRevise: form.canRevise,
      canReviseAttended: form.canReviseAttended,
      imageCount: Number(form.imageCount) || 0,
      imageSizeMb: Number(form.imageSizeMb) || 0,
      videoCount: Number(form.videoCount) || 0,
      videoSizeMb: Number(form.videoSizeMb) || 0,
      avatarSizeMb: Number(form.avatarSizeMb) || 0,
      avatarFormats: form.avatarFormats.trim(),
      imageFormats: form.imageFormats.trim(),
      videoFormats: form.videoFormats.trim(),
      defaultCover: form.defaultCover.trim(),
      maxFutureExhibitions: Number(form.maxFutureExhibitions) || 0,
      maxFutureMeetings: Number(form.maxFutureMeetings) || 0,
      maxExhibitionDays: Number(form.maxExhibitionDays) || 0,
      inviteUses: Number(form.inviteUses) || 1,
      inviteValidHours: Number(form.inviteValidHours) || 0,
      inviteDurationDays: Number(form.inviteDurationDays) || 0,
      storageMb: Number(form.storageMb) || 0,
      whenFull: form.whenFull,
      // 日志上限：整数 MB，范围 1～10240（服务端会再收敛一次）。
      logs: { storageMb: clampLogsMb(form.logs.storageMb) },
      download: {
        source: form.download.source,
        url: form.download.url.trim(),
        repo: form.download.repo.trim(),
      },
      // 用户协议：正文变化时服务端自增版本并写更新时间；只开关不升版本。
      agreement: {
        enabled: form.agreement.enabled === true,
        content: form.agreement.content,
      },
      // 匿名报名姓名同义词：一行一个，空行忽略；空数组表示不合并姓名表单。
      registrationNameFieldTitles: form.registrationNameFieldTitles
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    };
    for (const item of LIMIT_ITEMS) payload[item.key] = numberField(item.key);

    const saved = await api.settings.save(payload);
    if (saved?.ok !== true) {
      settingsError.value = String(saved?.error || t('admin.settings.saveFailed'));
      toast(settingsError.value, 'error');
      return;
    }
    const settings = (saved.settings ?? {}) as JsonObject;
    // 设置接口的上传段叫 `upload`，启动数据里同一段叫 `server`。裁剪导出要立刻读到新的头像格式。
    const upload = settings.upload;
    const uploadObject = upload && typeof upload === 'object' && !Array.isArray(upload) ? (upload as JsonObject) : null;
    const server = uploadObject
      ? {
          avatarFormats: uploadObject.avatarFormats,
          avatarSizeMb: uploadObject.avatarSizeMb,
          imageFormats: uploadObject.imageFormats,
          videoFormats: uploadObject.videoFormats,
        }
      : settings.server;
    applyRuntimeBootstrap({
      ...settings,
      server,
      user: session.user,
      loggedIn: session.loggedIn,
    } as unknown as Bootstrap);
    fillForm(settings);
    toast(t('admin.settings.saved'), 'success');
  } catch (reason) {
    settingsError.value = reason instanceof Error ? reason.message : String(reason);
    toast(settingsError.value, 'error');
  } finally {
    settingsSaving.value = false;
  }
}

const canEditSettings = computed(() => session.user.can?.admin === true || session.role === 'admin');

async function generateInvite(): Promise<void> {
  if (inviteBusy.value) return;
  inviteBusy.value = true;
  settingsError.value = '';
  try {
    const result = await api.settings.createInvite({
      uses: Number(form.inviteUses) || 1,
      validHours: Number(form.inviteValidHours) || 0,
      durationDays: Number(form.inviteDurationDays) || 0,
    });
    if (result?.ok !== true) {
      settingsError.value = String(result?.error || t('admin.settings.saveFailed'));
      toast(settingsError.value, 'error');
      return;
    }
    const settings = (result.settings ?? {}) as JsonObject;
    if (settings.invite || settings.invites) fillForm(settings);
    toast(t('admin.invites.generated'), 'success');
  } catch (reason) {
    settingsError.value = reason instanceof Error ? reason.message : String(reason);
    toast(settingsError.value, 'error');
  } finally {
    inviteBusy.value = false;
  }
}

async function revokeInvite(id: string): Promise<void> {
  if (inviteBusy.value) return;
  inviteBusy.value = true;
  try {
    const result = await api.settings.revokeInvite(id);
    if (result?.ok !== true) {
      toast(String(result?.error || t('admin.settings.saveFailed')), 'error');
      return;
    }
    if (Array.isArray(result.invites)) {
      invites.value = result.invites.map((item) => {
        const row = (item ?? {}) as JsonObject;
        return {
          id: String(row.id ?? ''),
          code: String(row.code ?? ''),
          maxUses: Number(row.maxUses) || 0,
          usedCount: Number(row.usedCount) || 0,
          durationDays: Number(row.durationDays) || 0,
          expiresAt: String(row.expiresAt ?? ''),
          status: String(row.status ?? ''),
        };
      });
    }
    toast(t('admin.invites.revoked'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    inviteBusy.value = false;
  }
}

async function copyInvite(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    toast(t('admin.invites.copied'), 'success');
  } catch {
    openSheet({
      title: t('admin.invites.copy'),
      message: code,
      actions: [{ label: t('common.cancel'), onClick: (close) => close() }],
    });
  }
}
</script>

<template>
  <!-- 顶栏已经写着「管理后台」，正文不再重复这四个字。忙碌时只留一枚状态胶囊。 -->
  <div v-if="panelBusy" class="row">
    <span class="pill">{{ t('admin.settings.loadingSecurity') }}</span>
  </div>

  <SegControl :model-value="tab" :items="TABS" :label="t('admin.sections')" @update:model-value="changeTab" />

  <!-- ── 用户管理 ─────────────────────────────────────────────── -->
  <AdminUsersSection
    v-if="tab === 'users'"
    :users="users"
    :user-items="userItems"
    :query="query"
    :role-filter="userRoleFilter"
    :status-filter="userStatusFilter"
    :copy="usersCopy"
    @retry="loadUsers"
    @search="onSearch"
    @change-role="changeUserRole"
    @change-status="changeUserStatus"
    @open-public="openPublic"
    @manage="manageUser"
    @adjust-role="manageRole"
    @disable-two-factor="disableTwoFactor"
    @open-exhibitions="openUserExhibitions"
    @open-meetings="openUserMeetings"
  />

  <!-- ── 展会管理 ─────────────────────────────────────────────── -->
  <AdminExhibitionsSection
    v-else-if="tab === 'exhibitions'"
    :exhibitions="exhibitions"
    :exhibition-items="exhibitionItems"
    :query="query"
    @retry="loadExhibitions"
    @search="onSearch"
    @export="exportCsv"
    @changed="loadExhibitions"
  />

  <!-- ── 服务器设置 ───────────────────────────────────────────── -->
  <AdminSettingsSection
    v-else
    :form="form"
    :settings-query="settingsQuery"
    :loaded="loaded"
    :settings-error="settingsError"
    :settings-saving="settingsSaving"
    :cover-busy="coverBusy"
    :cover-progress="coverProgress"
    :can-edit-settings="canEditSettings"
    :storage-full="storageFull"
    :storage-percent="storagePercent"
    :storage-caption="storageCaption"
    :logs-usage="logsUsage"
    :storage-policies="storagePolicies"
    :limit-groups="LIMIT_GROUPS"
    :pair-limits="pairLimits"
    :copy="settingsCopy"
    :invites="invites"
    :agreement-version="agreementVersion"
    :agreement-updated-at="agreementUpdatedAt"
    :invite-busy="inviteBusy"
    @retry="loadSettings"
    @save="saveSettings"
    @pick-cover="pickDefaultCover"
    @cover-settled="coverProgress = null"
    @generate="generateInvite"
    @revoke="revokeInvite"
    @copy="copyInvite"
    @open-logs="openLogs"
  />
</template>

<style></style>
