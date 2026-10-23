<script setup lang="ts">
/**
 * 用户设置：头像、通知与隐私、外观（配色与明暗）、语言。
 *
 * 版式按「账号 / 通知与隐私 / 外观 / 语言 / 邀请码」分组：组标题在卡片外，卡片里的
 * 开关行用 `.switch-row[data-flush='true']` 的分隔线版式，不再套第二层边框。邀请码
 * 固定在页面最底部：普通用户显示输入框，展商与管理员只说明身份已升级。
 *
 * 编辑资料与个人页身份卡右侧的铅笔共用 `services/profile-editor.ts` 的同一抽屉。
 * 头像、通知、配色、明暗、语言、隐私留在这里，因为它们各自写不同的接口。
 * 安全设置只从个人页进入，本页不再提供入口。语言包在本机，不写后端。
 *
 * 头像链路：`media.pickImage` 选图 → 共享组件 `AvatarCropper`（单指拖动 + 双指捏合裁剪）
 * → `POST /profile/avatar` 把方图传到服务器。手势、取景与导出都在组件里，本页只负责
 * 「拿到裁剪后的 dataUrl 之后的事」；组件交付 dataUrl 后自己走退场动画，上传不受影响。
 * 导出格式跟管理设置里的头像格式走：优先 jpeg，否则 png，再否则 webp。
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
import { toast } from '@/services/toast';
import { avatarExportMime } from '@/services/validate';
import { formatLocalChineseDate } from '@/services/format';
import { openProfileEditor } from '@/services/profile-editor';
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
import AvatarCropper from '@/components/AvatarCropper.vue';
import UpdateSheet from '@/components/UpdateSheet.vue';
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
/** 受限账号：只有后端明确下发 `false` 才算，老后端不下发 `profile` 时行为不变。 */
const limited = computed(() => user.value.can?.profile === false);
/** 受限时统一用同一句说明原因，避免每个入口各写一套说法。 */
const limitHint = computed(() => t('profile.restricted'));
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
  /** 已经有头像时按钮要换个说法（资源里只有「上传头像」）。 */
  changeAvatar: t('settings.changeAvatar'),
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
// 自动检查更新：开关打开且距上次检查超过六小时，静默跑一次（失败不提示）。
onMounted(() => {
  void checkUpdate(true);
});

usePullRefresh(
  () => load(),
  computed(() => !loading.value && (profileLoading.value || notifyLoading.value)),
  loggedIn,
);

// ── 头像：选图 → 共享组件裁剪 → 上传到服务器 ────────────────────

const avatarMime = computed(() => avatarExportMime());

const avatarBusy = ref(false);
const avatarMessage = ref('');
const avatarError = ref('');
/** 非空时渲染裁剪面板；组件关闭后由 `@close` 清空，避免下次打开先闪一眼上一张。 */
const cropSource = ref('');

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

/** 选图只负责拿到 dataUrl；裁剪交给 AvatarCropper，取消选图不做提示（与系统选择器一致）。 */
async function pickAvatar(): Promise<void> {
  if (guardProfileWrite()) return;
  avatarMessage.value = '';
  avatarError.value = '';
  let picked;
  try {
    picked = await device.pickImage();
  } catch (reason) {
    // 用户在系统选择器点了取消：按稳定错误码判断，不匹配文案。
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    avatarError.value = errorText(reason);
    return;
  }
  const source = String(picked?.dataUrl || '');
  if (!source) {
    avatarError.value = t('admin.media.unreadableImage');
    return;
  }
  cropSource.value = source;
}

/**
 * 裁剪面板报错：面板自己不关闭，所以同时落原位提示与 toast。
 *
 * 原位提示要等面板关掉才看得见，toast 的层级（z-index 60）高于面板（40），
 * 用户在面板还开着的时候就能读到原因。
 */
function onCropError(message: string): void {
  avatarError.value = message;
  toast(message, 'error');
}

/** 把裁剪结果的 data URL 解成字节。认不出时返回 null，由调用方提示。 */
function avatarBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  const payload = match?.[2]?.replace(/\s/g, '') ?? '';
  if (!match?.[1] || !payload) return null;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, contentType: match[1].toLowerCase() };
}

/** `@done` 拿到的就是裁剪后的方图 dataUrl；这里上传到服务器并写进资料。 */
async function storeAvatar(dataUrl: string): Promise<void> {
  if (guardProfileWrite()) return;
  const image = avatarBytes(dataUrl);
  if (!image) {
    avatarError.value = t('admin.media.unreadableImage');
    toast(avatarError.value, 'error');
    return;
  }
  avatarBusy.value = true;
  try {
    const saved = await api.profile.uploadAvatar(image.bytes, image.contentType);
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.bumpProfile();
    session.applyUser({ ...user.value, ...fresh });
    Object.assign(profile, fresh);
    avatarMessage.value = t('settings.avatarUpdated');
    toast(avatarMessage.value, 'success');
  } catch (reason) {
    avatarError.value = errorText(reason);
    toast(avatarError.value, 'error');
  } finally {
    avatarBusy.value = false;
  }
}

/** 移除头像：服务端清掉资料里的地址，并删除自己保存的文件。 */
async function removeAvatar(): Promise<void> {
  if (guardProfileWrite()) return;
  avatarBusy.value = true;
  avatarMessage.value = '';
  avatarError.value = '';
  try {
    const saved = await api.profile.removeAvatar();
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.bumpProfile();
    session.applyUser({ ...user.value, ...fresh });
    Object.assign(profile, fresh);
    avatarMessage.value = t('settings.avatarRemoved');
    toast(avatarMessage.value, 'success');
  } catch (reason) {
    avatarError.value = errorText(reason);
    toast(avatarError.value, 'error');
  } finally {
    avatarBusy.value = false;
  }
}

/** 编辑资料：与个人页铅笔打开的是同一抽屉。资料没加载完或账号受限时先拦住。 */
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

/**
 * 检查更新。
 *
 * `auto` 为真时不显示加载态、失败也不提示；命中新版本且本机还没自动提示过
 * 同一个标记（GitHub 是版本号，直链是下载地址）时才弹抽屉。
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
        <!-- 身份卡：当前头像、昵称与邮箱；编辑资料、更换头像、移除头像同一行。资料失败时卡片仍在，按钮置灰。 -->
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
            <button
              class="cta ghost"
              data-size="small"
              type="button"
              :disabled="limited || !profileReady || avatarBusy"
              :title="limited ? limitHint : undefined"
              @click="pickAvatar"
            >
              {{ user.avatar ? COPY.changeAvatar : t('settings.uploadAvatar') }}
            </button>
            <button
              v-if="user.avatar"
              class="cta ghost"
              data-size="small"
              type="button"
              :disabled="limited || !profileReady || avatarBusy"
              :title="limited ? limitHint : undefined"
              @click="removeAvatar"
            >
              {{ t('settings.removeAvatar') }}
            </button>
          </div>
          <p v-if="avatarMessage" class="notice" data-tone="accent" role="status">{{ avatarMessage }}</p>
          <p v-if="avatarError" class="field-error" role="alert">{{ avatarError }}</p>
        </div>

        <div v-if="limited" class="notice" data-tone="accent">
          <strong>{{ limitHint }}</strong>
          <span>{{ t('settings.limitUnaffected') }}</span>
        </div>
      </section>

      <!-- 通知与隐私：通知偏好、系统通知权限与报名公开展示 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.section.notifyPrivacy') }}</span>
        <div class="card">
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
          <hr class="divider" />
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
          <p v-if="limited" class="field-hint">{{ limitHint }}</p>
        </div>
      </section>

      <!-- 外观：配色与明暗都点一下就生效，没有保存按钮 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.section.appearance') }}</span>
        <div class="card">
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
          <hr class="divider" />
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

      <!-- 应用更新：固定在页面最底部；检查读取服务器解析出的版本与地址 -->
      <section class="settings-section">
        <span class="section-label">{{ t('settings.update.title') }}</span>
        <div class="card">
          <button
            class="cta"
            type="button"
            :disabled="updateBusy"
            :data-loading="updateBusy ? 'true' : undefined"
            @click="checkUpdate()"
          >
            {{ updateBusy ? t('settings.update.checking') : t('settings.update.check') }}
          </button>
          <hr class="divider" />
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
    </div>
  </template>

  <!-- 裁剪面板：共享组件负责手势、取景与导出；这里只在有图时挂载，关闭即丢弃旧图 -->
  <AvatarCropper
    v-if="cropSource"
    :source="cropSource"
    :mime="avatarMime"
    @done="storeAvatar"
    @close="cropSource = ''"
    @error="onCropError"
  />
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
