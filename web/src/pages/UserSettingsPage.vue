<script setup lang="ts">
/**
 * 用户设置：编辑资料、修改密码、通知偏好、应用配色、深色模式与安全入口。
 *
 * 为什么从个人页拆出来：个人页回答的是「我是谁、我公开了什么」（只读展示 + 一个隐私开关），
 * 而这里的每一项都会写后端（`PUT /profile`、`PUT /profile/password`、
 * `PUT /profile/notifications`、`PUT /settings/*`）。「看」与「改」分开后，两边各自都短，
 * 也不会再出现「点了保存却不知道保存的是哪块」。
 *
 * 头像链路：`media.pickImage` 选图 → 共享组件 `AvatarCropper`（单指拖动 + 双指捏合裁剪）
 * → `media.store` 落盘换短 URL → 写进资料。手势、取景与导出都在组件里，本页只负责
 * 「拿到裁剪后的 dataUrl 之后的事」；组件交付 dataUrl 后自己走退场动画，落盘不受影响。
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
import { check, limit, matchRule, passwordRule, passwordStrength, validateAll } from '@/services/validate';
import AvatarBox from '@/components/AvatarBox.vue';
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
const limitHint = computed(() => t('s_1kliyri'));

/**
 * 资源文件里还没有的说法，先写成普通字符串字面量。
 *
 * 为什么放在脚本里而不是直接写在模板里：`scripts/extract-strings.js` 只扫描 `<script setup>`，
 * 模板里的中文不会被抽取。下次运行 `node scripts/extract-strings.js --write` 时，这些字面量
 * 会被换成 `t(...)` 调用并补进 strings_frontend.xml —— 因此这里不自己造 key，也不手改那个 XML。
 */
const COPY = {
  /** 已经有头像时按钮要换个说法（资源里只有「上传头像」）。 */
  changeAvatar: t('s_1u0qxq'),
  /** 卡片标题：资源里的 `s_1vmubx9` 就是「设置」，与顶栏标题重名，这里说明得更具体。 */
  notificationsTitle: t('s_1ee0t5g'),
  /** 安全入口的说明：这一页同时管邮箱与两步验证。 */
  securityMeta: t('s_aebw86'),
  /** 配色没有保存按钮，用它解释「点了就生效」。 */
  accentHint: t('s_12cew5p'),
};

// ── 取数 ──────────────────────────────────────────────────────────

const profile = reactive<JsonObject>({});
const notify = reactive({ exhibitionReminder: true, registrationUpdates: true, granted: false });
const loading = ref(true);
const loadFailed = ref(false);
const loadError = ref('');

const notificationsGranted = computed(() => {
  const value = capabilities.values.notifications;
  // 有桥接时以设备事实为准；浏览器预览退回后端下发的值。
  return typeof value === 'boolean' ? value : notify.granted === true;
});

/** 取数失败优先用后端/传输层自带的原因，没有就回落到通用文案。 */
function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('s_1q9u8le');
}

/**
 * 个人资料与通知偏好并行拉取：正好对应本页的两组开关/表单。
 *
 * 两份都失败按加载失败处理（原位错误块 + 重试）：后端没起时页面照常画出来、
 * 开关显示全开，是最容易让人误判「加载成功」的一种假象。只失败一份时保留另一份，
 * 用 toast 说明缺的是哪一块。
 */
async function load(): Promise<void> {
  await bootApp().catch(() => undefined);
  loading.value = true;
  const [profileResult, notifyResult] = await Promise.allSettled([
    api.profile.get(),
    api.profile.notifications(),
  ]);

  const warnings: string[] = [];
  if (profileResult.status === 'fulfilled') {
    Object.assign(profile, profileResult.value ?? {});
    session.applyUser({ ...user.value, ...profileResult.value });
  } else {
    warnings.push(t('s_1sz2kuw'));
  }
  if (notifyResult.status === 'fulfilled') {
    Object.assign(notify, { exhibitionReminder: true, registrationUpdates: true, granted: false }, notifyResult.value ?? {});
  } else {
    warnings.push(t('s_121kyl5'));
  }

  if (profileResult.status === 'rejected' && notifyResult.status === 'rejected') {
    loadFailed.value = true;
    loadError.value = errorText(profileResult.reason) || errorText(notifyResult.reason);
    loading.value = false;
    return;
  }

  loadFailed.value = false;
  loadError.value = '';
  loading.value = false;
  warnings.forEach((message) => toast(message, 'error'));
}

onMounted(load);

// ── 头像：选图 → 共享组件裁剪 → media.store 落盘 ──────────────────

const avatarBusy = ref(false);
const avatarMessage = ref('');
const avatarError = ref('');
/** 非空时渲染裁剪面板；组件关闭后由 `@close` 清空，避免下次打开先闪一眼上一张。 */
const cropSource = ref('');

/** 受限账号不能写资料：先拦一次，避免置灰按钮被聚焦或旧缓存页面点到。 */
function guardLimited(): boolean {
  if (!limited.value) return false;
  toast(limitHint.value, 'error');
  return true;
}

/** 选图只负责拿到 dataUrl；裁剪交给 AvatarCropper，取消选图不做提示（与系统选择器一致）。 */
async function pickAvatar(): Promise<void> {
  if (guardLimited()) return;
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
    avatarError.value = t('s_1dc9o49');
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

/** `@done` 拿到的就是裁剪后的方图 dataUrl；这里落盘换短 URL，再写进资料。 */
async function storeAvatar(dataUrl: string): Promise<void> {
  avatarBusy.value = true;
  try {
    const stored = await device.storeMedia({ dataUrl, kind: 'avatar' });
    const url = String(stored?.url || '');
    if (!url) {
      avatarError.value = t('s_5iff2f');
      return;
    }
    await saveAvatar(url);
  } catch (reason) {
    avatarError.value = t('s_5iff2f');
    toast(errorText(reason) || t('s_5iff2f'), 'error');
  } finally {
    avatarBusy.value = false;
  }
}

/** 头像与资料同属 `PUT /profile`：写入后把整份用户对象合并回会话。 */
async function saveAvatar(url: string): Promise<void> {
  if (guardLimited()) return;
  avatarMessage.value = '';
  avatarError.value = '';
  try {
    const saved = await api.profile.save({
      nickname: String(user.value.nickname || user.value.username || ''),
      bio: String(profile.bio || ''),
      region: String(profile.region || ''),
      socialMedia: String(profile.socialMedia || ''),
      avatar: url,
      showRegistrations: profile.showRegistrations === true,
    });
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.applyUser({ ...user.value, ...fresh });
    Object.assign(profile, fresh);
    avatarMessage.value = url ? t('s_3rxr06') : t('s_14ol5jh');
    toast(avatarMessage.value, 'success');
  } catch (reason) {
    avatarError.value = t('s_5iff2f');
    toast(errorText(reason) || t('s_5iff2f'), 'error');
  }
}

// ── 编辑资料 ──────────────────────────────────────────────────────

const editing = ref(false);
const editBusy = ref(false);
const editError = ref('');
const editForm = reactive({ nickname: '', bio: '', region: '', socialMedia: '' });
const editInvalid = reactive({ nickname: false, bio: false, region: false, socialMedia: false });

function openEditor(): void {
  if (guardLimited()) return;
  editForm.nickname = String(user.value.nickname || user.value.username || '');
  editForm.bio = String(profile.bio || '');
  editForm.region = String(profile.region || '');
  editForm.socialMedia = String(profile.socialMedia || '');
  Object.assign(editInvalid, { nickname: false, bio: false, region: false, socialMedia: false });
  editError.value = '';
  // 两份表单共用页脚上的保存按钮，同时只能开一个。
  passwordOpen.value = false;
  editing.value = true;
}

function closeEditor(): void {
  editing.value = false;
  editError.value = '';
}

/** 校验一次并把错误落到对应字段上，返回是否通过。 */
function validateEditor(): boolean {
  const nicknameError = check(editForm.nickname, {
    label: t('s_1c2rfxc'),
    required: true,
    max: limit('nickname', 20),
  });
  const bioError = check(editForm.bio, { label: t('s_ml9unw'), max: limit('bio', 200) });
  const regionError = check(editForm.region, { label: t('s_11ftk7j'), max: limit('region', 40) });
  const socialError = check(editForm.socialMedia, { label: t('s_1hnvqec'), max: limit('socialMedia', 40) });

  editInvalid.nickname = nicknameError !== '';
  editInvalid.bio = bioError !== '';
  editInvalid.region = regionError !== '';
  editInvalid.socialMedia = socialError !== '';

  const result = validateAll([() => nicknameError, () => bioError, () => regionError, () => socialError]);
  editError.value = result.message;
  return result.ok;
}

async function saveEditor(): Promise<void> {
  if (!validateEditor()) return;
  editBusy.value = true;
  try {
    const saved = await api.profile.save({
      nickname: editForm.nickname.trim(),
      bio: editForm.bio.trim(),
      region: editForm.region.trim(),
      socialMedia: editForm.socialMedia.trim(),
      // 头像与公开开关不在这个表单里改，但仍要原样回传，避免后端把未提及的字段当成清空。
      avatar: String(user.value.avatar || ''),
      showRegistrations: profile.showRegistrations === true,
    });
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.applyUser({ ...user.value, ...fresh });
    Object.assign(profile, fresh);
    editing.value = false;
    editError.value = '';
    toast(t('s_i86pw9'), 'success');
  } catch (reason) {
    editError.value = errorText(reason);
  } finally {
    editBusy.value = false;
  }
}

// ── 修改密码（演示环境只校验输入格式） ────────────────────────────

const passwordOpen = ref(false);
const passwordBusy = ref(false);
const passwordError = ref('');
const passwordForm = reactive({ current: '', next: '', confirm: '' });
const passwordInvalid = reactive({ current: false, next: false, confirm: false });
const passwordMin = computed(() => Number(passwordRule().min) || 6);
const passwordMax = computed(() => Number(passwordRule().max) || 32);
/** 强度只作提示，不参与提交拦截（与注册页同一套 `passwordStrength`）。 */
const passwordMeter = computed(() => passwordStrength(passwordForm.next));

function openPassword(): void {
  Object.assign(passwordForm, { current: '', next: '', confirm: '' });
  Object.assign(passwordInvalid, { current: false, next: false, confirm: false });
  passwordError.value = '';
  editing.value = false;
  passwordOpen.value = true;
}

function closePassword(): void {
  passwordOpen.value = false;
  passwordError.value = '';
}

function validatePassword(): boolean {
  const rule = passwordRule();
  const currentError = check(passwordForm.current, { label: t('s_1q7kb1c'), required: true, max: rule.max });
  const nextError = check(passwordForm.next, {
    ...rule,
    required: true,
    custom: (value) => matchRule(value, passwordForm.confirm),
  });
  const confirmError = check(passwordForm.confirm, { label: t('s_1b253gw'), required: true, max: rule.max });

  passwordInvalid.current = currentError !== '';
  passwordInvalid.next = nextError !== '';
  passwordInvalid.confirm = confirmError !== '';

  const result = validateAll([() => currentError, () => nextError, () => confirmError]);
  passwordError.value = result.message;
  return result.ok;
}

async function savePassword(): Promise<void> {
  if (!validatePassword()) return;
  passwordBusy.value = true;
  try {
    const saved = await api.profile.changePassword({
      currentPassword: passwordForm.current,
      newPassword: passwordForm.next,
      confirmPassword: passwordForm.confirm,
    });
    passwordOpen.value = false;
    toast(String(saved.note || t('s_4hjltm')), 'success');
  } catch (reason) {
    passwordError.value = errorText(reason) || t('s_a7qley');
  } finally {
    passwordBusy.value = false;
  }
}

// ── 通知设置 ──────────────────────────────────────────────────────

const savingPreference = ref('');

async function savePreferences(patch: JsonObject): Promise<void> {
  const key = Object.keys(patch)[0] ?? '';
  savingPreference.value = key;
  try {
    // 写接口统一返回 `{ ok, error, notify }`；失败时提示且不改动开关。
    const result = await api.profile.saveNotifications(patch);
    Object.assign(notify, result.notify ?? {});
    toast(t('s_15wm4xy'), 'success');
  } catch (reason) {
    toast(errorText(reason), 'error');
  } finally {
    savingPreference.value = '';
  }
}

async function requestNotification(): Promise<void> {
  try {
    const result = await device.requestNotificationPermission();
    const granted = result.granted === true;
    notify.granted = granted;
    // 拿到结果后同步到设备能力，按钮的显隐以它为准（见 notificationsGranted）。
    capabilities.apply({ notifications: granted });
    toast(granted ? t('s_j5c9oy') : t('s_1ya7561'), granted ? 'success' : 'error');
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
    toast(t('s_145fdbt'), 'success');
  } catch (reason) {
    toast(errorText(reason) || t('s_1q9u8le'), 'error');
  } finally {
    accentBusy.value = false;
  }
}

// ── 明暗模式 ──────────────────────────────────────────────────────

const modeItems = computed(() => [
  { value: 'auto', label: t('s_1e3rp8l') },
  { value: 'light', label: t('s_4wwqgm') },
  { value: 'dark', label: t('s_bsz4ru') },
]);

const mode = computed(() => settings.mode);

/** 说明当前模式的实际效果：切换后跟着变，用户不用猜「跟随系统」现在是什么色。 */
const modeHint = computed(() => {
  if (mode.value === 'auto') return t('s_1mlidnr');
  return mode.value === 'dark' ? t('s_1ylfcsc') : t('s_141p70w');
});

/** 切换明暗模式：本地令牌先变，落库失败由 `saveUiMode` 回滚，这里只提示。 */
async function changeMode(value: string): Promise<void> {
  if (value === mode.value) return;
  try {
    await saveUiMode(value);
  } catch (reason) {
    toast(errorText(reason) || t('s_1q9u8le'), 'error');
  }
}
</script>

<template>
  <!-- 访客：这一页每一项都依赖登录身份，未登录时原位说明并给出登录入口 -->
  <StateBlock
    v-if="!loggedIn"
    icon="user"
    :title="t('s_1h1rste')"
    :description="t('s_1b7h1x')"
    :action-label="t('s_533bde')"
    @action="router.push({ path: '/login', query: { redirect: '/settings' } })"
  />

  <template v-else>
    <SkeletonBlock v-if="loading" :rows="4" />

    <StateBlock
      v-else-if="loadFailed"
      tone="error"
      :title="t('s_1sz2kuw')"
      :description="loadError"
      :action-label="t('s_lswd2v')"
      @action="load"
    />

    <template v-else>
      <!-- 头像卡：当前头像 + 编辑资料入口 + 上传 / 移除 -->
      <div class="card">
        <div class="row" data-gap="md">
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
          <span class="row-copy">
            <strong class="row-title">{{ user.nickname || user.username }}</strong>
            <span class="row-meta truncate">{{ user.email || t('s_1hhb6bo') }}</span>
          </span>
        </div>
        <button
          class="cta ghost"
          data-size="small"
          type="button"
          :disabled="limited"
          :title="limited ? limitHint : undefined"
          @click="openEditor"
        >
          {{ t('s_1sq2bvr') }}
        </button>
        <div class="row" data-gap="md">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited || avatarBusy"
            :title="limited ? limitHint : undefined"
            @click="pickAvatar"
          >
            {{ user.avatar ? COPY.changeAvatar : t('s_onix0y') }}
          </button>
          <button
            v-if="user.avatar"
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited || avatarBusy"
            :title="limited ? limitHint : undefined"
            @click="saveAvatar('')"
          >
            {{ t('s_1no1khr') }}
          </button>
        </div>
        <p v-if="avatarMessage" class="notice" data-tone="accent" role="status">{{ avatarMessage }}</p>
        <p v-if="avatarError" class="field-error" role="alert">{{ avatarError }}</p>
      </div>

      <div v-if="limited" class="notice" data-tone="accent">
        <strong>{{ limitHint }}</strong>
        <span>{{ t('s_13i47qi') }}</span>
      </div>

      <!-- 编辑资料：原位展开，校验失败就落在字段上（`.field[data-invalid]` + 顶部说明） -->
      <div v-if="editing" class="card form">
        <span class="section-label">{{ t('s_1sq2bvr') }}</span>
        <div class="field" :data-invalid="editInvalid.nickname ? 'true' : 'false'">
          <label for="settings-nickname">{{ t('s_1c2rfxc') }}</label>
          <input
            id="settings-nickname"
            v-model="editForm.nickname"
            class="input"
            type="text"
            :maxlength="limit('nickname', 20)"
          >
        </div>
        <div class="field" :data-invalid="editInvalid.bio ? 'true' : 'false'">
          <label for="settings-bio">{{ t('s_ml9unw') }}</label>
          <textarea id="settings-bio" v-model="editForm.bio" class="textarea" rows="3" :maxlength="limit('bio', 200)" />
        </div>
        <div class="field" :data-invalid="editInvalid.region ? 'true' : 'false'">
          <label for="settings-region">{{ t('s_11ftk7j') }}</label>
          <input
            id="settings-region"
            v-model="editForm.region"
            class="input"
            type="text"
            :maxlength="limit('region', 40)"
            :placeholder="t('s_132uhjs')"
          >
        </div>
        <div class="field" :data-invalid="editInvalid.socialMedia ? 'true' : 'false'">
          <label for="settings-social">{{ t('s_1hnvqec') }}</label>
          <input
            id="settings-social"
            v-model="editForm.socialMedia"
            class="input"
            type="text"
            :maxlength="limit('socialMedia', 40)"
          >
        </div>
        <p v-if="editError" class="field-error" role="alert">{{ editError }}</p>
      </div>

      <!-- 修改密码：与编辑资料一样原位展开，保存入口同样投递到页脚 -->
      <div class="list" data-gap="sm">
        <button class="row-card" type="button" data-pressable="true" @click="openPassword">
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1pt7oo1') }}</strong>
            <span class="row-meta">{{ t('s_1pt7oo1') }}（至少 {{ passwordMin }} 个字符）</span>
          </span>
          <span class="dim" aria-hidden="true">›</span>
        </button>
      </div>

      <div v-if="passwordOpen" class="card form">
        <span class="section-label">{{ t('s_1pt7oo1') }}</span>
        <div class="field" :data-invalid="passwordInvalid.current ? 'true' : 'false'">
          <label for="password-current">{{ t('s_1q7kb1c') }}</label>
          <input
            id="password-current"
            v-model="passwordForm.current"
            class="input"
            type="password"
            autocomplete="current-password"
          >
        </div>
        <div class="field" :data-invalid="passwordInvalid.next ? 'true' : 'false'">
          <label for="password-next">{{ t('s_9sfqbi') }}（{{ passwordMin }}–{{ passwordMax }} 个字符）</label>
          <input
            id="password-next"
            v-model="passwordForm.next"
            class="input"
            type="password"
            autocomplete="new-password"
          >
        </div>
        <div class="row" data-between="true">
          <span class="row-meta">{{ t('s_1lj253k') }}</span>
          <span class="password-meter" :data-level="passwordMeter.level">{{ passwordMeter.label }}</span>
        </div>
        <div class="field" :data-invalid="passwordInvalid.confirm ? 'true' : 'false'">
          <label for="password-confirm">{{ t('s_1b253gw') }}</label>
          <input
            id="password-confirm"
            v-model="passwordForm.confirm"
            class="input"
            type="password"
            autocomplete="new-password"
          >
        </div>
        <p v-if="passwordError" class="field-error" role="alert">{{ passwordError }}</p>
        <p class="field-hint">{{ t('s_faylcn') }}</p>
      </div>

      <!-- 通知设置：两个偏好 + 系统通知权限入口 -->
      <div class="card">
        <span class="section-label">{{ COPY.notificationsTitle }}</span>
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_1f8zcmv') }}</strong>
            <span class="row-meta">{{ t('s_kiu9q') }}</span>
          </span>
          <label class="switch" for="notify-reminder">
            <input
              id="notify-reminder"
              type="checkbox"
              :checked="notify.exhibitionReminder"
              :disabled="savingPreference === 'exhibitionReminder'"
              @change="savePreferences({ exhibitionReminder: ($event.target as HTMLInputElement).checked })"
            >
            <span />
          </label>
        </div>
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_fz8qsa') }}</strong>
            <span class="row-meta">{{ t('s_1xohyb0') }}</span>
          </span>
          <label class="switch" for="notify-status">
            <input
              id="notify-status"
              type="checkbox"
              :checked="notify.registrationUpdates"
              :disabled="savingPreference === 'registrationUpdates'"
              @change="savePreferences({ registrationUpdates: ($event.target as HTMLInputElement).checked })"
            >
            <span />
          </label>
        </div>
        <!-- 系统通知权限只有设备知道：后端返回的 granted 只表示服务器侧开关可用 -->
        <button v-if="!notificationsGranted" class="cta ghost" type="button" @click="requestNotification">
          {{ t('s_1splm64') }}
        </button>
      </div>

      <!-- 应用配色：点一下就换，没有「保存配色」这一步；色板里不放文字，选中只靠描边 -->
      <div class="card">
        <span class="section-label">{{ t('s_4odn3m') }}</span>
        <div class="cluster">
          <button
            v-for="(color, index) in themeColors"
            :key="`${index}-${color}`"
            class="swatch"
            type="button"
            :style="{ background: color }"
            :aria-label="`${t('s_4odn3m')} ${index + 1}`"
            :aria-pressed="index === accentIndex ? 'true' : 'false'"
            :disabled="accentBusy"
            @click="changeAccent(index)"
          />
        </div>
        <p class="field-hint">{{ COPY.accentHint }}</p>
      </div>

      <!-- 深色模式：分段控件，切换立即生效并保存到后端 -->
      <div class="card">
        <span class="section-label">{{ t('s_1ghvdtm') }}</span>
        <SegControl
          :model-value="mode"
          :items="modeItems"
          :label="t('s_1ghvdtm')"
          @update:model-value="changeMode"
        />
        <p class="field-hint">{{ modeHint }}</p>
      </div>

      <!-- 安全：邮箱与两步验证共用同一套凭据，因此放在同一张卡里 -->
      <div class="card">
        <span class="section-label">{{ t('s_1apxo2s') }}</span>
        <button class="row-card" type="button" data-pressable="true" @click="router.push('/security')">
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1apxo2s') }}</strong>
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
    @done="storeAvatar"
    @close="cropSource = ''"
    @error="onCropError"
  />

  <!-- 固定操作区：编辑资料与修改密码共用的保存 / 取消入口 -->
  <Teleport v-if="editing || passwordOpen" defer to="#app-foot">
    <div class="page-foot row" data-gap="sm">
      <button
        class="cta"
        type="button"
        :disabled="editBusy || passwordBusy"
        @click="editing ? saveEditor() : savePassword()"
      >
        {{ editing ? t('s_1c3mapc') : t('s_13ekny6') }}
      </button>
      <button
        class="cta ghost"
        type="button"
        :disabled="editBusy || passwordBusy"
        @click="editing ? closeEditor() : closePassword()"
      >
        {{ t('s_1589w37') }}
      </button>
    </div>
  </Teleport>
</template>
