<script setup lang="ts">
/**
 * 头像裁剪抽屉：系统选图之后弹出来，裁剪完直接上传，不再有「中转页」。
 *
 * 打开流程由 `services/profile-editor.ts` 负责：点铅笔先保存资料、关闭资料抽屉，再直接
 * 拉起系统选图，选到图后写 `services/profile-avatar.ts` 的 `source`，本组件据此渲染
 * `AvatarCropper`（手势、取景与导出都在那边）。个人页、用户设置页与用户公开页各常驻一份。
 *
 * 上传接口按全局状态里的 `targetUserId` 选择：空串走 `POST /profile/avatar` 并刷新当前会话；
 * 非空表示管理员代改目标账号，走 `POST /users/:id/avatar`，只把新头像交给调用方，
 * 当前管理员的会话完全不动。
 *
 * 上传进度：裁剪面板确认后会按自身退场动画收起，进度遮罩改为挂到 body 上继续显示百分比；
 * 落库成功后补到 100%，由遮罩停留约 150ms（settled）后再卸载，上传很快时也看得见。
 */
import { computed, ref } from 'vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { avatarExportMime } from '@/services/validate';
import { avatarCropper, closeAvatarCropper } from '@/services/profile-avatar';
import AvatarCropper from '@/components/AvatarCropper.vue';
import UploadProgressMask from '@/components/upload-progress-mask.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const session = useSessionStore();
const visible = computed(() => avatarCropper.source !== '');
const mime = computed(() => avatarExportMime());
/** 上传进行中（裁剪面板可能已经退场）：进度遮罩独立挂在 body 上。 */
const uploading = ref(false);
/** 上传百分比；null 表示刚起步、还没收到进度。 */
const progress = ref<number | null>(null);

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

/** 上传收尾：卸掉进度遮罩并清空全局裁剪状态。 */
function finishUpload(): void {
  uploading.value = false;
  progress.value = null;
  closeAvatarCropper();
}

/** 裁剪面板自己收起（取消，或确认后的退场）：上传还没结束就先留着遮罩。 */
function onCropperClose(): void {
  if (uploading.value) return;
  closeAvatarCropper();
}

/**
 * `@done` 拿到的就是裁剪后的方图 dataUrl：上传后写回会话（本人）或只交给调用方（管理员代改）。
 *
 * 裁剪面板在确认后会立刻开始退场并可能先清空全局状态，所以目标账号与回调要在上传前捕获。
 */
async function storeAvatar(dataUrl: string): Promise<void> {
  const image = avatarBytes(dataUrl);
  if (!image) {
    toast(t('admin.media.unreadableImage'), 'error');
    closeAvatarCropper();
    return;
  }
  const targetUserId = avatarCropper.targetUserId;
  const onUpdated = avatarCropper.onUpdated;
  const adminTarget = targetUserId !== '';
  let uploaded = false;
  uploading.value = true;
  progress.value = 0;
  try {
    const onProgress = (percent: number): void => {
      // 字节发完只到 99%，服务端确认写库后才补到 100。
      progress.value = Math.min(99, Math.max(0, percent));
    };
    const saved = adminTarget
      ? await api.users.uploadAvatar(targetUserId, image.bytes, image.contentType, onProgress)
      : await api.profile.uploadAvatar(image.bytes, image.contentType, onProgress);
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    if (!adminTarget) {
      // 本人：刷新会话，个人页与设置页马上换图。
      session.bumpProfile();
      session.applyUser({ ...session.user, ...fresh });
    }
    // 管理员代改：只把目标账号的新头像交给调用方合并，绝不能写进当前管理员会话。
    onUpdated?.(fresh);
    toast(t('settings.avatarUpdated'), 'success');
    progress.value = 100;
    uploaded = true;
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : t('exhibition.form.saveFailed'), 'error');
  } finally {
    // 失败 / 取消立刻收起；成功等遮罩把 100% 停留完（@settled）再收。
    if (!uploaded) finishUpload();
  }
}

/** 裁剪面板报错（图还没加载完、导出失败等）：留在面板里让用户重试，只做轻提示。 */
function onCropError(message: string): void {
  toast(message, 'error');
}
</script>

<template>
  <AvatarCropper
    v-if="visible"
    :source="avatarCropper.source"
    :mime="mime"
    @done="storeAvatar"
    @close="onCropperClose"
    @error="onCropError"
  />
  <!-- 上传进度：裁剪面板确认后会自行退场，遮罩挂到 body 上在头像位置继续显示百分比。 -->
  <Teleport to="body">
    <div v-if="uploading" class="avatar-upload-overlay" data-avatar-uploading="true">
      <div class="avatar-upload-stage">
        <UploadProgressMask :progress="progress" @settled="finishUpload" />
      </div>
    </div>
  </Teleport>
</template>

<style>
/* 头像上传进度：盖住整页并居中画一个头像大小的槽位，裁剪面板退场后仍能看到百分比。 */
.avatar-upload-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: var(--s4);
  background: var(--scrim);
}

.avatar-upload-stage {
  position: relative;
  width: min(248px, 68vw);
  aspect-ratio: 1;
  border-radius: var(--r-pill);
  background: var(--f3);
  box-shadow:
    0 0 0 2px var(--accent-edge),
    var(--shadow-float);
  overflow: hidden;
}
</style>
