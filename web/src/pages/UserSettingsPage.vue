<script setup lang="ts">
/**
 * 用户设置：通知与隐私、外观（配色与明暗）、语言、邀请码与账号信息。
 *
 * 版式按「账号 / 通知与隐私 / 外观 / 语言 / 邀请码 / 安装到主屏幕 / 应用更新」分组：组标题
 * 在卡片外，卡片里的开关行用 `.switch-row[data-flush='true']` 的分隔线版式，不再套第二层
 * 边框。邀请码固定在页面底部：普通用户显示输入框，展商与管理员只说明身份已升级。
 * 「安装到主屏幕」在浏览器访问（非独立 PWA 且没有原生桥）时出现，原生 App 里不出现；
 * 「应用更新」只在 Android 原生壳里出现。两者互斥，都不和协议入口混在一起。
 *
 * 账号组只保留身份展示（头像、昵称、角色、邮箱）与「编辑资料」入口：编辑资料与个人页
 * 身份卡右侧的铅笔共用 `services/profile-editor.ts` 的同一抽屉；头像的选图、裁剪、更换、
 * 移除都在抽屉最上方，点完立即保存（见 `components/ProfileAvatarField.vue`）。本页不再
 * 有头像动作按钮，也不渲染裁剪组件。
 *
 * 通知、配色、明暗、语言、隐私留在这里，因为它们各自写不同的接口。
 * 安全设置只从个人页进入，本页不再提供入口。语言包在本机，不写后端。
 *
 * 配色与明暗模式都**没有**「保存」按钮：两者走 `app/preferences`，它内部是
 * 「本地立即生效 → 落库 → 失败回滚」，失败时界面不会停在没保存成功的颜色/模式上。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { usePullRefresh } from '@/services/pull-refresh';
import { useRouter } from 'vue-router';
import { api, bootApp, refreshRuntimeBootstrap } from '@/app/runtime';
import { saveAccentIndex, saveUiMode } from '@/app/preferences';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { device } from '@/services/device-services';
import { nativeBridge } from '@/services/native-bridge';
import { isAndroid, isIos } from '@/services/platform';
import { shouldOfferPwaInstall } from '@/services/pwa';
import { toast } from '@/services/toast';
import { formatLocalChineseDate } from '@/services/format';
import { openProfileEditor } from '@/services/profile-editor';
import ProfileAvatarCropper from '@/components/ProfileAvatarCropper.vue';
import { openSheet } from '@/services/sheet';
import {
  autoUpdateEnabled,
  markUpdateChecked,
  markUpdatePrompted,
  promptedUpdate,
  setAutoUpdateEnabled,
  shouldAutoCheck,
  shouldPrompt,
  updateMarker,
} from '@/services/update-check';
import LanguagePackCard from '@/components/LanguagePackCard.vue';
import AppIcon from '@/components/AppIcon.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import RoleTag from '@/components/RoleTag.vue';
import UpdateSheet from '@/components/UpdateSheet.vue';
import PwaInstallSheet from '@/components/PwaInstallSheet.vue';
import SegControl from '@/components/SegControl.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { JsonObject, ReleaseInfo } from '@/api/types';
import { t } from '@/i18n';

const router = useRouter();
const session = useSessionStore();
const settings = useSettingsStore();
const bootstrap = useBootstrapStore();
const capabilities = useCapabilitiesStore();

const user = computed(() => session.user);
const loggedIn = computed(() => session.loggedIn);
/**
 * 应用更新只属于 Android 原生壳：浏览器与 iOS PWA 里没有 APK 可装，
 * 整组入口与自动检查都跟着这个开关走，避免让用户点到一个永远装不上的按钮。
 */
const showNativeUpdate = nativeBridge.hasNative();
/** 浏览器访问（还没装到主屏幕、也没有原生桥）时给一个入口，抽屉与首页的提示共用。 */
const showInstallEntry = shouldOfferPwaInstall();
/** 安装卡片的一句说明按平台换，和抽屉里的开头段保持同一分支，不把 Safari 文案给 Android。 */
function installEntryHint(): string {
  if (isIos()) return t('pwa.install.intro');
  if (isAndroid()) return t('pwa.install.androidIntro');
  return t('pwa.install.desktopIntro');
}
const installIntro = showInstallEntry ? installEntryHint() : '';
/** 受限账号：只有后端明确下发 `false` 才算，老后端不下发 `profile` 时行为不变。 */
const limited = computed(() => user.value.can?.profile === false);
/** 受限时统一用同一句说明原因，避免每个入口各写一套说法。 */
const limitHint = computed(() => t('profile.restricted'));
/** 用户协议：只有管理员开启后才有入口（关闭时所有入口都不渲染）。 */
const agreementEnabled = computed(() => bootstrap.agreement?.enabled === true);
/**
 * 谁能兑换邀请码：普通用户直接开通；限时展商可以续期（从原到期日顺延）；
 * 永久展商与管理员没有可兑换的东西，卡片里只显示身份说明。
 */
const canRedeemInvite = computed(() => {
  const role = String(user.value.role || '');
  if (role === 'admin') return false;
  if (role === 'exhibitor') return Boolean(user.value.exhibitorExpiresAt);
  return true;
});

/** 永久展商与管理员不再需要邀请码，卡片底部按当前身份给一句说明。 */
const inviteRoleHint = computed(() =>
  user.value.role === 'admin' ? t('settings.invite.alreadyAdmin') : t('settings.invite.alreadyExhibitor'),
);

/** 限时展商在卡片里看到自己的到期日与续期规则。 */
const inviteRenewHint = computed(() => {
  if (user.value.role !== 'exhibitor') return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? t('settings.invite.renewHint', { date }) : '';
});

/**
 * 本页专用说法。`t()` 不依赖响应式数据，在 setup 里取一次即可。
 */
const COPY = {
  /** 配色没有保存按钮，用它解释「点了就生效」。 */
  accentHint: t('settings.theme.accentHint'),
};

// ── 取数 ──────────────────────────────────────────────────────────

const profile = reactive<JsonObject>({});
const notify = reactive({ exhibitionReminder: true, registrationUpdates: true, granted: false });
const loading = ref(true);
const profileLoading = ref(false);
const profileLoaded = ref(false);
const profileError = ref('');
const notifyLoading = ref(false);
const notifyLoaded = ref(false);
const notifyError = ref('');
const profileReady = computed(() => profileLoaded.value && !profileLoading.value && !profileError.value);
const notifyReady = computed(() => notifyLoaded.value && !notifyLoading.value && !notifyError.value);

const notificationsGranted = computed(() => {
  const value = capabilities.values.notifications;
  // 有桥接时以设备事实为准；浏览器预览退回后端下发的值。
  return typeof value === 'boolean' ? value : notify.granted === true;
});

/** 取数失败优先用后端/传输层自带的原因，没有就回落到通用文案。 */
function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('exhibition.form.saveFailed');
}

/** 两组数据分别保留错误和重试入口；完整资料到齐前不能提交覆盖写入。 */
async function load(): Promise<void> {
  await bootApp().catch(() => undefined);
  // 已经画出资料卡时不要整页换成骨架，下拉刷新只标记忙碌。
  const first = !profileLoaded.value && !notifyLoaded.value;
  if (first) loading.value = true;
  await Promise.all([loadProfile(), loadNotifications()]);
  loading.value = false;
}

async function loadProfile(): Promise<void> {
  profileLoading.value = true;
  profileError.value = '';
  const epoch = session.profileEpoch;
  try {
    const result = await api.profile.get();
    // 上传头像或退出发生在这次请求之后：响应当时的头像已经过期，不能写回会话。
    if (epoch !== session.profileEpoch) return;
    Object.assign(profile, result);
    session.applyUser({ ...user.value, ...result });
    profileLoaded.value = true;
  } catch (reason) {
    profileError.value = errorText(reason);
  } finally {
    profileLoading.value = false;
  }
}

async function loadNotifications(): Promise<void> {
  notifyLoading.value = true;
  notifyError.value = '';
  try {
    const result = await api.profile.notifications();
    Object.assign(notify, { exhibitionReminder: true, registrationUpdates: true, granted: false }, result);
    notifyLoaded.value = true;
  } catch (reason) {
    notifyError.value = errorText(reason);
  } finally {
    notifyLoading.value = false;
  }
}

onMounted(load);
// 自动检查更新：只有原生壳需要；开关打开且距上次检查超过六小时，静默跑一次（失败不提示）。
onMounted(() => {
  if (showNativeUpdate) void checkUpdate(true);
});

usePullRefresh(
  () => load(),
  computed(() => !loading.value && (profileLoading.value || notifyLoading.value)),
  loggedIn,
);

// ── 资料写入：编辑资料与隐私开关共用同一道守卫 ──────────────────

/** 资料未读成功或账号受限时不能覆盖写入，动作入口与禁用状态保持一致。 */
function guardProfileWrite(): boolean {
  if (!profileReady.value) {
    toast(profileError.value || t('security.profileLoadFailed'), 'error');
    return true;
  }
  if (!limited.value) return false;
  toast(limitHint.value, 'error');
  return true;
}

/** 编辑资料：与个人页铅笔打开的是同一抽屉；头像在抽屉最上方，点完立即保存。 */
function openEditor(): void {
  openProfileEditor(profile, { blocked: guardProfileWrite });
}

// ── 隐私：是否在公开页展示自己的报名记录 ──────────────────────────

const privacyBusy = ref(false);

/**
 * 开关立即生效：失败时回滚界面状态，避免看起来已保存。
 *
 * 写入走 `PUT /profile`（后端把整份资料当成一次覆盖），因此昵称、简介、地区、社交账号与
 * 头像都要原样回传 —— 少传字段会被当成清空。
 */
async function savePrivacy(value: boolean): Promise<void> {
  if (guardProfileWrite()) return;
  const previous = profile.showRegistrations === true;
  profile.showRegistrations = value;
  privacyBusy.value = true;
  try {
    const saved = await api.profile.save({
      nickname: String(user.value.nickname || ''),
      bio: String(profile.bio || ''),
      region: String(profile.region || ''),
      socialMedia: String(profile.socialMedia || ''),
      avatar: String(user.value.avatar || ''),
      showRegistrations: value,
    });
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.bumpProfile();
    session.applyUser({ ...user.value, ...fresh });
    Object.assign(profile, fresh);
    toast(value ? t('settings.registrationsShown') : t('settings.registrationsHidden'), 'success');
  } catch (reason) {
    profile.showRegistrations = previous;
    toast(errorText(reason), 'error');
  } finally {
    privacyBusy.value = false;
  }
}

// ── 通知设置 ──────────────────────────────────────────────────────

const savingPreference = ref('');

async function savePreferences(patch: JsonObject): Promise<void> {
  if (!notifyReady.value) return;
  const key = Object.keys(patch)[0] ?? '';
  savingPreference.value = key;
  try {
    // 写接口统一返回 `{ ok, error, notify }`；失败时提示且不改动开关。
    const result = await api.profile.saveNotifications(patch);
    Object.assign(notify, result.notify ?? {});
    toast(t('settings.notify.updated'), 'success');
  } catch (reason) {
    toast(errorText(reason), 'error');
  } finally {
    savingPreference.value = '';
  }
}

async function requestNotification(): Promise<void> {
  try {
    const result = await device.requestNotificationPermission();
    const granted = result === true;
    notify.granted = granted;
    // 拿到结果后同步到设备能力，按钮的显隐以它为准（见 notificationsGranted）。
    capabilities.apply({ notifications: granted });
    toast(
      granted ? t('settings.notify.permissionGranted') : t('settings.notify.permissionDenied'),
      granted ? 'success' : 'error',
    );
  } catch (reason) {
    toast(errorText(reason), 'error');
  }
}

// ── 应用配色：点一下就生效 ────────────────────────────────────────

const themeColors = computed<string[]>(() => {
  const list = bootstrap.theme.colors;
  return Array.isArray(list) ? list.map((item) => String(item)) : [];
});

/** 选中项就是当前生效的下标：保存成功会改写它，失败回滚也会改写它。 */
const accentIndex = computed(() => Number(bootstrap.theme.index) || 0);
/** 请求在飞时挡住重复点击：连点会让「上一个下标」在并发回滚里串位。 */
const accentBusy = ref(false);

/**
 * 换色：本地令牌、本机缓存与落库都在 `saveAccentIndex` 里，页面只负责提示。
 *
 * 失败时偏好层已经回滚颜色，界面不会停在没生效的颜色上 —— 所以不需要「保存配色」按钮，
 * 所见即已保存。
 */
async function changeAccent(index: number): Promise<void> {
  if (index === accentIndex.value) return;
  accentBusy.value = true;
  try {
    await saveAccentIndex(index);
    toast(t('settings.theme.accentSaved'), 'success');
  } catch (reason) {
    toast(errorText(reason) || t('exhibition.form.saveFailed'), 'error');
  } finally {
    accentBusy.value = false;
  }
}

// ── 明暗模式 ──────────────────────────────────────────────────────

const modeItems = computed(() => [
  { value: 'auto', label: t('settings.theme.followSystem') },
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
]);

const mode = computed(() => settings.mode);

const inviteCode = ref('');
const inviteBusy = ref(false);

async function redeemInvite(): Promise<void> {
  const code = inviteCode.value.trim();
  if (!code || inviteBusy.value || limited.value) return;
  inviteBusy.value = true;
  try {
    const result = await api.profile.redeemInvite(code);
    if (result?.ok !== true) {
      toast(String(result?.error || t('admin.users.updateFailed')), 'error');
      return;
    }
    inviteCode.value = '';
    toast(t('settings.invite.done'), 'success');
    await refreshRuntimeBootstrap();
  } catch (reason) {
    toast(errorText(reason), 'error');
  } finally {
    inviteBusy.value = false;
  }
}

/** 切换明暗模式：本地令牌先变，落库失败由 `saveUiMode` 回滚，这里只提示。 */
async function changeMode(value: string): Promise<void> {
  if (value === mode.value) return;
  try {
    await saveUiMode(value);
  } catch (reason) {
    toast(errorText(reason) || t('exhibition.form.saveFailed'), 'error');
  }
}

// ── 应用更新：检查服务器解析出的最新版本，下载交给系统浏览器 ─────────

/** 自动检查开关，初值来自本机；开关本身只写 localStorage，不上服务端。 */
const autoUpdate = ref(autoUpdateEnabled());
const updateBusy = ref(false);

function toggleAutoUpdate(value: boolean): void {
  autoUpdate.value = value;
  // 设备级偏好：每台设备各自决定要不要后台检查，不跟账号走。
  setAutoUpdateEnabled(value);
}

/** 打开更新抽屉：版本、更新日志与下载按钮都由 UpdateSheet 渲染。 */
function showRelease(release: ReleaseInfo): void {
  openSheet({
    title: t('settings.update.title'),
    component: UpdateSheet,
    props: { release },
  });
}

/** 设置页的安装入口：与首页一次性提示同一个抽屉，mode 为 app（已经在完整应用里）。 */
function openInstallSheet(): void {
  openSheet({
    title: t('pwa.install.title'),
    component: PwaInstallSheet,
    props: { mode: 'app' },
  });
}

/**
 * 检查更新。
 *
 * `auto` 为真时不显示加载态、失败也不提示；命中新版本且本机还没自动提示过
 * 同一个标记（有版本号用版本号，否则用下载地址）时才弹抽屉。
 */
async function checkUpdate(auto = false): Promise<void> {
  if (auto) {
    if (!shouldAutoCheck()) return;
  } else {
    if (updateBusy.value) return;
    updateBusy.value = true;
  }
  try {
    const release = await api.release();
    // 自动检查和手动检查都记时间，避免刚手动查过又立刻后台再查一次。
    markUpdateChecked();
    if (auto) {
      const marker = updateMarker(release);
      if (!marker || marker === promptedUpdate() || !shouldPrompt(release)) return;
      markUpdatePrompted(marker);
      showRelease(release);
      return;
    }
    // 管理员还没配下载地址：有版本号也没法装，按「不可用」提示。
    if (!String(release?.url ?? '').trim()) {
      toast(t('settings.update.unavailable'));
      return;
    }
    if (shouldPrompt(release)) {
      showRelease(release);
      return;
    }
    toast(t('settings.update.upToDate'));
  } catch {
    if (!auto) toast(t('settings.update.failed'), 'error');
  } finally {
    if (!auto) updateBusy.value = false;
  }
}
</script>

<template>
  <!-- 访客：这一页每一项都依赖登录身份，未登录时原位说明并给出登录入口 -->
  <StateBlock
    v-if="!loggedIn"
    icon="user"
    :title="t('profile.guestTitle')"
    :description="t('profile.guestHint')"
    :action-label="t('registration.list.goLogin')"
    @action="router.push({ path: '/login', query: { redirect: '/settings' } })"
  />

  <template v-else>
    <SkeletonBlock v-if="loading" :rows="4" />

    <div v-else class="settings-groups">
      <!-- 账号：身份卡 + 安全入口 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.section.account') }}</span>
        <SkeletonBlock v-if="profileLoading && !profileLoaded" :rows="2" />
        <StateBlock
          v-else-if="profileError && !profileLoaded"
          tone="error"
          :title="t('security.profileLoadFailed')"
          :description="profileError"
          :action-label="t('common.retry')"
          @action="loadProfile"
        />
        <!-- 身份卡：只展示当前头像、昵称、角色与邮箱；头像动作和编辑资料都在抽屉里。资料失败时卡片仍在，按钮置灰。 -->
        <div class="card" data-tone="fill" :data-busy="profileLoading ? 'true' : undefined">
          <div class="row" data-gap="md">
            <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
            <span class="row-copy">
              <span class="name-line">
                <strong class="identity-name">{{ user.nickname || user.username }}</strong>
                <RoleTag :role-code="String(user.role || '')" />
              </span>
              <span class="row-meta truncate">{{ user.email || t('settings.emailEmpty') }}</span>
            </span>
          </div>
          <div class="action-row">
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              :disabled="limited || !profileReady"
              :title="limited ? limitHint : undefined"
              @click="openEditor"
            >
              {{ t('settings.profile.editProfile') }}
            </button>
          </div>
          <p class="field-hint">
            {{
              t(
                'settings.profile.editHint',
                undefined,
                '昵称、简介、地区与社交账号都在「编辑资料」里修改，个人主页上的头像也用同一份资料。',
              )
            }}
          </p>
        </div>

        <div v-if="limited" class="notice" data-tone="accent">
          <strong>{{ limitHint }}</strong>
          <span>{{ t('settings.limitUnaffected') }}</span>
        </div>
      </section>

      <!-- 通知与隐私：通知偏好、系统通知权限与报名公开展示 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.section.notifyPrivacy') }}</span>
        <div class="card user-settings-card">
          <SkeletonBlock v-if="notifyLoading" :rows="2" />
          <StateBlock
            v-else-if="notifyError"
            tone="error"
            :title="t('settings.notify.loadFailed')"
            :description="notifyError"
            :action-label="t('common.retry')"
            @action="loadNotifications"
          />
          <div class="list" data-gap="none">
            <div class="switch-row" data-flush="true">
              <span class="switch-copy">
                <strong>{{ t('settings.notify.exhibitionReminder') }}</strong>
              </span>
              <label class="switch" for="notify-reminder">
                <input
                  id="notify-reminder"
                  type="checkbox"
                  :checked="notify.exhibitionReminder"
                  :disabled="!notifyReady || savingPreference === 'exhibitionReminder'"
                  @change="savePreferences({ exhibitionReminder: ($event.target as HTMLInputElement).checked })"
                />
                <span />
              </label>
            </div>
            <div class="switch-row" data-flush="true">
              <span class="switch-copy">
                <strong>{{ t('settings.notify.registrationUpdates') }}</strong>
              </span>
              <label class="switch" for="notify-status">
                <input
                  id="notify-status"
                  type="checkbox"
                  :checked="notify.registrationUpdates"
                  :disabled="!notifyReady || savingPreference === 'registrationUpdates'"
                  @change="savePreferences({ registrationUpdates: ($event.target as HTMLInputElement).checked })"
                />
                <span />
              </label>
            </div>
          </div>
          <!-- 系统通知权限只有设备知道：后端返回的 granted 只表示服务器侧开关可用 -->
          <button v-if="!notificationsGranted" class="cta ghost" type="button" @click="requestNotification">
            {{ t('settings.notify.requestPermission') }}
          </button>
          <div class="switch-row" data-flush="true">
            <span class="switch-copy">
              <strong>{{ t('settings.showRegistrations') }}</strong>
              <span class="row-meta">{{ t('settings.showRegistrationsHint') }}</span>
            </span>
            <label class="switch" for="settings-privacy-registrations">
              <input
                id="settings-privacy-registrations"
                type="checkbox"
                :checked="profile.showRegistrations === true"
                :disabled="limited || !profileReady || privacyBusy"
                @change="savePrivacy(($event.target as HTMLInputElement).checked)"
              />
              <span />
            </label>
          </div>
          <!-- 这组开关都是点一下即保存，没有单独的保存按钮：先说清楚，避免用户找「保存」。 -->
          <p class="field-hint">
            {{ t('settings.notify.instantHint', undefined, '这些开关点一下就会保存，没有单独的保存按钮。') }}
          </p>
          <p v-if="limited" class="field-hint">{{ limitHint }}</p>
        </div>
      </section>

      <!-- 外观：配色与明暗都点一下就生效，没有保存按钮 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.section.appearance') }}</span>
        <div class="card user-settings-card">
          <span class="row-title">{{ t('settings.theme.accent') }}</span>
          <div class="swatch-grid">
            <button
              v-for="(color, index) in themeColors"
              :key="`${index}-${color}`"
              class="swatch"
              type="button"
              :aria-label="t('settings.theme.accentOption', { name: t('settings.theme.accent'), index: index + 1 })"
              :aria-pressed="index === accentIndex ? 'true' : 'false'"
              :disabled="accentBusy"
              @click="changeAccent(index)"
            >
              <span class="swatch-dot" :style="{ background: color }">
                <AppIcon v-if="index === accentIndex" name="check" size="icon icon-sm" />
              </span>
            </button>
          </div>
          <p class="field-hint">{{ COPY.accentHint }}</p>
          <span class="row-title">{{ t('settings.theme.darkMode') }}</span>
          <SegControl
            :model-value="mode"
            :items="modeItems"
            :label="t('settings.theme.darkMode')"
            @update:model-value="changeMode"
          />
        </div>
      </section>

      <!-- 语言：切换、链接安装、文件安装与下载中文底稿 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.lang.title') }}</span>
        <LanguagePackCard />
      </section>

      <!-- 邀请码：固定在页面最底部；普通用户与限时展商可兑换（续期），永久展商和管理员只看说明 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.invite.title') }}</span>
        <div class="card">
          <template v-if="canRedeemInvite">
            <div class="field">
              <label class="sr-only" for="settings-invite">{{ t('settings.invite.title') }}</label>
              <input
                id="settings-invite"
                v-model="inviteCode"
                class="input"
                type="text"
                autocomplete="off"
                maxlength="32"
                :placeholder="t('settings.invite.placeholder')"
                :disabled="limited || inviteBusy"
              />
              <p v-if="inviteRenewHint" class="field-hint">{{ inviteRenewHint }}</p>
              <p v-else class="field-hint">{{ t('settings.invite.hint') }}</p>
            </div>
            <button
              class="cta"
              type="button"
              :disabled="limited || inviteBusy || !inviteCode.trim()"
              :data-loading="inviteBusy ? 'true' : undefined"
              @click="redeemInvite"
            >
              {{ t('settings.invite.submit') }}
            </button>
          </template>
          <p v-else class="field-hint">{{ inviteRoleHint }}</p>
        </div>
      </section>

      <!-- 安装到主屏幕：浏览器访问且还没装到主屏幕时出现；原生 App 里不出现 -->
      <section v-if="showInstallEntry" class="settings-section">
        <span class="section-label">{{ t('pwa.install.title') }}</span>
        <div class="card user-settings-card">
          <p class="field-hint">{{ installIntro }}</p>
          <button class="cta ghost" type="button" @click="openInstallSheet">
            {{ t('pwa.install.settingsEntry') }}
          </button>
        </div>
      </section>

      <!-- 应用更新：只在 Android 原生壳里出现；检查读取服务器解析出的版本与地址 -->
      <section v-if="showNativeUpdate" class="settings-section">
        <span class="section-label">{{ t('settings.update.title') }}</span>
        <div class="card user-settings-card">
          <button
            class="cta"
            type="button"
            :disabled="updateBusy"
            :data-loading="updateBusy ? 'true' : undefined"
            @click="checkUpdate()"
          >
            {{ updateBusy ? t('settings.update.checking') : t('settings.update.check') }}
          </button>
          <div class="switch-row" data-flush="true">
            <span class="switch-copy">
              <strong>{{ t('settings.update.auto') }}</strong>
              <span class="row-meta">{{ t('settings.update.autoHint') }}</span>
            </span>
            <label class="switch" for="settings-auto-update">
              <input
                id="settings-auto-update"
                type="checkbox"
                :checked="autoUpdate"
                @change="toggleAutoUpdate(($event.target as HTMLInputElement).checked)"
              />
              <span />
            </label>
          </div>
        </div>
      </section>

      <!-- 用户协议：固定在页面最底部（应用更新之后）；管理员关闭时整组不渲染 -->
      <section v-if="agreementEnabled" class="settings-section">
        <span class="section-label">{{ t('agreement.title') }}</span>
        <div class="card user-settings-card">
          <button class="text-action agreement-link" type="button" @click="router.push('/agreement')">
            {{ t('agreement.entry') }}
          </button>
        </div>
      </section>
    </div>
  </template>

  <!-- 头像裁剪抽屉：与个人页共用同一份全局状态（点铅笔保存资料后拉起系统选图） -->
  <ProfileAvatarCropper />
</template>

<style>
/* 分组：组标题在卡片外，组内 8px、组与组之间 20px。 */
.settings-groups {
  display: grid;
  gap: var(--s6);
}

.settings-section {
  display: grid;
  gap: var(--s2);
  align-content: start;
}

.settings-section > .section-label {
  justify-self: start;
}

/* 同一张卡里的分区（通知 / 隐私、配色 / 明暗、检查更新 / 自动更新）只用留白分开，
   不再画分隔横线：卡片行距比默认多一档，读起来仍然是独立的设置项。 */
.user-settings-card {
  gap: var(--s4);
}

/* 配色色板：12 色排成两行小圆点。每个按钮保留 44px 命中区，圆点只是视觉尺寸；
   选中用描边 + 对勾双重线索，不再用一颗大圆占满格子。 */
.swatch-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--s1);
}

.swatch {
  width: 100%;
  min-height: var(--touch);
  display: grid;
  place-items: center;
  background: transparent;
}

.swatch-dot {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--r-pill);
  color: var(--swatch-mark);
  transition: transform var(--motion-fast) var(--ease);
}

.swatch[aria-pressed='true'] .swatch-dot {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

.swatch[disabled] {
  opacity: 0.6;
}

@media (hover: hover) {
  .swatch:hover .swatch-dot {
    transform: scale(1.08);
  }
}
</style>
