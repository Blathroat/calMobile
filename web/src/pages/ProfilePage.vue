<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（资料区 + 外观区 + 通知设置区）
 * 线框：docs/newUI/remaining-ui.html #screen-profile
 * 旧实现：app/src/main/assets/web/js/pages/profile.js（`git show 5e3d9ab^`）
 *
 * 三块内容都从会话用户出发：资料写入走 `PUT /profile`，通知偏好走
 * `PUT /profile/notifications`，明暗模式走 `PUT /settings/ui-mode`。受限账号
 * （后端明确下发 `can.profile === false`）不能改资料，页面上所有相关入口统一置灰并说明原因，
 * 而不是等后端 403。
 *
 * 头像链路与旧版一致：原生选图 → 圆形裁剪 → `media.store` 落盘换短 URL → 写进资料。
 * 裁剪手势只在面板打开后绑定，关闭即解绑，避免重开时监听器叠加。
 *
 * 安全设置（邮箱 / 两步验证 / 验证器 / 备用码）已按屏幕拆分到 `SecurityPage.vue`，
 * 这里只保留旧页面的「安全」分区与进入安全设置的入口。
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { applyMode, applyTheme } from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { device } from '@/services/device-services';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { check, limit, matchRule, passwordRule, validateAll } from '@/services/validate';
import AvatarBox from '@/components/AvatarBox.vue';
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
const isAdmin = computed(() => user.value.can?.admin === true);

/** 受限时统一用同一句说明原因，避免每个入口各写一套说法。 */
const limitHint = computed(() => t('s_1kliyri'));

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
 * 通知偏好与个人资料并行拉取。
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

// ── 身份卡 ────────────────────────────────────────────────────────

const avatarBusy = ref(false);
const avatarMessage = ref('');
const avatarError = ref('');

function identityMeta(): string {
  const role = String(user.value.roleLabel || '');
  const status = String(user.value.status || t('s_tt5vxa'));
  return role ? `${role} · ${status}` : status;
}

/** 资料字段的展示值：缺失时沿用旧页面给出的空态文案。 */
function profileValue(key: string, emptyKey: string): string {
  const value = profile[key];
  return typeof value === 'string' && value !== '' ? value : t(emptyKey);
}

// ── 编辑资料 ──────────────────────────────────────────────────────

const editing = ref(false);
const editBusy = ref(false);
const editError = ref('');
const editForm = reactive({ nickname: '', bio: '', region: '', socialMedia: '' });
const editInvalid = reactive({ nickname: false, bio: false, region: false, socialMedia: false });

/** 受限账号不能写资料：先拦一次，避免置灰按钮被聚焦或旧缓存页面点到。 */
function guardLimited(): boolean {
  if (!limited.value) return false;
  toast(limitHint.value, 'error');
  return true;
}

function openEditor(): void {
  if (guardLimited()) return;
  editForm.nickname = String(user.value.nickname || user.value.username || '');
  editForm.bio = String(profile.bio || '');
  editForm.region = String(profile.region || '');
  editForm.socialMedia = String(profile.socialMedia || '');
  Object.assign(editInvalid, { nickname: false, bio: false, region: false, socialMedia: false });
  editError.value = '';
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

// ── 隐私开关 ──────────────────────────────────────────────────────

const privacyBusy = ref(false);

/** 开关立即生效：失败时回滚界面状态，避免看起来已保存。 */
async function savePrivacy(value: boolean): Promise<void> {
  if (guardLimited()) return;
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
    toast(value ? t('s_92i7f7') : t('s_dn42iy'), 'success');
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

// ── 外观：明暗模式 ────────────────────────────────────────────────

const modeItems = computed(() => [
  { value: 'auto', label: t('s_1e3rp8l') },
  { value: 'light', label: t('s_4wwqgm') },
  { value: 'dark', label: t('s_bsz4ru') },
]);

const mode = computed(() => settings.mode);

const modeHint = computed(() => {
  if (mode.value === 'auto') return t('s_1mlidnr');
  return mode.value === 'dark' ? t('s_1ylfcsc') : t('s_141p70w');
});

/**
 * 切换明暗模式：先落令牌立即生效，再保存到后端。
 * 保存失败（例如尚未登录）只提示一次，本次会话的外观仍然保留 —— 这正是 applyMode 先行的原因。
 */
async function changeMode(value: string): Promise<void> {
  applyMode(value);
  try {
    const result = await api.settings.saveUiMode(value);
    if (typeof result.mode === 'string') applyMode(result.mode);
  } catch (reason) {
    toast(`外观已切换，但未能保存：${errorText(reason)}`, 'error');
  }
}

// ── 外观：管理员配色 ──────────────────────────────────────────────

/** 本地预览用的选中下标：保存前不落库，避免「预览」被当成「已保存」。 */
const themeIndex = ref(0);
const themeSaving = ref(false);

watch(() => bootstrap.theme.index, (value) => { themeIndex.value = Number(value) || 0; }, { immediate: true });

const themeColors = computed<string[]>(() => {
  const list = bootstrap.theme.colors;
  return Array.isArray(list) ? list.map((item) => String(item)) : [];
});

/** 立即预览：把选中的配色写进 CSS 变量，再重绘选中环。 */
function previewTheme(index: number): void {
  themeIndex.value = index;
  bootstrap.theme = { ...bootstrap.theme, index };
  applyTheme();
}

async function saveTheme(): Promise<void> {
  themeSaving.value = true;
  try {
    const result = await api.settings.save({ themeIndex: themeIndex.value });
    const settings = result.settings as JsonObject | undefined;
    if (settings?.theme && typeof settings.theme === 'object') {
      bootstrap.theme = { ...bootstrap.theme, ...settings.theme as JsonObject };
    }
    applyTheme();
    toast(t('s_145fdbt'), 'success');
  } catch (reason) {
    toast(errorText(reason) || t('s_1q9u8le'), 'error');
  } finally {
    themeSaving.value = false;
  }
}

// ── 头像：选择图片 → 圆形裁剪 → media.store 落盘 ──────────────────

const sheetPanel = ref('');

const cropper = reactive({
  source: '',
  x: 0,
  y: 0,
  zoom: 1,
  base: 1,
  width: 0,
  height: 0,
  ready: false,
});
const CROP_STAGE_SIZE = 248;
const cropStage = ref<HTMLElement>();
const cropImage = ref<HTMLImageElement>();
const cropHint = ref('');
const cropHintTone = ref('');

const cropScale = computed(() => cropper.base * cropper.zoom);
const cropZoomLabel = computed(() => `${cropper.zoom.toFixed(1)}×`);

function paintCrop(): void {
  const image = cropImage.value;
  if (!image || !cropper.ready) return;
  const width = cropper.width * cropScale.value;
  const height = cropper.height * cropScale.value;
  // 图片不能露出裁剪框：平移量按图片与裁剪框的尺寸差夹紧。
  const maxX = Math.max(0, (width - CROP_STAGE_SIZE) / 2);
  const maxY = Math.max(0, (height - CROP_STAGE_SIZE) / 2);
  cropper.x = Math.min(maxX, Math.max(-maxX, cropper.x));
  cropper.y = Math.min(maxY, Math.max(-maxY, cropper.y));
  image.style.width = `${width}px`;
  image.style.height = `${height}px`;
  image.style.transform = `translate(-50%, -50%) translate3d(${cropper.x}px, ${cropper.y}px, 0)`;
}

function onCropLoad(): void {
  const image = cropImage.value;
  if (!image) return;
  cropper.width = image.naturalWidth || CROP_STAGE_SIZE;
  cropper.height = image.naturalHeight || CROP_STAGE_SIZE;
  // 基准比例让图片最短边刚好铺满裁剪框，再叠加用户缩放。
  cropper.base = Math.max(CROP_STAGE_SIZE / cropper.width, CROP_STAGE_SIZE / cropper.height);
  cropper.ready = true;
  paintCrop();
}

function onCropError(): void {
  cropHint.value = t('s_gnybt');
  cropHintTone.value = 'error';
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/** 单指拖动、双指捏合缩放；返回解绑函数，面板关闭时调用。 */
function bindCropperGestures(): () => void {
  const stage = cropStage.value;
  if (!stage) return () => undefined;

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance = 0;
  let pinchFocal = { x: 0, y: 0 };
  let pinchStartX = 0;
  let pinchStartY = 0;
  let pinchStartZoom = 1;
  let dragStartX = 0;
  let dragStartY = 0;
  let originX = 0;
  let originY = 0;

  const distance = (): number => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /** 两指在元素坐标系里的中点，用于把缩放锚在手指下方。 */
  const focal = (): { x: number; y: number } => {
    const rect = stage.getBoundingClientRect();
    const [a, b] = [...pointers.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return {
      x: ((a.x + b.x) / 2) - rect.left - (rect.width / 2),
      y: ((a.y + b.y) / 2) - rect.top - (rect.height / 2),
    };
  };

  const beginDrag = (event: PointerEvent): void => {
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    originX = cropper.x;
    originY = cropper.y;
    stage.dataset.dragging = 'true';
  };

  const onDown = (event: PointerEvent): void => {
    if (!cropper.ready) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      beginDrag(event);
      return;
    }
    if (pointers.size === 2) {
      pinchStartDistance = distance();
      pinchStartZoom = cropper.zoom;
      pinchStartX = cropper.x;
      pinchStartY = cropper.y;
      pinchFocal = focal();
      stage.dataset.pinching = 'true';
    }
  };

  const onMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      if (pinchStartDistance <= 0) {
        pinchStartDistance = distance();
        pinchStartZoom = cropper.zoom;
        pinchStartX = cropper.x;
        pinchStartY = cropper.y;
        pinchFocal = focal();
        return;
      }
      const ratio = distance() / pinchStartDistance;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * ratio));
      // 手指下的那一点保持不动：按缩放比把锚点相对平移量一起放大。
      const grow = next / pinchStartZoom;
      cropper.zoom = next;
      cropper.x = pinchFocal.x - ((pinchFocal.x - pinchStartX) * grow);
      cropper.y = pinchFocal.y - ((pinchFocal.y - pinchStartY) * grow);
      paintCrop();
      return;
    }

    cropper.x = originX + (event.clientX - dragStartX);
    cropper.y = originY + (event.clientY - dragStartY);
    paintCrop();
  };

  const onUp = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size >= 2) return;
    stage.dataset.pinching = 'false';
    pinchStartDistance = 0;
    if (pointers.size === 1) {
      // 松开一根手指后，剩下那根继续接管拖动，避免画面「粘住」。
      beginDrag(event);
      return;
    }
    stage.dataset.dragging = 'false';
  };

  // 桌面或鼠标环境没有第二根手指，用滚轮作为捏合的等价操作。
  const onWheel = (event: WheelEvent): void => {
    if (!cropper.ready) return;
    event.preventDefault();
    cropper.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cropper.zoom + (event.deltaY < 0 ? 0.12 : -0.12)));
    paintCrop();
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    stage.removeEventListener('wheel', onWheel);
  };
}

let unbindCropper: (() => void) | undefined;

watch(sheetPanel, async (panel, previous) => {
  unbindCropper?.();
  unbindCropper = undefined;
  if (previous === 'crop') {
    // 关掉面板就丢掉旧图，避免下次打开先闪一眼上一张。
    cropper.source = '';
    cropper.ready = false;
    cropHintTone.value = '';
  }
  if (panel === 'crop') {
    // 等 DOM 落位后再绑定手势，这一刻裁剪框才存在。
    await nextTick();
    unbindCropper = bindCropperGestures();
  }
});

function setCropHint(message: string): void {
  cropHint.value = message;
  cropHintTone.value = 'error';
}

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
  cropper.source = source;
  cropper.x = 0;
  cropper.y = 0;
  cropper.zoom = 1;
  cropper.ready = false;
  cropHint.value = t('s_1ty4r7s');
  cropHintTone.value = '';
  sheetPanel.value = 'crop';
}

/** 导出正方形画布：取景框是圆形，但存的是外接方图，各端展示时再裁圆。 */
function renderCrop(): string {
  const image = cropImage.value;
  const scale = cropScale.value;
  const sourceSize = CROP_STAGE_SIZE / scale;
  const left = ((CROP_STAGE_SIZE / 2) + cropper.x) - ((cropper.width * scale) / 2);
  const top = ((CROP_STAGE_SIZE / 2) + cropper.y) - ((cropper.height * scale) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('s_5iff2f'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 512, 512);
  if (image) {
    context.drawImage(image, -left / scale, -top / scale, sourceSize, sourceSize, 0, 0, 512, 512);
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function confirmCrop(): Promise<void> {
  if (!cropper.ready) {
    setCropHint(t('s_94aane'));
    return;
  }
  let dataUrl = '';
  try {
    dataUrl = renderCrop();
  } catch (reason) {
    setCropHint(errorText(reason));
    return;
  }
  sheetPanel.value = '';
  await storeAvatar(dataUrl);
}

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

// ── 退出登录 ──────────────────────────────────────────────────────

const logoutBusy = ref(false);

function logout(): void {
  confirmSheet({
    title: t('s_12hokt7'),
    message: t('s_1b7h1x'),
    confirmLabel: t('s_12hokt7'),
    tone: 'danger',
    onConfirm: async () => {
      logoutBusy.value = true;
      try {
        await api.auth.logout();
        session.clear();
        toast(t('s_pdyp8r'));
        await router.replace('/login');
      } catch (reason) {
        toast(errorText(reason), 'error');
      } finally {
        logoutBusy.value = false;
      }
    },
  });
}
</script>

<template>
  <!-- 访客：与旧页面一致，原位说明并给出登录入口，而不是让下面的开关显示默认值 -->
  <StateBlock
    v-if="!loggedIn"
    icon="user"
    :title="t('s_1h1rste')"
    :description="t('s_1b7h1x')"
    :action-label="t('s_533bde')"
    @action="router.push({ path: '/login', query: { redirect: '/profile' } })"
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
      <!-- 身份卡：头像 + 昵称/角色/邮箱 + 资料入口 -->
      <div class="card">
        <div class="row" data-gap="md">
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
          <span class="row-copy">
            <strong class="row-title">{{ user.nickname || user.username }}</strong>
            <span class="row-meta">{{ identityMeta() }}</span>
            <span class="row-meta truncate">{{ user.email || t('s_1hhb6bo') }}</span>
          </span>
          <button
            class="pill"
            type="button"
            :disabled="limited"
            :title="limited ? limitHint : undefined"
            @click="openEditor"
          >
            {{ t('s_qreyeg') }}
          </button>
        </div>
        <div class="row" data-gap="md">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited || avatarBusy"
            :title="limited ? limitHint : undefined"
            @click="pickAvatar"
          >
            {{ t('s_onix0y') }}
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

      <!-- 资料：简介 + 地区 + 社交账号 -->
      <div class="card">
        <span class="section-label">{{ t('s_ml9unw') }}</span>
        <p class="row-meta">{{ profileValue('bio', 's_17mtsm3') }}</p>
        <div class="stack" data-gap="sm">
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('s_11ftk7j') }}</span>
            <span class="strong truncate">{{ profileValue('region', 's_15h5nhd') }}</span>
          </div>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('s_1hnvqec') }}</span>
            <span class="strong truncate">{{ profileValue('socialMedia', 's_15h5nhd') }}</span>
          </div>
        </div>
      </div>

      <!-- 编辑资料：原位展开，校验失败就落在字段上（`.field[data-invalid]` + 顶部说明） -->
      <div v-if="editing" class="card form">
        <span class="section-label">{{ t('s_1sq2bvr') }}</span>
        <div class="field" :data-invalid="editInvalid.nickname ? 'true' : 'false'">
          <label for="profile-nickname">{{ t('s_1c2rfxc') }}</label>
          <input
            id="profile-nickname"
            v-model="editForm.nickname"
            class="input"
            type="text"
            :maxlength="limit('nickname', 20)"
          >
        </div>
        <div class="field" :data-invalid="editInvalid.bio ? 'true' : 'false'">
          <label for="profile-bio">{{ t('s_ml9unw') }}</label>
          <textarea id="profile-bio" v-model="editForm.bio" class="textarea" rows="3" :maxlength="limit('bio', 200)" />
        </div>
        <div class="field" :data-invalid="editInvalid.region ? 'true' : 'false'">
          <label for="profile-region">{{ t('s_11ftk7j') }}</label>
          <input
            id="profile-region"
            v-model="editForm.region"
            class="input"
            type="text"
            :maxlength="limit('region', 40)"
            :placeholder="t('s_132uhjs')"
          >
        </div>
        <div class="field" :data-invalid="editInvalid.socialMedia ? 'true' : 'false'">
          <label for="profile-social">{{ t('s_1hnvqec') }}</label>
          <input
            id="profile-social"
            v-model="editForm.socialMedia"
            class="input"
            type="text"
            :maxlength="limit('socialMedia', 40)"
          >
        </div>
        <p v-if="editError" class="field-error" role="alert">{{ editError }}</p>
      </div>

      <!-- 隐私：是否在公开页展示自己的报名记录 -->
      <div class="card">
        <span class="section-label">{{ t('s_lh9gvq') }}</span>
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_1utpn11') }}</strong>
            <span class="row-meta">{{ t('s_1wgtu4f') }}</span>
          </span>
          <label class="switch" for="privacy-registrations">
            <input
              id="privacy-registrations"
              type="checkbox"
              :checked="profile.showRegistrations === true"
              :disabled="limited || privacyBusy"
              @change="savePrivacy(($event.target as HTMLInputElement).checked)"
            >
            <span />
          </label>
        </div>
        <p class="field-hint">
          {{ limited
            ? limitHint
            : (profile.showRegistrations === true ? t('s_1kyf8ic') : t('s_413sl5')) }}
        </p>
      </div>

      <!-- 账号设置：编辑资料与修改密码。改密码不受受限影响，它走 /profile/password -->
      <div class="list" data-gap="sm">
        <button
          class="row-card"
          type="button"
          data-pressable="true"
          :disabled="limited"
          :title="limited ? limitHint : undefined"
          @click="openEditor"
        >
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1y0imfq') }}</strong>
            <span class="row-meta">{{ limited ? limitHint : t('s_16sgm5m') }}</span>
          </span>
          <span class="dim" aria-hidden="true">›</span>
        </button>
        <button class="row-card" type="button" data-pressable="true" @click="openPassword">
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1pt7oo1') }}</strong>
            <span class="row-meta">{{ t('s_1pt7oo1') }}（至少 {{ passwordMin }} 个字符）</span>
          </span>
          <span class="dim" aria-hidden="true">›</span>
        </button>
      </div>

      <!-- 修改密码：与旧页面同一张表单，只做输入格式校验 -->
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
        <span class="section-label">{{ t('s_1vmubx9') }}</span>
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

        <!-- 管理员配色：选中即预览，点「保存配色」才落库 -->
        <template v-if="isAdmin">
          <hr class="divider">
          <span class="section-label">{{ t('s_4odn3m') }}</span>
          <div class="cluster">
            <button
              v-for="(color, index) in themeColors"
              :key="`${index}-${color}`"
              class="swatch"
              type="button"
              :style="{ background: color }"
              :title="color"
              :aria-label="`配色 ${index + 1} ${color}`"
              :aria-pressed="index === themeIndex ? 'true' : 'false'"
              @click="previewTheme(index)"
            >
              {{ color.replace('#', '') }}
            </button>
          </div>
          <p class="field-hint">{{ t('s_aky3i4') }}</p>
        </template>
      </div>

      <!-- 外观：明暗模式分段控件，切换立即生效并保存到后端 -->
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

      <!-- 报名记录：旧个人页只给出入口，完整列表在「我的报名」标签页 -->
      <div class="card">
        <span class="section-label">{{ t('s_1m2dh8u') }}</span>
        <button class="row-card" type="button" data-pressable="true" @click="router.push('/my-registrations')">
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1m2dh8u') }}</strong>
          </span>
          <span class="dim" aria-hidden="true">›</span>
        </button>
      </div>

      <!-- 安全：邮箱与两步验证在安全设置页，两件事共用同一套凭据 -->
      <div class="card">
        <span class="section-label">{{ t('s_1apxo2s') }}</span>
        <button class="row-card" type="button" data-pressable="true" @click="router.push('/security')">
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1apxo2s') }}</strong>
            <span class="row-meta">{{ t('s_k6xen8') }}</span>
          </span>
          <span class="dim" aria-hidden="true">›</span>
        </button>
      </div>

      <button v-if="isAdmin" class="cta" type="button" :disabled="themeSaving" @click="saveTheme">
        {{ t('s_apw50v') }}
      </button>
      <p v-if="isAdmin" class="field-hint text-center">{{ t('s_fp6vpq') }}</p>

      <button class="cta ghost" type="button" :disabled="logoutBusy" @click="logout">
        {{ t('s_12hokt7') }}
      </button>
    </template>
  </template>

  <!-- 裁剪面板：打开时才渲染，圆形取景框由 tokens.css 的 .crop-stage 圆角给出 -->
  <div v-if="sheetPanel === 'crop'" class="stack" data-gap="sm">
    <div class="crop-wrap">
      <div ref="cropStage" class="crop-stage">
        <img
          ref="cropImage"
          class="crop-image"
          :src="cropper.source"
          alt=""
          @load="onCropLoad"
          @error="onCropError"
        >
      </div>
    </div>
    <div class="row" data-between="true">
      <span class="field-hint">{{ t('s_vk66u0') }}</span>
      <span class="crop-scale">{{ cropZoomLabel }}</span>
    </div>
    <p class="field-hint" :data-tone="cropHintTone || undefined">{{ cropHint }}</p>
    <div class="row" data-gap="sm">
      <button class="cta" type="button" @click="confirmCrop">{{ t('s_1bykzhf') }}</button>
      <button class="cta ghost" type="button" @click="sheetPanel = ''">{{ t('s_1589w37') }}</button>
    </div>
  </div>

  <!-- 固定操作区：编辑资料与修改密码的保存入口 -->
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
