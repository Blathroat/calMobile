<script setup lang="ts">
/**
 * 用户设置：头像、通知偏好、应用配色、深色模式、隐私开关与安全入口。
 *
 * 编辑资料与个人页简介标题旁的铅笔共用 `services/profile-editor.ts` 的同一抽屉。
 * 头像、通知、配色、明暗、隐私和安全入口留在这里，因为它们各自写不同的接口。
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
import { useRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { saveAccentIndex, saveUiMode } from '@/app/preferences';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { device } from '@/services/device-services';
import { toast } from '@/services/toast';
import { avatarExportMime } from '@/services/validate';
import { openProfileEditor } from '@/services/profile-editor';
import AvatarBox from '@/components/AvatarBox.vue';
import RoleTag from '@/components/RoleTag.vue';
import AvatarCropper from '@/components/AvatarCropper.vue';
import SegControl from '@/components/SegControl.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { JsonObject } from '@/api/types';
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
 * 本页专用说法。`t()` 不依赖响应式数据，在 setup 里取一次即可。
 */
const COPY = {
  /** 已经有头像时按钮要换个说法（资源里只有「上传头像」）。 */
  changeAvatar: t('settings.changeAvatar'),
  /** 卡片标题。顶栏已经是「设置」，这里把范围说成通知。 */
  notificationsTitle: t('settings.notify.title'),
  /** 安全入口的说明：这一页同时管邮箱与两步验证。 */
  securityMeta: t('settings.securityMeta'),
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
  loading.value = true;
  await Promise.all([loadProfile(), loadNotifications()]);
  loading.value = false;
}

async function loadProfile(): Promise<void> {
  profileLoading.value = true;
  profileError.value = '';
  try {
    const result = await api.profile.get();
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
    toast(granted ? t('settings.notify.permissionGranted') : t('settings.notify.permissionDenied'), granted ? 'success' : 'error');
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

/** 切换明暗模式：本地令牌先变，落库失败由 `saveUiMode` 回滚，这里只提示。 */
async function changeMode(value: string): Promise<void> {
  if (value === mode.value) return;
  try {
    await saveUiMode(value);
  } catch (reason) {
    toast(errorText(reason) || t('exhibition.form.saveFailed'), 'error');
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

    <template v-else>
      <SkeletonBlock v-if="profileLoading" :rows="2" />
      <StateBlock
        v-else-if="profileError"
        tone="error"
        :title="t('security.profileLoadFailed')"
        :description="profileError"
        :action-label="t('common.retry')"
        @action="loadProfile"
      />
      <!-- 头像卡：当前头像 + 编辑资料入口 + 上传 / 移除 -->
      <div class="card">
        <div class="row" data-gap="md">
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
          <span class="row-copy">
            <span class="name-line">
              <strong class="row-title">{{ user.nickname || user.username }}</strong>
              <RoleTag :role-code="String(user.role || '')" />
            </span>
            <span class="row-meta truncate">{{ user.email || t('settings.emailEmpty') }}</span>
          </span>
        </div>
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
        <div class="row" data-gap="md">
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

      <!-- 通知设置：两个偏好 + 系统通知权限入口 -->
      <div class="card">
        <span class="section-label">{{ COPY.notificationsTitle }}</span>
        <SkeletonBlock v-if="notifyLoading" :rows="2" />
        <StateBlock
          v-else-if="notifyError"
          tone="error"
          :title="t('settings.notify.loadFailed')"
          :description="notifyError"
          :action-label="t('common.retry')"
          @action="loadNotifications"
        />
        <div class="switch-row">
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
            >
            <span />
          </label>
        </div>
        <div class="switch-row">
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
            >
            <span />
          </label>
        </div>
        <!-- 系统通知权限只有设备知道：后端返回的 granted 只表示服务器侧开关可用 -->
        <button v-if="!notificationsGranted" class="cta ghost" type="button" @click="requestNotification">
          {{ t('settings.notify.requestPermission') }}
        </button>
      </div>

      <!-- 应用配色：点一下就换，没有「保存配色」这一步；色板里不放文字，选中只靠描边 -->
      <div class="card">
        <span class="section-label">{{ t('settings.theme.accent') }}</span>
        <div class="cluster">
          <button
            v-for="(color, index) in themeColors"
            :key="`${index}-${color}`"
            class="swatch"
            type="button"
            :style="{ background: color }"
            :aria-label="`${t('settings.theme.accent')} ${index + 1}`"
            :aria-pressed="index === accentIndex ? 'true' : 'false'"
            :disabled="accentBusy"
            @click="changeAccent(index)"
          />
        </div>
        <p class="field-hint">{{ COPY.accentHint }}</p>
      </div>

      <!-- 深色模式：分段控件，切换立即生效并保存到后端 -->
      <div class="card">
        <span class="section-label">{{ t('settings.theme.darkMode') }}</span>
        <SegControl
          :model-value="mode"
          :items="modeItems"
          :label="t('settings.theme.darkMode')"
          @update:model-value="changeMode"
        />
      </div>

      <!-- 隐私：是否在公开页展示自己的报名记录（原先在个人页，按反馈收进设置） -->
      <div class="card">
        <span class="section-label">{{ t('settings.privacy') }}</span>
        <div class="switch-row">
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
            >
            <span />
          </label>
        </div>
        <p v-if="limited" class="field-hint">{{ limitHint }}</p>
      </div>

      <!-- 安全：邮箱与两步验证共用同一套凭据，因此放在同一张卡里 -->
      <div class="card">
        <span class="section-label">{{ t('security.section') }}</span>
        <button class="row-card" type="button" data-pressable="true" @click="router.push('/security')">
          <span class="row-copy">
            <strong class="row-title">{{ t('security.section') }}</strong>
            <span class="row-meta">{{ COPY.securityMeta }}</span>
          </span>
          <span class="dim" aria-hidden="true">›</span>
        </button>
      </div>
    </template>
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
