<script setup lang="ts">
/**
 * 管理后台「设置」分区。
 *
 * 纯展示 + 事件回抛：取数、校验、保存与上传都留在 AdminPage。
 * 表单是 AdminPage 里的 reactive 对象，作为普通 prop 下传；子组件只改它的嵌套字段，
 * 不整体替换，因此父组件不需要处理 update:modelValue（也避免 v-model 对 const 绑定的改写）。
 */
import AppIcon from '@/components/AppIcon.vue';
import HintNote from '@/components/HintNote.vue';
import SegControl from '@/components/SegControl.vue';
import UploadProgressMask from '@/components/upload-progress-mask.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import { computed, ref, type Ref } from 'vue';
import type { JsonObject } from '@/api/types';
import { useHint } from '@/composables/useHint';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { formatLocalChineseDate } from '@/services/format';
import { t } from '@/i18n';

interface LimitItem {
  key: string;
  label: string;
  hint: string;
  unit: string;
}

/** 与 AdminPage 里那份 reactive 表单同形；嵌套字段由子组件直接改。 */
interface AdminSettingsForm {
  brand: { zh: string; en: string };
  /** 管理端下发的首色调（#RRGGBB），同时覆盖色板下标 0。 */
  themeAccent: string;
  announcement: string;
  announcementEnabled: boolean;
  categories: string;
  canRevise: boolean;
  canReviseAttended: boolean;
  imageCount: number;
  imageSizeMb: number;
  videoCount: number;
  videoSizeMb: number;
  avatarSizeMb: number;
  avatarFormats: string;
  imageFormats: string;
  videoFormats: string;
  limits: Record<string, number>;
  defaultCover: string;
  maxFutureExhibitions: number;
  maxFutureMeetings: number;
  /** 单个展会最长持续天数（按开展～闭展算）；0 表示不限 */
  maxExhibitionDays: number;
  storageMb: number;
  whenFull: 'reject' | 'evict-oldest';
  /** 操作日志的存储上限，单位 MB（超过后服务端自动清掉最早的日志） */
  logs: { storageMb: number };
  inviteUses: number;
  inviteValidHours: number;
  /** 兑换后展商身份保留的天数；0 表示永久 */
  inviteDurationDays: number;
  /** 软件包下载源：直链/目录或 GitHub 仓库（owner/repo） */
  download: { source: 'url' | 'github'; url: string; repo: string };
  /** 用户协议：开关与 Markdown 正文（保存时随其它设置一起提交） */
  agreement: { enabled: boolean; content: string };
  /** 匿名报名姓名同义词：一行一个标题，保存时拆成数组提交 */
  registrationNameFieldTitles: string;
}

interface InviteItem {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  /** 兑换后展商身份保留的天数；0 表示永久 */
  durationDays: number;
  expiresAt: string;
  status: string;
}

const props = defineProps<{
  form: AdminSettingsForm;
  settingsQuery: { data: Ref<JsonObject | undefined>; error: Ref<Error | undefined>; loading: Ref<boolean> };
  loaded: boolean;
  settingsError: string;
  settingsSaving: boolean;
  coverBusy: boolean;
  /** 缺省封面上传进度（0–100）；null 表示没有上传在跑。 */
  coverProgress: number | null;
  /**
   * 上传期间先占住预览槽位的本机副本；空串 / 缺省表示照旧显示 `form.defaultCover`。
   * 遮罩是「由下至上变亮」，已上传的那一段要透出刚选的图，不能是旧封面或占位图。
   */
  coverPreview?: string;
  canEditSettings: boolean;
  storageFull: boolean;
  storagePercent: number;
  storageCaption: string;
  /** 日志当前用量：只有管理端设置接口会带；没有数据时卡片只显示「—」 */
  logsUsage: { usedBytes: number; entryCount: number; hasUsage: boolean };
  storagePolicies: { value: string; label: string }[];
  limitGroups: Array<{ id: string; title: string; items: LimitItem[] }>;
  pairLimits: (items: LimitItem[]) => LimitItem[][];
  copy: {
    coverTitle: string;
    coverHint: string;
    limitIntro: string;
    exhibitorSection: string;
    exhibitorLimit: string;
    exhibitorLimitHint: string;
    meetingLimit: string;
    meetingLimitHint: string;
    maxExhibitionDays: string;
    maxExhibitionDaysHint: string;
    avatarSection: string;
    avatarFormats: string;
    storageTitle: string;
    storageHint: string;
    storageLimit: string;
    storageWhenFull: string;
  };
  invites: InviteItem[];
  inviteBusy: boolean;
  /** 用户协议当前生效的版本与更新时间（来自 settings 接口，保存后由父组件回填） */
  agreementVersion: number;
  agreementUpdatedAt: string;
}>();
const emit = defineEmits<{
  retry: [];
  save: [];
  'pick-cover': [];
  /** 100% 停留结束，父组件据此清掉进度、卸载遮罩。 */
  'cover-settled': [];
  generate: [];
  revoke: [id: string];
  copy: [code: string];
  /** 「查看最近日志」：列表在二级页 /logs，设置页只在日志卡下面放入口按钮。 */
  'open-logs': [];
}>();

// ── 设置分组：按任务把同一批卡片收成六组 ────────────────────────

/**
 * 分组只决定「现在显示哪几张卡」，不新开表单：
 * - 每张卡仍绑定同一个 `props.form`，保存入口仍是右下角那一颗悬浮按钮；
 * - 用 `v-show` 而不是 `v-if`：切走再切回时，已填但还没保存的输入、协议选中的
 *   文件说明与错误提示都留在原处，不会因为重建 DOM 丢掉；
 * - 组名取 `admin.settings.group*`，顺序既是卡片在页面里的顺序，也是首次配置路线：
 *   服务器与容量 → 品牌与进入公告 → 展会与报名规则 → 账号准入（用户协议 / 邀请码）→
 *   媒体与字段限制 → 应用下载。
 */
const GROUPS = [
  { id: 'server', labelPath: 'admin.settings.groupServer' },
  { id: 'brand', labelPath: 'admin.settings.groupBrand' },
  { id: 'exhibitions', labelPath: 'admin.settings.groupExhibitions' },
  { id: 'accounts', labelPath: 'admin.settings.groupAccounts' },
  { id: 'media', labelPath: 'admin.settings.groupMedia' },
  { id: 'delivery', labelPath: 'admin.settings.groupDelivery' },
] as const;
type SettingsGroup = (typeof GROUPS)[number]['id'];

const activeGroup = ref<SettingsGroup>('server');
const groupNav = ref<HTMLElement>();

const groupItems = computed(() => GROUPS.map((group) => ({ id: group.id, label: t(group.labelPath) })));
const activeGroupIndex = computed(() =>
  Math.max(
    0,
    GROUPS.findIndex((group) => group.id === activeGroup.value),
  ),
);
const previousGroup = computed(() =>
  activeGroupIndex.value > 0 ? groupItems.value[activeGroupIndex.value - 1] : undefined,
);
const nextGroup = computed(() => groupItems.value[activeGroupIndex.value + 1]);

/** 这张卡属于当前分组吗：模板里每张卡按它决定是否显示。 */
function groupVisible(id: SettingsGroup): boolean {
  return activeGroup.value === id;
}

/**
 * 切组：只换显示，表单内容与本地状态都不动。
 * 切完把分组导航滚回视口顶部，否则停在上组末尾时看到的是下一组的中间。
 */
function setGroup(value: string): void {
  const target = GROUPS.find((group) => group.id === value);
  if (!target || target.id === activeGroup.value) return;
  activeGroup.value = target.id;
  requestAnimationFrame(() => {
    const node = groupNav.value;
    if (!node || typeof node.scrollIntoView !== 'function') return;
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  });
}

function shiftGroup(delta: number): void {
  const target = GROUPS[activeGroupIndex.value + delta];
  if (target) setGroup(target.id);
}

/** 首次进入设置的一次性路线提示：按账号记已读，访客不会走到这里（设置要求管理员）。 */
const { visible: hintVisible, dismiss: dismissHint } = useHint('admin-settings-route');

/** 下载源选项：直链直接填 APK 地址，GitHub 仓库由服务器追踪最新 Release。 */
const downloadSources = computed(() => [
  { value: 'url', label: t('admin.download.sourceUrl') },
  { value: 'github', label: t('admin.download.sourceGithub') },
]);

/** 过期和已删除的码由服务端清掉；这里再滤一次，避免缓存里的旧行继续占位。 */
const visibleInvites = computed(() =>
  props.invites.filter((item) => item.status !== 'expired' && item.status !== 'revoked'),
);

function inviteStatusLabel(status: string): string {
  if (status === 'exhausted') return t('admin.invites.exhausted');
  if (status === 'expired') return t('admin.invites.expired');
  if (status === 'revoked') return t('admin.invites.revoked');
  return t('admin.invites.available');
}

/** 展商时长：0 天是永久，其余按天显示。 */
function inviteDurationLabel(item: InviteItem): string {
  return item.durationDays > 0
    ? t('admin.invites.durationDays', { days: item.durationDays })
    : t('admin.invites.permanent');
}

// ── 日志上限与用量 ──────────────────────────────────────────────

const BYTES_PER_MB = 1024 * 1024;

/** 字节 → MB：与媒体容量卡一样保留一位小数。 */
function formatLogMb(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/**
 * 日志进度条：上限跟着表单里的输入走，管理员改小上限时比例立即变化。
 * 没有用量时（`hasUsage` 为假）模板不画进度条，只显示「—」。
 */
const logsMeter = computed(() => {
  const used = Math.max(0, Number(props.logsUsage.usedBytes) || 0);
  const limitMb = Math.max(1, Number(props.form.logs.storageMb) || 0);
  const limit = limitMb * BYTES_PER_MB;
  return {
    used,
    limit,
    percent: Math.min(100, Math.round((used / limit) * 100)),
    full: used >= limit,
  };
});

const logsUsageCaption = computed(() => {
  if (!props.logsUsage.hasUsage) return t('admin.settings.logsUsageUnknown');
  return t('admin.settings.logsUsage', {
    count: Math.max(0, Number(props.logsUsage.entryCount) || 0),
    used: formatLogMb(logsMeter.value.used),
    limit: formatLogMb(logsMeter.value.limit),
  });
});

// ── 用户协议：上传 Markdown 正文 ────────────────────────────────

/** 正文上限：与服务端一致（200000 字符；超过时服务端回 `settings.agreementTooLong`）。 */
const AGREEMENT_MAX_CHARS = 200_000;
/** 单个文件上限：1 MB，与原生选择器的 maxBytes 一致。 */
const AGREEMENT_MAX_BYTES = 1024 * 1024;

/** 本机是否有原生桥：应用里由原生读文件（WebView 关着文件访问），浏览器预览用 input + File.text()。 */
const hasNative = nativeBridge.hasNative();
/** 本次选中的文件名；从服务端载入的正文没有文件名，只显示字数。 */
const agreementFile = ref('');
const agreementError = ref('');
const agreementBusy = ref(false);

const agreementContent = computed(() => props.form.agreement.content);
const agreementCharCount = computed(() => agreementContent.value.length);
/** 摘要只取正文前几行，不在管理页整篇渲染（完整效果去协议浏览页看）。 */
const agreementSummary = computed(() =>
  agreementContent.value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n'),
);
const agreementMeta = computed(() => {
  const count = agreementCharCount.value;
  if (agreementFile.value) return t('admin.settings.agreementFileMeta', { name: agreementFile.value, count });
  return t('admin.settings.agreementFileMetaNoName', { count });
});

/** 当前版本与更新时间；还没上传过正文时给「还没有上传内容」。 */
const agreementVersionLabel = computed(() => {
  if (!props.agreementVersion) return t('admin.settings.agreementNotSet');
  const raw = String(props.agreementUpdatedAt ?? '');
  const date = formatLocalChineseDate(raw) || raw;
  return date
    ? t('admin.settings.agreementVersionValue', { version: props.agreementVersion, date })
    : t('admin.settings.agreementVersionOnly', { version: props.agreementVersion });
});

/** 读到的正文直接写进待保存表单；超长在这里拦下并保留原内容不变。 */
function applyAgreementContent(text: string, name: string): void {
  agreementError.value = '';
  if (text.length > AGREEMENT_MAX_CHARS) {
    agreementError.value = t('admin.settings.agreementTooLong', { max: AGREEMENT_MAX_CHARS });
    return;
  }
  props.form.agreement.content = text;
  agreementFile.value = name;
}

/** 应用内：原生把文件正文读出来回传；用户取消不算失败。 */
async function importAgreementFromDevice(): Promise<void> {
  agreementError.value = '';
  agreementBusy.value = true;
  try {
    const picked = await device.importText('text/markdown,text/plain', AGREEMENT_MAX_BYTES);
    applyAgreementContent(String(picked?.text ?? ''), String(picked?.fileName ?? ''));
  } catch (reason) {
    // 先看稳定错误码，不匹配文案（见 services/native-bridge.ts）。
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    agreementError.value = t('admin.settings.agreementReadFailed');
  } finally {
    agreementBusy.value = false;
  }
}

/** 浏览器预览：没有原生桥时才走这条路。 */
async function importAgreementFromFile(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  agreementError.value = '';
  if (file.size > AGREEMENT_MAX_BYTES) {
    agreementError.value = t('admin.settings.agreementTooLarge', { kb: AGREEMENT_MAX_BYTES / 1024 });
    return;
  }
  agreementBusy.value = true;
  try {
    applyAgreementContent(await file.text(), file.name);
  } catch {
    agreementError.value = t('admin.settings.agreementReadFailed');
  } finally {
    agreementBusy.value = false;
  }
}

function clearAgreementContent(): void {
  props.form.agreement.content = '';
  agreementFile.value = '';
  agreementError.value = '';
}
</script>

<template>
  <SkeletonBlock v-if="settingsQuery.loading.value && !loaded" :rows="4" />
  <StateBlock
    v-else-if="settingsQuery.error.value && !loaded"
    tone="error"
    :title="t('common.loadFailed')"
    :description="settingsQuery.error.value.message"
    :action-label="t('common.retry')"
    @action="emit('retry')"
  />
  <template v-else>
    <div class="notice" data-tone="accent">
      <strong>{{ t('admin.settings.server') }}</strong>
      <span>{{ t('admin.settings.serverScope') }}</span>
    </div>

    <!-- 首次进入设置的一次性路线提示：关掉后记到账号上，之后不再出现。 -->
    <HintNote v-if="hintVisible" :text="t('admin.settings.firstVisitHint')" @dismiss="dismissHint" />

    <!-- 组间导航：六组按首次配置路线编号，两列排，窄屏也能完整读到组名。
         换组只切换显示，不重建表单（见脚本里的 groupVisible）。 -->
    <nav ref="groupNav" class="settings-group-nav" :aria-label="t('admin.sections')">
      <button
        v-for="(group, index) in groupItems"
        :key="group.id"
        class="settings-group-tab"
        type="button"
        :aria-pressed="group.id === activeGroup ? 'true' : 'false'"
        :data-active="group.id === activeGroup ? 'true' : 'false'"
        @click="setGroup(group.id)"
      >
        <span class="settings-group-index" aria-hidden="true">{{ index + 1 }}</span>
        <span class="settings-group-label">{{ group.label }}</span>
      </button>
    </nav>

    <div v-show="groupVisible('server')" class="card">
      <span class="section-label">{{ copy.storageTitle }}</span>
      <div class="storage-meter" :data-full="storageFull ? 'true' : 'false'">
        <span :style="{ width: storagePercent + '%' }" />
      </div>
      <p class="field-hint">{{ storageCaption }}</p>
      <p class="field-hint">{{ copy.storageHint }}</p>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-storage-mb">{{ copy.storageLimit }}</label>
          <span class="setting-control">
            <input
              id="settings-storage-mb"
              v-model.number="form.storageMb"
              class="input input-line setting-num"
              type="number"
              min="64"
              max="10240"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
        <div class="field">
          <span id="settings-storage-policy" class="field-label">{{ copy.storageWhenFull }}</span>
          <SegControl
            :model-value="form.whenFull"
            :items="storagePolicies"
            :label="copy.storageWhenFull"
            @update:model-value="form.whenFull = $event === 'evict-oldest' ? 'evict-oldest' : 'reject'"
          />
        </div>
      </div>
    </div>

    <!-- 日志：只设置上限；当前用量由管理端设置接口下发，没有数据时只显示「—」。
         清理策略固定为「超过上限自动清理最早的日志」，不做成选项。 -->
    <div v-show="groupVisible('server')" class="card">
      <span class="section-label">{{ t('admin.settings.logs') }}</span>
      <div v-if="logsUsage.hasUsage" class="storage-meter" :data-full="logsMeter.full ? 'true' : 'false'">
        <span :style="{ width: logsMeter.percent + '%' }" />
      </div>
      <p class="field-hint">{{ logsUsageCaption }}</p>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-logs-mb">{{ t('admin.settings.logsCap') }}</label>
          <span class="setting-control">
            <input
              id="settings-logs-mb"
              v-model.number="form.logs.storageMb"
              class="input input-line setting-num"
              type="number"
              min="1"
              max="10240"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
      </div>
      <p class="field-hint">{{ t('admin.settings.logsHint') }}</p>
      <!-- 入口放在日志卡片内部、设置项下面：整行按钮，用浅色描边样式，和上传封面等次操作一致。 -->
      <button class="cta ghost" type="button" @click="emit('open-logs')">
        {{ t('logs.entry') }}
      </button>
    </div>

    <div v-show="groupVisible('brand')" class="card">
      <span class="section-label">{{ t('admin.settings.brand') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-title-zh">{{ t('admin.settings.brandZh') }}</label>
          <span class="setting-control">
            <input
              id="settings-title-zh"
              v-model="form.brand.zh"
              class="input input-line setting-text"
              type="text"
              maxlength="20"
              :placeholder="t('admin.settings.brandZhPlaceholder')"
            />
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-title-en">{{ t('admin.settings.brandEn') }}</label>
          <span class="setting-control">
            <input
              id="settings-title-en"
              v-model="form.brand.en"
              class="input input-line setting-text"
              type="text"
              maxlength="24"
              :placeholder="t('admin.settings.brandEnPlaceholder')"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- 首色调：下发到色板下标 0，应用默认选中它；默认占位就是当前钢青 #41707E。 -->
    <div v-show="groupVisible('brand')" class="card">
      <span class="section-label">{{ t('admin.settings.appearance') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-theme-accent">{{ t('admin.settings.accent') }}</label>
          <span class="setting-control">
            <input
              id="settings-theme-accent"
              v-model="form.themeAccent"
              class="input input-line setting-text"
              type="text"
              maxlength="7"
              spellcheck="false"
              autocomplete="off"
              placeholder="#41707E"
              :aria-label="t('admin.settings.accent')"
            />
          </span>
        </div>
      </div>
      <p class="field-hint">{{ t('admin.settings.accentHint') }}</p>
    </div>

    <!-- 缺省展会封面：展会自己没有封面时用它替掉占位图；留空即回到占位图。
         版式与编辑展会页的封面卡一致：左侧 96×170 竖版预览，右侧竖排按钮与说明，窄屏上下堆叠。 -->
    <div v-show="groupVisible('brand')" class="card">
      <span class="section-label">{{ copy.coverTitle }}</span>
      <div class="cover-row">
        <!-- 预览槽位始终在：上传期间盖进度遮罩，失败 / 取消随进度清空一起撤掉。
             遮罩下半截透出的是刚选的本机副本，服务器地址返回后再换掉。 -->
        <div class="cover-frame ph-img">
          <img
            v-if="coverPreview || form.defaultCover"
            :src="coverPreview || form.defaultCover"
            :alt="copy.coverTitle"
          />
          <UploadProgressMask
            v-if="coverProgress !== null"
            :progress="coverProgress"
            @settled="emit('cover-settled')"
          />
        </div>
        <div class="cover-side">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="coverBusy"
            :data-loading="coverBusy ? 'true' : 'false'"
            @click="emit('pick-cover')"
          >
            {{ form.defaultCover ? t('admin.media.changeCover') : t('admin.media.uploadCover') }}
          </button>
          <button
            v-if="form.defaultCover"
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="coverBusy"
            @click="form.defaultCover = ''"
          >
            {{ t('admin.media.removeCover') }}
          </button>
          <p class="field-hint">1080 × 1920</p>
          <p class="field-hint">{{ copy.coverHint }}</p>
        </div>
      </div>
    </div>

    <!-- 展商相关：同时筹备的展会 / 会议数，以及单个展会最长持续天数 -->
    <div v-show="groupVisible('exhibitions')" class="card">
      <span class="section-label">{{ copy.exhibitorSection }}</span>
      <div class="settings-rows">
        <div class="setting-block">
          <div class="setting-row">
            <label for="settings-max-future-exhibitions">{{ copy.exhibitorLimit }}</label>
            <span class="setting-control">
              <input
                id="settings-max-future-exhibitions"
                v-model.number="form.maxFutureExhibitions"
                class="input input-line setting-num"
                type="number"
                min="0"
                inputmode="numeric"
              />
              <span class="setting-unit">{{ t('admin.limits.items') }}</span>
            </span>
          </div>
          <p class="field-hint">{{ copy.exhibitorLimitHint }}</p>
        </div>
        <div class="setting-block">
          <div class="setting-row">
            <label for="settings-max-future-meetings">{{ copy.meetingLimit }}</label>
            <span class="setting-control">
              <input
                id="settings-max-future-meetings"
                v-model.number="form.maxFutureMeetings"
                class="input input-line setting-num"
                type="number"
                min="0"
                inputmode="numeric"
              />
              <span class="setting-unit">{{ t('admin.limits.items') }}</span>
            </span>
          </div>
          <p class="field-hint">{{ copy.meetingLimitHint }}</p>
        </div>
        <div class="setting-block">
          <div class="setting-row">
            <label for="settings-max-exhibition-days">{{ copy.maxExhibitionDays }}</label>
            <span class="setting-control">
              <input
                id="settings-max-exhibition-days"
                v-model.number="form.maxExhibitionDays"
                class="input input-line setting-num"
                type="number"
                min="0"
                max="365"
                inputmode="numeric"
              />
              <span class="setting-unit">{{ t('admin.settings.daysUnit') }}</span>
            </span>
          </div>
          <p class="field-hint">{{ copy.maxExhibitionDaysHint }}</p>
        </div>
      </div>
    </div>

    <div v-show="groupVisible('brand')" class="card">
      <span class="section-label">{{ t('admin.announce.entry') }}</span>
      <textarea id="settings-announcement" v-model="form.announcement" class="textarea" rows="3" />
      <div class="switch-row" data-flush="true">
        <span class="switch-copy">
          <strong>{{ t('admin.announce.showOnEntry') }}</strong>
        </span>
        <label class="switch" for="settings-announcement-enabled">
          <input id="settings-announcement-enabled" v-model="form.announcementEnabled" type="checkbox" />
          <span />
        </label>
      </div>
    </div>

    <div v-show="groupVisible('exhibitions')" class="card">
      <span class="section-label">{{ t('admin.settings.categories') }}</span>
      <textarea id="settings-categories" v-model="form.categories" class="textarea" rows="4" />
    </div>

    <div v-show="groupVisible('exhibitions')" class="card">
      <span class="section-label">{{ t('admin.settings.reviewPolicy') }}</span>
      <div class="switch-row" data-flush="true">
        <span class="switch-copy">
          <strong>{{ t('admin.settings.allowReviseDecided') }}</strong>
        </span>
        <label class="switch" for="settings-revise">
          <input id="settings-revise" v-model="form.canRevise" type="checkbox" />
          <span />
        </label>
      </div>
      <div class="switch-row" data-flush="true">
        <span class="switch-copy">
          <strong>{{ t('admin.settings.reviewAttended') }}</strong>
          <span class="field-hint">{{ t('admin.settings.reviewAttendedHint') }}</span>
        </span>
        <label class="switch" for="settings-revise-attended">
          <input id="settings-revise-attended" v-model="form.canReviseAttended" type="checkbox" />
          <span />
        </label>
      </div>
    </div>

    <!-- 报名相关：匿名报名（报名站未登录）时，收集项标题命中这些同义词就把额外姓名表单合并掉。
         空列表表示不合并，仍显示单独的姓名输入。 -->
    <div v-show="groupVisible('exhibitions')" class="card">
      <span class="section-label">{{ t('admin.settings.registrationSection') }}</span>
      <div class="field">
        <label for="settings-registration-name-titles">{{ t('admin.settings.registrationNameFieldTitles') }}</label>
        <textarea
          id="settings-registration-name-titles"
          v-model="form.registrationNameFieldTitles"
          class="textarea"
          rows="4"
          :placeholder="t('admin.settings.registrationNameFieldTitlesPlaceholder')"
        />
        <p class="field-hint">{{ t('admin.settings.registrationNameFieldTitlesHint') }}</p>
      </div>
    </div>

    <!-- 用户协议：上传 Markdown 作为协议浏览页正文。关闭时登录、注册、设置与更新提示里的入口全部隐藏；
         卡片内分区只用留白，不加分隔线。 -->
    <div v-show="groupVisible('accounts')" class="card">
      <span class="section-label">{{ t('admin.settings.agreement') }}</span>
      <div class="switch-row" data-flush="true">
        <span class="switch-copy">
          <strong>{{ t('admin.settings.agreementEnabled') }}</strong>
          <span class="field-hint">{{ t('admin.settings.agreementHint') }}</span>
        </span>
        <label class="switch" for="settings-agreement-enabled">
          <input id="settings-agreement-enabled" v-model="form.agreement.enabled" type="checkbox" />
          <span />
        </label>
      </div>
      <div class="setting-block">
        <div class="setting-row">
          <span class="field-label">{{ t('admin.settings.agreementVersion') }}</span>
          <span class="row-meta">{{ agreementVersionLabel }}</span>
        </div>
      </div>
      <p class="field-hint">{{ t('admin.settings.agreementFileHint', { max: AGREEMENT_MAX_CHARS }) }}</p>
      <button
        v-if="hasNative"
        class="cta ghost"
        type="button"
        :disabled="agreementBusy"
        :data-loading="agreementBusy ? 'true' : undefined"
        @click="importAgreementFromDevice"
      >
        {{ agreementContent.trim() ? t('admin.settings.agreementReplace') : t('admin.settings.agreementUpload') }}
      </button>
      <label v-else class="cta ghost" for="settings-agreement-file">
        {{ agreementContent.trim() ? t('admin.settings.agreementReplace') : t('admin.settings.agreementUpload') }}
      </label>
      <input
        id="settings-agreement-file"
        class="sr-only"
        type="file"
        accept=".md,text/markdown,text/plain"
        @change="importAgreementFromFile"
      />
      <div v-if="agreementContent.trim()" class="agreement-preview">
        <span class="row-meta">{{ agreementMeta }}</span>
        <span class="agreement-preview-title">{{ t('admin.settings.agreementPreviewTitle') }}</span>
        <pre class="agreement-preview-text">{{ agreementSummary }}</pre>
        <button class="text-action" type="button" @click="clearAgreementContent">
          {{ t('admin.settings.agreementClear') }}
        </button>
      </div>
      <p v-else class="field-hint">{{ t('admin.settings.agreementEmptyHint') }}</p>
      <p v-if="agreementError" class="field-error" role="alert">{{ agreementError }}</p>
    </div>

    <div v-show="groupVisible('accounts')" class="card">
      <span class="section-label">{{ t('admin.invites.title') }}</span>
      <p class="field-hint">{{ t('admin.invites.hint') }}</p>
      <!-- 三个数字字段并排：次数、码有效期、兑换后的展商时长 -->
      <div class="grid-cols-3">
        <div class="field">
          <label for="settings-invite-uses">{{ t('admin.invites.uses') }}</label>
          <input
            id="settings-invite-uses"
            v-model.number="form.inviteUses"
            class="input input-line"
            type="number"
            min="1"
            max="100"
            inputmode="numeric"
            :disabled="!canEditSettings || inviteBusy"
          />
        </div>
        <div class="field">
          <label for="settings-invite-days">{{ t('admin.invites.days') }}</label>
          <input
            id="settings-invite-days"
            v-model.number="form.inviteValidHours"
            class="input input-line"
            type="number"
            min="0"
            max="8760"
            inputmode="numeric"
            :disabled="!canEditSettings || inviteBusy"
          />
        </div>
        <div class="field">
          <label for="settings-invite-duration">{{ t('admin.invites.duration') }}</label>
          <input
            id="settings-invite-duration"
            v-model.number="form.inviteDurationDays"
            class="input input-line"
            type="number"
            min="0"
            max="3650"
            inputmode="numeric"
            :disabled="!canEditSettings || inviteBusy"
          />
        </div>
      </div>
      <p class="field-hint">{{ t('admin.invites.fieldsHint') }}</p>
      <button
        class="cta"
        type="button"
        :disabled="!canEditSettings || inviteBusy"
        :data-loading="inviteBusy ? 'true' : undefined"
        @click="emit('generate')"
      >
        {{ t('admin.invites.generate') }}
      </button>
      <StateBlock v-if="visibleInvites.length === 0" :title="t('admin.invites.empty')" />
      <div v-else class="invite-list">
        <div
          v-for="item in visibleInvites"
          :key="item.id"
          class="invite-row"
          :data-dim="item.status === 'exhausted' ? 'true' : 'false'"
        >
          <span class="invite-copy">
            <strong class="invite-code">{{ item.code }}</strong>
            <span class="row-meta">{{
              t('admin.invites.meta', {
                used: item.usedCount,
                max: item.maxUses,
                duration: inviteDurationLabel(item),
                status: inviteStatusLabel(item.status),
              })
            }}</span>
          </span>
          <span class="invite-actions">
            <button
              class="icon-button"
              type="button"
              :aria-label="t('admin.invites.copy')"
              :title="t('admin.invites.copy')"
              @click="emit('copy', item.code)"
            >
              <AppIcon name="copy" />
            </button>
            <button
              class="icon-button"
              type="button"
              :aria-label="t('admin.invites.revoke')"
              :title="t('admin.invites.revoke')"
              :disabled="inviteBusy"
              @click="emit('revoke', item.id)"
            >
              <AppIcon name="trash" />
            </button>
          </span>
        </div>
      </div>
    </div>

    <div v-show="groupVisible('media')" class="card">
      <span class="section-label">{{ t('admin.media.richMedia') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-image-count">{{ t('admin.media.imagesPerPost') }}</label>
          <span class="setting-control">
            <input
              id="settings-image-count"
              v-model.number="form.imageCount"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">{{ t('admin.media.sheets') }}</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-image-size">{{ t('admin.media.imageSize') }}</label>
          <span class="setting-control">
            <input
              id="settings-image-size"
              v-model.number="form.imageSizeMb"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-video-count">{{ t('admin.media.videoCount') }}</label>
          <span class="setting-control">
            <input
              id="settings-video-count"
              v-model.number="form.videoCount"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">{{ t('admin.limits.items') }}</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-video-size">{{ t('admin.media.videoSize') }}</label>
          <span class="setting-control">
            <input
              id="settings-video-size"
              v-model.number="form.videoSizeMb"
              class="input input-line setting-num"
              type="number"
              min="0"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
      </div>
    </div>

    <div v-show="groupVisible('media')" class="card">
      <span class="section-label">{{ t('admin.media.uploadFormats') }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-image-formats">{{ t('admin.media.imageSuffixes') }}</label>
          <span class="setting-control">
            <input
              id="settings-image-formats"
              v-model="form.imageFormats"
              class="input input-line setting-text"
              type="text"
              maxlength="120"
              placeholder="jpg,jpeg,png,webp"
            />
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-video-formats">{{ t('admin.media.videoSuffixes') }}</label>
          <span class="setting-control">
            <input
              id="settings-video-formats"
              v-model="form.videoFormats"
              class="input input-line setting-text"
              type="text"
              maxlength="120"
              placeholder="mp4,mov,webm"
            />
          </span>
        </div>
      </div>
    </div>

    <div v-show="groupVisible('media')" class="card">
      <span class="section-label">{{ copy.avatarSection }}</span>
      <div class="settings-rows">
        <div class="setting-row">
          <label for="settings-avatar-size">{{ t('admin.media.avatarSize') }}</label>
          <span class="setting-control">
            <input
              id="settings-avatar-size"
              v-model.number="form.avatarSizeMb"
              class="input input-line setting-num"
              type="number"
              min="1"
              max="20"
              inputmode="numeric"
            />
            <span class="setting-unit">MB</span>
          </span>
        </div>
        <div class="setting-row">
          <label for="settings-avatar-formats">{{ copy.avatarFormats }}</label>
          <span class="setting-control">
            <input
              id="settings-avatar-formats"
              v-model="form.avatarFormats"
              class="input input-line setting-text"
              type="text"
              maxlength="80"
              placeholder="jpg,jpeg,png,webp"
            />
          </span>
        </div>
      </div>
    </div>

    <div v-show="groupVisible('media')" class="card">
      <span class="section-label">{{ t('admin.limits.formChars') }}</span>
      <p class="field-hint">{{ copy.limitIntro }}</p>
      <div v-for="group in limitGroups" :key="group.id" class="limit-group">
        <span class="limit-group-title">{{ group.title }}</span>
        <div v-for="(row, rowIndex) in pairLimits(group.items)" :key="group.id + '-' + rowIndex" class="limit-pair">
          <div v-for="item in row" :key="item.key" class="setting-block">
            <div class="setting-row">
              <label :for="'limit-' + item.key">{{ item.label }}</label>
              <span class="setting-control">
                <input
                  :id="'limit-' + item.key"
                  v-model.number="form.limits[item.key]"
                  class="input input-line setting-num"
                  type="number"
                  min="0"
                  inputmode="numeric"
                />
                <span class="setting-unit">{{ item.unit }}</span>
              </span>
            </div>
            <p class="field-hint">{{ item.hint }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 软件包下载：检查更新和报名站下载条都读这一份配置。
         直链可填单个 APK，也可填包含版本化 APK 的目录；GitHub 仓库交给服务器追踪最新 Release。 -->
    <div v-show="groupVisible('delivery')" class="card">
      <span class="section-label">{{ t('admin.download.title') }}</span>
      <div class="field">
        <span class="field-label">{{ t('admin.download.source') }}</span>
        <SegControl
          :model-value="form.download.source"
          :items="downloadSources"
          :label="t('admin.download.source')"
          @update:model-value="form.download.source = $event === 'github' ? 'github' : 'url'"
        />
        <p class="field-hint">{{ t('admin.download.hint') }}</p>
      </div>
      <div v-if="form.download.source === 'url'" class="field">
        <label for="settings-download-url">{{ t('admin.download.url') }}</label>
        <input
          id="settings-download-url"
          v-model="form.download.url"
          class="input input-line"
          type="url"
          inputmode="url"
          autocomplete="off"
          :placeholder="t('admin.download.urlPlaceholder')"
        />
      </div>
      <template v-else>
        <div class="field">
          <label for="settings-download-repo">{{ t('admin.download.repo') }}</label>
          <input
            id="settings-download-repo"
            v-model="form.download.repo"
            class="input input-line"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('admin.download.repoPlaceholder')"
          />
        </div>
        <p class="field-hint">{{ t('admin.download.githubHint') }}</p>
      </template>
    </div>

    <!-- 组底部的「返回 / 继续」：按首次配置路线线性走一遍，不用再回到顶部的分组导航。
         第一组没有「返回」，最后一组没有「继续」。 -->
    <div class="settings-group-switch">
      <button v-if="previousGroup" class="cta ghost" data-size="small" type="button" @click="shiftGroup(-1)">
        {{ t('common.back') }} · {{ previousGroup.label }}
      </button>
      <button v-if="nextGroup" class="cta ghost" data-size="small" type="button" @click="shiftGroup(1)">
        {{ t('common.continue') }} · {{ nextGroup.label }}
      </button>
    </div>

    <p v-if="settingsError" class="field-error" role="alert">{{ settingsError }}</p>

    <!-- 悬浮保存：只在本分区（管理-设置）渲染，贴页面右下角；保存中或没有权限时禁用。
         用 .round-action（51px 圆形、带阴影）加 save 图标，标题与读屏名复用同一句文案。
         投递到 body：fixed 若留在页面里，页面切换的 .route-enter 动画期间
         transform 祖先会成为包含块，按钮会先按内容区定位再跳回屏幕右下角（长页面尤其明显）。
         放到 body 下就没有这个包含块，定位从第一帧起就是屏幕坐标。 -->
    <Teleport to="body">
      <button
        class="round-action settings-save-fab"
        type="button"
        :disabled="settingsSaving || !canEditSettings"
        :aria-label="t('admin.settings.save')"
        :title="t('admin.settings.save')"
        @click="emit('save')"
      >
        <AppIcon name="save" />
      </button>
    </Teleport>
  </template>
</template>

<style scoped>
/* 组间导航：六组按首次配置路线编号，两列排；窄屏两列也能完整放下最长的组名。
   切组时导航会被滚回视口顶部，留出顶部安全区的余量。 */
.settings-group-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s2);
  scroll-margin-top: calc(var(--safe-top) + var(--topbar-h));
}

@media (min-width: 520px) {
  .settings-group-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.settings-group-tab {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
  min-height: var(--touch);
  padding: var(--s2) var(--s3);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--screen);
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 600;
  text-align: start;
  transition:
    border-color var(--motion-fast) var(--ease),
    color var(--motion-fast) var(--ease),
    background var(--motion-fast) var(--ease);
}

.settings-group-tab[data-active='true'] {
  border-color: var(--accent-edge);
  background: var(--f3);
  color: var(--ink);
  font-weight: 700;
}

/* 组序号：说明这是一条按顺序走的配置路线，选中时跟组名一起提亮。 */
.settings-group-index {
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-pill);
  color: var(--ink-3);
  font-size: var(--fs-tag);
  font-variant-numeric: tabular-nums;
}

.settings-group-tab[data-active='true'] .settings-group-index {
  border-color: var(--accent);
  color: var(--accent-ink);
}

.settings-group-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 组底部的返回 / 继续：窄屏上下排（组名最长 7 个字，横排会被挤成两行），
   宽屏再并排。放在最后一组之外，不跟卡片内容混在一起。 */
.settings-group-switch {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

@media (min-width: 480px) {
  .settings-group-switch {
    flex-direction: row;
  }
}

.settings-group-switch > .cta {
  flex: 1 1 0;
  min-width: 0;
  padding-inline: var(--s2);
}

/* 卡片内的节奏：组标题到第一行留 12px，组与组之间 20px（在 .list 层）。
   设置项本身「一行标题 + 一行说明」为一组，组与组之间 16px。 */
.card {
  gap: var(--s3);
}

.settings-rows {
  display: grid;
  gap: var(--s5);
  min-width: 0;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: var(--s4);
  min-width: 0;
  /* 命中区仍是 44px；标签与控件在垂直方向居中对齐，长短说明不会把行撑歪。 */
  min-height: var(--touch);
}

/* 设置项标题：比下面的说明文字更重、更大、更黑，否则读不出层级。
   说明文字走 .field-hint（--fs-meta、--ink-3）。 */
.setting-row > label,
.setting-block > label,
.setting-block > .field-label {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: 1.35;
}

.setting-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

.setting-control .input {
  width: auto;
  min-height: var(--ctrl);
}

.setting-control .setting-num {
  width: 96px;
  text-align: end;
}

.setting-control .setting-text {
  width: 148px;
  font-size: var(--fs-meta);
}

.setting-unit {
  flex: none;
  color: var(--ink-3);
  font-size: var(--fs-meta);
  white-space: nowrap;
}

/* 一项设置 = 标题行 + 说明。说明紧贴标题（2px），组与组之间才拉开，
   这样「标题 / 说明」读成一块，而不是四行等距的散点。 */
.setting-block {
  display: grid;
  gap: 0;
  align-content: start;
  min-width: 0;
}

.setting-block .field-hint {
  margin: 2px 0 0;
  /* 说明比标题弱一档，长度也收住，避免一行拉到屏幕边缘。 */
  max-width: 34em;
}

/* 存储条：一条填充线，用满时换成砖红。 */
.storage-meter {
  height: 6px;
  overflow: hidden;
  border-radius: var(--r-pill);
  background: var(--f1);
}

.storage-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width var(--motion-base) var(--ease);
}

.storage-meter[data-full='true'] > span {
  background: var(--danger-ink);
}

/* 缺省封面：左 96×170 竖版预览，右侧竖排按钮与说明，窄屏上下堆叠。 */
.cover-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--s4);
}

.cover-frame {
  flex: 0 0 96px;
  width: 96px;
  aspect-ratio: 1080 / 1920;
  border-radius: var(--r-card);
}

.cover-side {
  flex: 1 1 150px;
  min-width: 0;
  display: grid;
  gap: var(--s2);
  align-content: start;
}

.cover-side .cta {
  width: 100%;
}

.cover-side .field-hint {
  margin: 0;
}

/* 文字长度分组：同一张卡里用分隔线隔开，组内两列自适应。 */
.limit-group {
  display: grid;
  gap: var(--s5);
  padding-top: var(--s4);
  border-top: var(--hairline) solid var(--stroke);
}

.limit-group-title {
  color: var(--ink);
  font-size: var(--fs-meta);
  font-weight: 700;
  letter-spacing: 0.02em;
}

/* 组标题后面紧跟的说明段落：比它到下一组更近一档，才不会读成「下一组的开头」。 */
.section-label + .field-hint {
  margin-top: calc(var(--s1) * -1);
  max-width: 34em;
}

/* 卡里剩下几处「标签在上、控件在下」的字段（邀请码三列）：标题与输入框之间 8px，
   与设置项的标题同一档字号与字重，整页读起来是一套。 */
.card > .field {
  gap: var(--s2);
}

.card > .field > label {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
}

.grid-cols-3 > .field {
  gap: 6px;
}

/* 邀请码列表前的说明与生成按钮之间留一档，不贴着列表第一行。 */
.invite-list {
  margin-top: var(--s1);
}

.limit-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  align-items: start;
  gap: var(--s5) var(--s6);
}

/* 邀请码列表：等宽码在左，右端两枚图标按钮；已用完的行压暗。 */
.invite-list {
  display: grid;
  gap: 0;
}

.invite-row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-height: var(--touch);
  padding-block: var(--s2);
}

.invite-row + .invite-row {
  border-top: var(--hairline) solid var(--stroke);
}

.invite-row[data-dim='true'] {
  opacity: 0.55;
}

.invite-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.invite-code {
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-h3);
  font-weight: 700;
  letter-spacing: 0.06em;
}

.invite-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s1);
}

/* 用户协议摘要：只展示前几行，整篇效果去协议浏览页看。 */
.agreement-preview {
  display: grid;
  gap: var(--s1);
  min-width: 0;
}

.agreement-preview-title {
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 700;
}

.agreement-preview-text {
  margin: 0;
  padding: var(--s3);
  overflow: hidden;
  border: var(--hairline) dashed var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
  color: var(--ink-2);
  font-size: var(--fs-meta);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 悬浮保存按钮：fixed 贴屏幕右下角，但横向要落在应用这条 720px 居中列内，
   不能飘到窗口边；底部要避开底部导航与安全区。 */
.round-action.settings-save-fab {
  position: fixed;
  right: max(var(--s4), calc((100vw - var(--app-max)) / 2 + var(--s4)));
  bottom: calc(var(--ctrl) + var(--s1) + var(--s2) + var(--hairline) + var(--s4) + var(--safe-bottom));
  z-index: 30;
}

/* 禁用时与 .cta[disabled] 同一套观感：灰底灰字、去掉阴影，指针提示不可点。 */
.settings-save-fab[disabled] {
  background: var(--f1);
  color: var(--ink-3);
  box-shadow: none;
  cursor: not-allowed;
}
</style>
