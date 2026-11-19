/**
 * 个人页与用户设置共用的「编辑资料」抽屉。
 *
 * 两边打开的是同一块面板（`UserSettingsFormSheet` 的 profile 模式）：
 * 最上方是头像块（只留一颗铅笔入口），下面才是昵称、简介、地区、社交账号（保存走 `PUT /profile`）。
 *
 * 头像不在这一层改：点铅笔时先把当前资料保存下来并退出资料抽屉，退场动画结束后**直接拉起
 * 系统选图**，选定图片再弹出裁剪抽屉（`components/ProfileAvatarCropper.vue`，状态在
 * `services/profile-avatar.ts`），裁剪完立即上传。
 * 校验或保存失败就留在资料抽屉里显示错误，不会带着还没保存的改动跳走。
 *
 * 管理员从公开页代改别人资料时传 `targetUserId`：走管理员接口、不改当前会话，
 * 也不渲染头像块——头像接口只作用于当前登录账号。
 */
import { reactive, ref } from 'vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { device } from '@/services/device-services';
import { openAvatarCropper } from '@/services/profile-avatar';
import UserSettingsFormSheet from '@/components/UserSettingsFormSheet.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';
import { closeSheet, openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { check, limit, validateAll } from '@/services/validate';

/** 资料抽屉退场动画（`services/sheet.ts` 里 220ms）之后的余量：旧抽屉先落下去，再开新的。 */
const AVATAR_SHEET_DELAY_MS = 260;

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('exhibition.form.saveFailed');
}

/**
 * 打开编辑资料抽屉。
 * @param profile 当前资料。保存成功后就地合并服务端返回的用户。
 * @param options.blocked 返回 true 时不打开、也不保存；提示由调用方负责。
 * @param options.targetUserId 管理员代改别人资料时传目标用户 id：走管理员接口，不改当前会话。
 * @param options.onSaved 保存成功后的回调（管理员视图用它刷新公开页）。
 */
export function openProfileEditor(
  profile: JsonObject,
  options?: { blocked?: () => boolean; targetUserId?: string; onSaved?: (fresh: JsonObject) => void },
): void {
  if (options?.blocked?.()) return;
  const session = useSessionStore();
  const editBusy = ref(false);
  const editError = ref('');
  /** 正在保存资料并切到头像抽屉：连点铅笔不再叠加保存与定时器。 */
  let switchingToAvatar = false;
  const targetUserId = String(options?.targetUserId ?? '');
  const editForm = reactive({
    // 管理员代改时以目标用户的资料为准，不能拿当前管理员的昵称预填。
    nickname: String(profile.nickname || session.user.nickname || session.user.username || ''),
    bio: String(profile.bio || ''),
    region: String(profile.region || ''),
    socialMedia: String(profile.socialMedia || ''),
  });
  const editInvalid = reactive({ nickname: false, bio: false, region: false, socialMedia: false });

  function updateField(field: string, value: string): void {
    if (field in editForm) editForm[field as keyof typeof editForm] = value;
  }

  /** 校验一次并把错误落到对应字段上，返回是否通过。 */
  function validateEditor(): boolean {
    const nicknameError = check(editForm.nickname, {
      label: t('settings.profile.nickname'),
      required: true,
      max: limit('nickname', 20),
    });
    const bioError = check(editForm.bio, { label: t('profile.bio'), max: limit('bio', 200) });
    const regionError = check(editForm.region, { label: t('settings.profile.region'), max: limit('region', 40) });
    const socialError = check(editForm.socialMedia, {
      label: t('settings.profile.social'),
      max: limit('socialMedia', 40),
    });

    editInvalid.nickname = nicknameError !== '';
    editInvalid.bio = bioError !== '';
    editInvalid.region = regionError !== '';
    editInvalid.socialMedia = socialError !== '';

    const result = validateAll([() => nicknameError, () => bioError, () => regionError, () => socialError]);
    editError.value = result.message;
    return result.ok;
  }

  /**
   * 保存资料。
   * @param saveOptions.close 保存成功后是否关闭资料抽屉；默认关闭。点头像时要先保存再换成
   *   头像抽屉，由调用方在保存成功后自己决定何时关。
   * @returns 是否写入成功；校验不通过与保存失败都返回 false，错误已落在字段或 editError 上。
   */
  async function saveEditor(saveOptions?: { close?: boolean }): Promise<boolean> {
    if (editBusy.value) return false;
    if (options?.blocked?.()) return false;
    if (!validateEditor()) return false;
    editBusy.value = true;
    try {
      const payload = {
        nickname: editForm.nickname.trim(),
        bio: editForm.bio.trim(),
        region: editForm.region.trim(),
        socialMedia: editForm.socialMedia.trim(),
        // 头像在头像抽屉里单独保存，这里仍要原样回传：PUT /profile 是整份覆盖，少传字段会被当成清空。
        // 本人编辑取会话里的最新头像（头像抽屉里刚换过也已写回 session.user）；代改别人资料时取目标用户的。
        avatar: String(targetUserId ? profile.avatar || '' : session.user.avatar || ''),
        showRegistrations: profile.showRegistrations === true,
      };
      const saved = targetUserId
        ? await api.users.updateProfile(targetUserId, payload)
        : await api.profile.save(payload);
      const fresh = ((saved.user ?? saved.profile) as JsonObject | undefined) ?? {};
      // 代改别人资料不能污染当前管理员的会话。
      if (!targetUserId) {
        session.bumpProfile();
        session.applyUser({ ...session.user, ...fresh });
      }
      Object.assign(profile, fresh);
      options?.onSaved?.(fresh);
      if (saveOptions?.close !== false) closeSheet();
      editError.value = '';
      toast(t('settings.profile.saved'), 'success');
      return true;
    } catch (reason) {
      editError.value = errorText(reason);
      return false;
    } finally {
      editBusy.value = false;
    }
  }

  /**
   * 选头像：系统相册 / 文件选择里拿到图片后直接弹裁剪抽屉，不再先开一页让用户再点一次。
   * 用户取消不提示；图片读不出来或选图失败才 toast。没有图时什么都不弹。
   */
  async function pickAvatar(): Promise<void> {
    try {
      const picked = await device.pickImage();
      const source = String(picked?.dataUrl || '');
      if (!source) {
        toast(t('admin.media.unreadableImage'), 'error');
        return;
      }
      // 上传成功后把最新资料并回调用方；会话由裁剪抽屉自己刷新。
      openAvatarCropper(source, (fresh) => Object.assign(profile, fresh));
    } catch (reason) {
      // 用户在系统选图里取消：按稳定错误码判断，不提示。
      if ((reason as { code?: string } | null)?.code === 'cancelled') return;
      toast(errorText(reason), 'error');
    } finally {
      switchingToAvatar = false;
    }
  }

  /**
   * 点头像铅笔：先保存当前资料并退出资料抽屉，再直接拉起系统选图，选定后弹裁剪抽屉。
   *
   * 没保存的文字改动不能跟着丢，所以先走一遍校验与 `PUT /profile`；校验或保存失败时留在
   * 资料抽屉里显示错误。抽屉退场要 220ms，等它落下去再拉起系统界面，避免面板还开着就跳走。
   */
  async function openAvatarEditor(): Promise<void> {
    if (switchingToAvatar) return;
    switchingToAvatar = true;
    if (!(await saveEditor({ close: false }))) {
      switchingToAvatar = false;
      return;
    }
    closeSheet();
    window.setTimeout(() => void pickAvatar(), AVATAR_SHEET_DELAY_MS);
  }

  openSheet({
    title: t('settings.profile.editProfile'),
    component: UserSettingsFormSheet,
    props: {
      mode: 'profile',
      form: editForm,
      invalid: editInvalid,
      error: () => editError.value,
      limits: {
        nickname: limit('nickname', 20),
        bio: limit('bio', 200),
        region: limit('region', 40),
        socialMedia: limit('socialMedia', 40),
      },
      // 头像块只给本人：代改别人资料时头像接口仍然只会改当前登录账号。
      showAvatar: !targetUserId,
      // 点铅笔：先保存资料并关掉这一层，再打头像编辑抽屉。
      onEditAvatar: () => void openAvatarEditor(),
      onUpdate: updateField,
      onSubmit: saveEditor,
    },
    size: 'full',
    actions: [
      {
        label: t('common.save'),
        variant: 'primary',
        disabled: () => editBusy.value,
        onClick: () => void saveEditor(),
      },
      { label: t('common.cancel'), disabled: () => editBusy.value, onClick: (close) => close() },
    ],
  });
}
