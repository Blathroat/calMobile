<script setup lang="ts">
/**
 * 头像编辑块：资料编辑抽屉最上方的一块。
 *
 * 为什么立即保存：头像走 `POST /profile/avatar`、`DELETE /profile/avatar` 两个独立接口，
 * 不是抽屉底部「保存」提交的 `PUT /profile` 的一部分。选完图、裁剪完就应该落库，
 * 不必再点一次保存；成功后刷新会话并通知调用方合并资料对象。
 *
 * 裁剪复用共享组件 `AvatarCropper`（单指拖动 + 双指捏合），手势、取景与导出都在那边，
 * 这里只负责「拿到裁剪后的 dataUrl 之后的事」。导出格式跟管理设置里的头像格式走：
 * 优先 jpeg，否则 png，再否则 webp。取消选图不提示，与系统选择器一致。
 *
 * 受限账号（后端明确下发 `can.profile === false`）禁用动作并原位说明原因；后端也会拒绝。
 * 管理员代改别人资料时整个块不渲染（头像接口只作用于当前登录账号），由调用方控制。
 * 浏览器（没有原生桥）下同样可用：`device.pickImage` 在浏览器里退化成文件选择器。
 */
import { computed, ref } from 'vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { device } from '@/services/device-services';
import { toast } from '@/services/toast';
import { avatarExportMime } from '@/services/validate';
import AvatarBox from '@/components/AvatarBox.vue';
import AvatarCropper from '@/components/AvatarCropper.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const emit = defineEmits<{
  /** 头像写入成功后的最新用户字段；调用方据此合并自己持有的资料对象。 */
  updated: [fresh: JsonObject];
}>();

const session = useSessionStore();
const user = computed(() => session.user);
/** 受限账号：只有后端明确下发 `false` 才算，老后端不下发时行为不变。 */
const limited = computed(() => user.value.can?.profile === false);
const avatarMime = computed(() => avatarExportMime());
const avatarBusy = ref(false);
const avatarError = ref('');
/** 非空时渲染裁剪面板；组件关闭后由 `@close` 清空，避免下次打开先闪一眼上一张。 */
const cropSource = ref('');

/** 取数失败优先用后端/传输层自带的原因，没有就回落到通用文案。 */
function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('exhibition.form.saveFailed');
}

/** 资料写入前的兜底：受限账号不能改头像，原位提示已经写明原因，这里再挡一层。 */
function guardWrite(): boolean {
  if (!limited.value) return false;
  toast(t('profile.restricted'), 'error');
  return true;
}

/** 选图只负责拿到 dataUrl；裁剪交给 AvatarCropper，取消选图不做提示。 */
async function pickAvatar(): Promise<void> {
  if (guardWrite()) return;
  avatarError.value = '';
  let picked;
  try {
    picked = await device.pickImage();
  } catch (reason) {
    // 用户在系统相册 / 选择器点了取消：按稳定错误码判断，不匹配文案。
    if ((reason as { code?: string } | null)?.code === 'cancelled') return;
    avatarError.value = errorText(reason);
    toast(avatarError.value, 'error');
    return;
  }
  const source = String(picked?.dataUrl || '');
  if (!source) {
    avatarError.value = t('admin.media.unreadableImage');
    toast(avatarError.value, 'error');
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

/** 写回会话：资料写入的代数要加一，尚未回来的旧资料响应不能再盖掉新头像。 */
function applyFresh(fresh: JsonObject): void {
  session.bumpProfile();
  session.applyUser({ ...user.value, ...fresh });
  emit('updated', fresh);
}

/** `@done` 拿到的就是裁剪后的方图 dataUrl；这里上传到服务器并写进会话。 */
async function storeAvatar(dataUrl: string): Promise<void> {
  if (guardWrite()) return;
  const image = avatarBytes(dataUrl);
  if (!image) {
    avatarError.value = t('admin.media.unreadableImage');
    toast(avatarError.value, 'error');
    return;
  }
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const saved = await api.profile.uploadAvatar(image.bytes, image.contentType);
    applyFresh((saved.user as JsonObject | undefined) ?? {});
    toast(t('settings.avatarUpdated'), 'success');
  } catch (reason) {
    avatarError.value = errorText(reason);
    toast(avatarError.value, 'error');
  } finally {
    avatarBusy.value = false;
  }
}

/** 移除头像：服务端清掉资料里的地址，并删除自己保存的文件。 */
async function removeAvatar(): Promise<void> {
  if (guardWrite()) return;
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const saved = await api.profile.removeAvatar();
    applyFresh((saved.user as JsonObject | undefined) ?? {});
    toast(t('settings.avatarRemoved'), 'success');
  } catch (reason) {
    avatarError.value = errorText(reason);
    toast(avatarError.value, 'error');
  } finally {
    avatarBusy.value = false;
  }
}
</script>

<template>
  <div class="field avatar-field" data-avatar-field="true">
    <span class="field-label">{{ t('settings.avatar') }}</span>
    <div class="row" data-gap="md">
      <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
      <div class="avatar-field-copy">
        <div class="action-row">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited || avatarBusy"
            :title="limited ? t('profile.restricted') : undefined"
            @click="pickAvatar"
          >
            {{ user.avatar ? t('settings.changeAvatar') : t('settings.uploadAvatar') }}
          </button>
          <button
            v-if="user.avatar"
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited || avatarBusy"
            :title="limited ? t('profile.restricted') : undefined"
            @click="removeAvatar"
          >
            {{ t('settings.removeAvatar') }}
          </button>
        </div>
        <p class="field-hint">{{ t('settings.profile.avatarHint') }}</p>
      </div>
    </div>
    <p v-if="limited" class="field-hint">{{ t('profile.restricted') }}</p>
    <p v-if="avatarError" class="field-error" role="alert">{{ avatarError }}</p>
  </div>

  <!-- 裁剪面板叠在资料抽屉上：Escape 由组件自己在捕获阶段拦住，只关面板不关抽屉 -->
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
/* 头像块：左预览右动作，说明与错误各占一行。 */
.avatar-field-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: var(--s1);
}
</style>
