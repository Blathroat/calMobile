/**
 * 头像裁剪抽屉的全局状态。
 *
 * 资料抽屉里点铅笔后：**先**保存资料并关掉资料抽屉（见 `services/profile-editor.ts`），
 * **然后**直接拉起系统选图；选到图再设置这里的 `source`，由个人页 / 用户设置页常驻的
 * `components/ProfileAvatarCropper.vue` 弹出裁剪抽屉。状态放服务层，页面与抽屉都不用
 * 自己拼选择器，服务层也不需要碰组件树。
 */
import { reactive } from 'vue';
import type { JsonObject } from '@/api/types';

export const avatarCropper = reactive({
  /** 待裁剪的图片 data URL；非空时渲染裁剪抽屉。 */
  source: '',
  /** 头像写入成功后的回调：调用方持有的资料对象跟着更新。 */
  onUpdated: null as ((fresh: JsonObject) => void) | null,
});

/** 系统选到图之后打开裁剪抽屉。 */
export function openAvatarCropper(source: string, onUpdated?: (fresh: JsonObject) => void): void {
  avatarCropper.source = source;
  avatarCropper.onUpdated = onUpdated ?? null;
}

/** 裁剪抽屉关闭（完成、取消或失败）后清掉临时状态。 */
export function closeAvatarCropper(): void {
  avatarCropper.source = '';
  avatarCropper.onUpdated = null;
}
