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
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import type { SheetAction } from '@/services/sheet';
import { check } from '@/services/validate';
import { statusTone } from '@/services/status';
import { truncate } from '@/services/format';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import SegControl from '@/components/SegControl.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import AdminExhibitionCard from '@/components/AdminExhibitionCard.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import type { Bootstrap, Exhibition, JsonObject, User } from '@/api/types';
import { t } from '@/i18n';

const USER_STATUSES = [t('admin.users.normal'), t('admin.users.restricted'), t('admin.users.banned')];

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
const users = useAsync<User[]>();
const exhibitions = useAsync<Exhibition[]>();
const settingsQuery = useAsync<JsonObject>();

/** 服务端设置的可编辑副本：一次取回，保存时整体回填。 */
const form = reactive({
  brand: { zh: '', en: '' },
  announcement: '',
  announcementEnabled: false,
  categories: '',
  canRevise: false,
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
  /** 服务器存储上限，单位 MB */
  storageMb: 1024,
  /** 存满以后：拒绝新上传，或删掉最早的文件 */
  whenFull: 'reject' as 'reject' | 'evict-oldest',
});

/** 管理页自己的文案：提示与开关说明放在这里，提取脚本会换成文案 key。 */
const COPY = {
  coverTitle: t('admin.media.defaultCover'),
  coverHint: t('admin.media.defaultCoverFallback'),
  limitIntro: t('admin.limits.charCapIntro'),
  exhibitorLimit: t('admin.limits.concurrentExhibitions'),
  exhibitorLimitHint: t('admin.limits.concurrentExhibitionsRule'),
  meetingLimit: t('admin.limits.concurrentMeetings'),
  meetingLimitHint: t('admin.limits.concurrentMeetingsRule'),
  manageExhibitions: t('admin.users.manageExhibitions'),
  manageMeetings: t('admin.users.manageMeetings'),
  adjustStatus: t('admin.users.adjustStatus'),
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
const storageUsage = ref({ usedBytes: 0, limitBytes: 1024 * 1024 * 1024, fileCount: 0 });
const storagePolicies = [
  { value: 'reject', label: COPY.storageReject },
  { value: 'evict-oldest', label: COPY.storageEvict },
];
const coverBusy = ref(false);
const settingsError = ref('');
const settingsSaving = ref(false);
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
  return users.run(() => api.users.list({ query: query.value }));
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

/** URL 里的分区 id；非法或缺省时回到第一个分区。 */
function tabFromQuery(): string {
  const value = String(route.query.tab ?? '');
  return tabIds.has(value) ? value : (TABS[0]?.value ?? '');
}

// 从二级页返回、或用户直接改地址栏时，让分区跟着 URL 走。
watch(
  () => route.fullPath,
  () => {
    window.clearTimeout(searchTimer);
    if (route.path !== '/admin') return;
    const next = tabFromQuery();
    if (next !== tab.value) {
      tab.value = next;
      // 搜索词跟着分区走：换分区后旧的筛选不再适用。
      query.value = '';
    }
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

function manageUser(user: User): void {
  const actions: SheetAction[] = USER_STATUSES.map((status) => ({
    label: status,
    variant: user.status === status ? 'primary' : 'ghost',
    onClick: async (close) => {
      close();
      await updateUserStatus(user, status);
    },
  }));
  // 不放「取消」：点遮罩、按返回或 Esc 都能关，面板里多一个取消只会让状态选项更不显眼。
  openSheet({
    title: `调整 ${user.nickname} 的状态`,
    message: `${user.role} · 注册于 ${user.registrationTime || t('admin.users.unknown')}`,
    actions,
    layout: 'stack',
  });
}

async function updateUserStatus(user: User, status: string): Promise<void> {
  try {
    // 写接口统一返回 { ok, error }：只判断整个响应是否为真会把失败也当成成功。
    const result = await api.users.setStatus(String(user.id ?? ''), status);
    const ok = result?.ok === true;
    toast(
      String(ok ? `已将 ${user.nickname} 设为${status}` : result?.error || t('admin.users.updateFailed')),
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
    message: `关闭后 ${user.nickname} 登录时只校验密码。请确认这是账号本人提出的请求。`,
    confirmLabel: t('common.close'),
    tone: 'danger',
    onConfirm: async () => {
      try {
        const result = await api.users.disableTwoFactor(String(user.id ?? ''));
        const ok = result?.ok === true;
        toast(
          String(ok ? `已关闭 ${user.nickname} 的两步验证` : result?.error || t('admin.users.updateFailed')),
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
      String(item.modeLabel ?? item.status ?? ''),
      String(item.category ?? ''),
      String(item.description ?? '').replace(/\n/g, ' '),
    ]),
  ];
  // 带 BOM，Excel 打开中文表头才不会乱码。
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  const filename = 'exhibitions.csv';
  try {
    await device.exportCsv(filename, content);
    toast(`已导出 ${exhibitionItems.value.length} 行到 ${filename}`, 'success');
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
  form.announcement = String(announcement.text ?? '');
  form.announcementEnabled = announcement.enabled === true;
  form.categories = (Array.isArray(data.categories) ? data.categories : []).map((item) => String(item)).join('\n');
  form.canRevise = review.canRevise === true;
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
  form.storageMb = Number(upload.storageMb ?? 1024);
  form.whenFull = upload.whenFull === 'evict-oldest' ? 'evict-oldest' : 'reject';
  const storage = (data.storage ?? {}) as JsonObject;
  const limitBytes = Number(storage.limitBytes);
  storageUsage.value = {
    usedBytes: Number(storage.usedBytes) || 0,
    limitBytes: Number.isFinite(limitBytes) && limitBytes > 0 ? limitBytes : form.storageMb * 1024 * 1024,
    fileCount: Number(storage.fileCount) || 0,
  };
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
const storageCaption = computed(
  () =>
    `${t('admin.media.used')} ${formatStorage(storageUsage.value.usedBytes)} / ${formatStorage(storageUsage.value.limitBytes)}`,
);

/**
 * 缺省封面：先在设备上选择，再上传到服务器。
 * 只改表单里的值，点「保存设置」才落库。
 */
async function pickDefaultCover(): Promise<void> {
  coverBusy.value = true;
  try {
    const stored = await device.importMedia('image');
    if (!stored?.url) {
      toast(t('admin.media.unreadableImage'), 'error');
      return;
    }
    form.defaultCover = await publishImportedMedia('image', stored);
  } catch (reason) {
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
      announcement: form.announcement.trim(),
      announcementEnabled: form.announcementEnabled,
      categories: form.categories
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      canRevise: form.canRevise,
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
      storageMb: Number(form.storageMb) || 0,
      whenFull: form.whenFull,
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
</script>

<template>
  <!-- 顶栏已经写着「管理后台」，正文不再重复这四个字。忙碌时只留一枚状态胶囊。 -->
  <div v-if="panelBusy" class="row">
    <span class="pill">{{ t('admin.settings.loadingSecurity') }}</span>
  </div>

  <SegControl :model-value="tab" :items="TABS" :label="t('admin.sections')" @update:model-value="changeTab" />

  <!-- ── 用户管理 ─────────────────────────────────────────────── -->
  <template v-if="tab === 'users'">
    <SkeletonBlock v-if="users.loading.value && users.data.value === undefined" :rows="3" />
    <StateBlock
      v-else-if="users.error.value && users.data.value === undefined"
      tone="error"
      :title="t('common.loadFailed')"
      :description="users.error.value.message"
      :action-label="t('common.retry')"
      @action="loadUsers"
    />
    <template v-else>
      <div class="row" data-between="true">
        <span class="section-label">{{ t('admin.users.manage') }}</span>
        <span class="pill">{{ `${userItems.length} 位用户` }}</span>
      </div>
      <div class="field">
        <label for="admin-user-search">{{ t('admin.users.search') }}</label>
        <input
          id="admin-user-search"
          class="input"
          type="search"
          autocomplete="off"
          :placeholder="t('admin.users.searchPlaceholder')"
          @input="onSearch(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div v-if="users.error.value" class="notice" data-tone="accent">
        <span>{{ users.error.value.message }}</span>
      </div>

      <StateBlock
        v-if="userItems.length === 0"
        :title="query ? `没有找到与“${query}”相关的用户` : t('admin.users.empty')"
      />
      <div v-else class="list" data-gap="sm" :data-busy="users.loading.value ? 'true' : undefined">
        <div v-for="user in userItems" :key="String(user.id)" class="card">
          <button
            class="row-card"
            type="button"
            data-pressable="true"
            style="border: 0; padding: 0; background: transparent; width: 100%"
            :aria-label="`查看 ${user.nickname} 的公开页`"
            @click="openPublic(user)"
          >
            <AvatarBox :name="String(user.nickname || '')" />
            <span class="row-copy">
              <span class="name-line">
                <strong class="row-title truncate">{{ user.nickname }}</strong>
                <RoleTag :role-code="String(user.roleCode || '')" />
              </span>
              <span class="row-meta">{{
                `${user.status} · 最近登录 ${user.lastLoginTime || t('admin.users.unknown')}`
              }}</span>
              <span class="row-meta truncate">{{ truncate(user.email, 40) }}</span>
              <span v-if="user.twoFactorEnabled === true" class="row-meta">{{
                t('admin.users.twoFactorEnabled')
              }}</span>
            </span>
            <StatusTag :text="String(user.status || '')" :tone="statusTone(String(user.status || ''))" />
          </button>
          <div class="action-row">
            <button class="cta ghost" data-size="small" type="button" @click="manageUser(user)">
              {{ COPY.adjustStatus }}
            </button>
            <template v-if="user.roleCode === 'exhibitor' || user.roleCode === 'admin'">
              <button
                class="cta ghost"
                data-size="small"
                type="button"
                @click="router.push(`/admin/exhibitions/${encodeURIComponent(String(user.id ?? ''))}`)"
              >
                {{ COPY.manageExhibitions }}
              </button>
              <button
                class="cta ghost"
                data-size="small"
                type="button"
                @click="router.push(`/admin/meetings/${encodeURIComponent(String(user.id ?? ''))}`)"
              >
                {{ COPY.manageMeetings }}
              </button>
            </template>
          </div>
          <!-- 兜底出口：用户邮箱用不了（离职、邮箱被回收）时，只有管理员能帮他关掉两步验证 -->
          <button
            v-if="user.twoFactorEnabled === true"
            class="cta ghost"
            data-size="small"
            type="button"
            @click="disableTwoFactor(user)"
          >
            {{ t('admin.users.disableTwoFactor') }}
          </button>
        </div>
      </div>
    </template>
  </template>

  <!-- ── 展会管理 ─────────────────────────────────────────────── -->
  <template v-else-if="tab === 'exhibitions'">
    <SkeletonBlock v-if="exhibitions.loading.value && exhibitions.data.value === undefined" :rows="3" />
    <StateBlock
      v-else-if="exhibitions.error.value && exhibitions.data.value === undefined"
      tone="error"
      :title="t('common.loadFailed')"
      :description="exhibitions.error.value.message"
      :action-label="t('common.retry')"
      @action="loadExhibitions"
    />
    <template v-else>
      <div class="field">
        <label for="admin-exhibition-search">{{ t('admin.exhibitions.search') }}</label>
        <input
          id="admin-exhibition-search"
          class="input"
          type="search"
          autocomplete="off"
          :placeholder="t('admin.exhibitions.searchPlaceholder')"
          @input="onSearch(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row" data-between="true">
        <span class="section-label">{{ t('admin.exhibitions.all') }}</span>
        <span class="pill">{{ `${exhibitionItems.length} 个展会` }}</span>
      </div>
      <div v-if="exhibitions.error.value" class="notice" data-tone="accent">
        <span>{{ exhibitions.error.value.message }}</span>
      </div>

      <StateBlock
        v-if="exhibitionItems.length === 0"
        icon="search"
        :title="query ? `没有找到与“${query}”相关的展会` : t('admin.exhibitions.empty')"
        :description="query ? t('admin.exhibitions.tryAnotherKeyword') : t('admin.exhibitions.shownWhenCreated')"
      />
      <div v-else class="list" data-gap="sm" :data-busy="exhibitions.loading.value ? 'true' : undefined">
        <AdminExhibitionCard
          v-for="item in exhibitionItems"
          :key="String(item.id)"
          :item="item"
          @changed="loadExhibitions"
        />
      </div>

      <button class="cta ghost" type="button" :disabled="exhibitionItems.length === 0" @click="exportCsv">
        {{ t('admin.exhibitions.exportCsv') }}
      </button>
    </template>
  </template>

  <!-- ── 服务器设置 ───────────────────────────────────────────── -->
  <template v-else>
    <SkeletonBlock v-if="settingsQuery.loading.value && !loaded" :rows="4" />
    <StateBlock
      v-else-if="settingsQuery.error.value && !loaded"
      tone="error"
      :title="t('common.loadFailed')"
      :description="settingsQuery.error.value.message"
      :action-label="t('common.retry')"
      @action="loadSettings"
    />
    <template v-else>
      <div class="notice" data-tone="accent">
        <strong>{{ t('admin.settings.server') }}</strong>
        <span>{{ t('admin.settings.serverScope') }}</span>
      </div>

      <div class="card">
        <span class="section-label">{{ COPY.storageTitle }}</span>
        <div class="storage-meter" :data-full="storageFull ? 'true' : 'false'">
          <span :style="{ width: `${storagePercent}%` }" />
        </div>
        <p class="field-hint">{{ storageCaption }}</p>
        <p class="field-hint">{{ COPY.storageHint }}</p>
        <div class="field">
          <label for="settings-storage-mb">{{ COPY.storageLimit }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-storage-mb"
              v-model.number="form.storageMb"
              class="input"
              type="number"
              min="64"
              max="10240"
              inputmode="numeric"
            />
            <span class="row-meta">MB</span>
          </div>
        </div>
        <div class="field">
          <label id="settings-storage-policy">{{ COPY.storageWhenFull }}</label>
          <SegControl
            :model-value="form.whenFull"
            :items="storagePolicies"
            :label="COPY.storageWhenFull"
            @update:model-value="form.whenFull = $event === 'evict-oldest' ? 'evict-oldest' : 'reject'"
          />
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.settings.brand') }}</span>
        <div class="field">
          <label for="settings-title-zh">{{ t('admin.settings.brandZh') }}</label>
          <input
            id="settings-title-zh"
            v-model="form.brand.zh"
            class="input"
            type="text"
            maxlength="20"
            :placeholder="t('admin.settings.brandZhPlaceholder')"
          />
        </div>
        <div class="field">
          <label for="settings-title-en">{{ t('admin.settings.brandEn') }}</label>
          <input
            id="settings-title-en"
            v-model="form.brand.en"
            class="input"
            type="text"
            maxlength="24"
            :placeholder="t('admin.settings.brandEnPlaceholder')"
          />
        </div>
      </div>

      <!-- 缺省展会封面：展会自己没有封面时用它替掉占位图；留空即回到占位图 -->
      <div class="card">
        <span class="section-label">{{ COPY.coverTitle }}</span>
        <div class="hero ph-img hero-compact">
          <img v-if="form.defaultCover" :src="form.defaultCover" :alt="COPY.coverTitle" />
        </div>
        <div class="row" data-gap="md">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            style="flex: 1 1 0"
            :disabled="coverBusy"
            :data-loading="coverBusy ? 'true' : 'false'"
            @click="pickDefaultCover"
          >
            {{ form.defaultCover ? t('admin.media.changeCover') : t('admin.media.uploadCover') }}
          </button>
          <button
            v-if="form.defaultCover"
            class="cta ghost"
            data-size="small"
            type="button"
            style="flex: 1 1 0"
            @click="form.defaultCover = ''"
          >
            {{ t('admin.media.removeCover') }}
          </button>
        </div>
        <p class="field-hint">{{ COPY.coverHint }}</p>
      </div>

      <!-- 展商端策略：单个展商可同时筹备的展会数 -->
      <div class="card">
        <span class="section-label">{{ COPY.exhibitorLimit }}</span>
        <div class="field">
          <div class="row" data-gap="md">
            <input
              id="settings-max-future-exhibitions"
              v-model.number="form.maxFutureExhibitions"
              class="input"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="row-meta">{{ t('admin.limits.items') }}</span>
          </div>
          <p class="field-hint">{{ COPY.exhibitorLimitHint }}</p>
        </div>
        <div class="field">
          <label for="settings-max-future-meetings">{{ COPY.meetingLimit }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-max-future-meetings"
              v-model.number="form.maxFutureMeetings"
              class="input"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="row-meta">{{ t('admin.limits.items') }}</span>
          </div>
          <p class="field-hint">{{ COPY.meetingLimitHint }}</p>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.announce.entry') }}</span>
        <textarea id="settings-announcement" v-model="form.announcement" class="textarea" rows="3" />
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('admin.announce.showOnEntry') }}</strong>
          </span>
          <label class="switch" for="settings-announcement-enabled">
            <input id="settings-announcement-enabled" v-model="form.announcementEnabled" type="checkbox" />
            <span />
          </label>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.settings.categories') }}</span>
        <textarea id="settings-categories" v-model="form.categories" class="textarea" rows="4" />
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.settings.reviewPolicy') }}</span>
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('admin.settings.allowReviseDecided') }}</strong>
          </span>
          <label class="switch" for="settings-revise">
            <input id="settings-revise" v-model="form.canRevise" type="checkbox" />
            <span />
          </label>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.media.richMedia') }}</span>
        <div class="field">
          <label for="settings-image-count">{{ t('admin.media.imagesPerPost') }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-image-count"
              v-model.number="form.imageCount"
              class="input"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="row-meta">{{ t('admin.media.sheets') }}</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-image-size">{{ t('admin.media.imageSize') }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-image-size"
              v-model.number="form.imageSizeMb"
              class="input"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="row-meta">MB</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-video-count">{{ t('admin.media.videoCount') }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-video-count"
              v-model.number="form.videoCount"
              class="input"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="row-meta">{{ t('admin.limits.items') }}</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-video-size">{{ t('admin.media.videoSize') }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-video-size"
              v-model.number="form.videoSizeMb"
              class="input"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="row-meta">MB</span>
          </div>
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.media.uploadFormats') }}</span>
        <div class="field">
          <label for="settings-image-formats">{{ t('admin.media.imageSuffixes') }}</label>
          <input
            id="settings-image-formats"
            v-model="form.imageFormats"
            class="input"
            type="text"
            maxlength="120"
            placeholder="jpg,jpeg,png,webp"
          />
        </div>
        <div class="field">
          <label for="settings-video-formats">{{ t('admin.media.videoSuffixes') }}</label>
          <input
            id="settings-video-formats"
            v-model="form.videoFormats"
            class="input"
            type="text"
            maxlength="120"
            placeholder="mp4,mov,webm"
          />
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ COPY.avatarSection }}</span>
        <div class="field">
          <label for="settings-avatar-size">{{ t('admin.media.avatarSize') }}</label>
          <div class="row" data-gap="md">
            <input
              id="settings-avatar-size"
              v-model.number="form.avatarSizeMb"
              class="input"
              type="number"
              min="1"
              max="20"
              inputmode="numeric"
            />
            <span class="row-meta">MB</span>
          </div>
        </div>
        <div class="field">
          <label for="settings-avatar-formats">{{ COPY.avatarFormats }}</label>
          <input
            id="settings-avatar-formats"
            v-model="form.avatarFormats"
            class="input"
            type="text"
            maxlength="80"
            placeholder="jpg,jpeg,png,webp"
          />
        </div>
      </div>

      <div class="card">
        <span class="section-label">{{ t('admin.limits.formChars') }}</span>
        <p class="field-hint">{{ COPY.limitIntro }}</p>
        <div v-for="group in LIMIT_GROUPS" :key="group.id" class="limit-group">
          <span class="limit-group-title">{{ group.title }}</span>
          <div
            v-for="(row, rowIndex) in pairLimits(group.items)"
            :key="`${group.id}-${rowIndex}`"
            :class="row.length > 1 ? 'grid-cols-2' : undefined"
          >
            <div v-for="item in row" :key="item.key" class="field">
              <label :for="`limit-${item.key}`">{{ item.label }}</label>
              <div class="row" data-gap="md">
                <input
                  :id="`limit-${item.key}`"
                  v-model.number="form.limits[item.key]"
                  class="input"
                  type="number"
                  min="0"
                  inputmode="numeric"
                />
                <span class="row-meta">{{ item.unit }}</span>
              </div>
              <p class="field-hint">{{ item.hint }}</p>
            </div>
          </div>
        </div>
      </div>

      <p v-if="settingsError" class="field-error" role="alert">{{ settingsError }}</p>
      <button
        class="cta"
        type="button"
        :disabled="settingsSaving || !canEditSettings"
        :data-loading="settingsSaving ? 'true' : 'false'"
        @click="saveSettings"
      >
        {{ t('admin.settings.save') }}
      </button>
    </template>
  </template>
</template>
