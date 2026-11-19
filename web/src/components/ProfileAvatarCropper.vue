<script setup lang="ts">
/**
 * 头像裁剪抽屉：系统选图之后弹出来，裁剪完直接上传，不再有「中转页」。
 *
 * 打开流程由 `services/profile-editor.ts` 负责：点铅笔先保存资料、关闭资料抽屉，再直接
 * 拉起系统选图，选到图后写 `services/profile-avatar.ts` 的 `source`，本组件据此渲染
 * `AvatarCropper`（手势、取景与导出都在那边）。个人页与用户设置页各常驻一份。
 *
 * 上传走 `POST /profile/avatar`，成功后刷新会话并通知调用方合并资料；取消或失败时关掉
 * 裁剪抽屉、不留下半截状态。浏览器（没有原生桥）里选图退化成文件选择，其它流程一致。
 */
import { computed } from 'vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { avatarExportMime } from '@/services/validate';
import { avatarCropper, closeAvatarCropper } from '@/services/profile-avatar';
import AvatarCropper from '@/components/AvatarCropper.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const session = useSessionStore();
const visible = computed(() => avatarCropper.source !== '');
const mime = computed(() => avatarExportMime());

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

/** `@done` 拿到的就是裁剪后的方图 dataUrl：上传后写回会话，再通知调用方。 */
async function storeAvatar(dataUrl: string): Promise<void> {
  const image = avatarBytes(dataUrl);
  if (!image) {
    toast(t('admin.media.unreadableImage'), 'error');
    closeAvatarCropper();
    return;
  }
  try {
    const saved = await api.profile.uploadAvatar(image.bytes, image.contentType);
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.bumpProfile();
    session.applyUser({ ...session.user, ...fresh });
    avatarCropper.onUpdated?.(fresh);
    toast(t('settings.avatarUpdated'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : t('exhibition.form.saveFailed'), 'error');
  } finally {
    closeAvatarCropper();
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
    @close="closeAvatarCropper"
    @error="onCropError"
  />
</template>
