/**
 * 个人页与用户设置共用的「编辑资料」抽屉。
 *
 * 两边打开的是同一块面板（`UserSettingsFormSheet` 的 profile 模式）：
 * 昵称、简介、地区、社交账号。保存走 `PUT /profile`，成功后写回会话，并合并进调用方持有的资料对象。
 */
import { reactive, ref } from 'vue';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import UserSettingsFormSheet from '@/components/UserSettingsFormSheet.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';
import { closeSheet, openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { check, limit, validateAll } from '@/services/validate';

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

  async function saveEditor(): Promise<void> {
    if (editBusy.value) return;
    if (options?.blocked?.()) return;
    if (!validateEditor()) return;
    editBusy.value = true;
    try {
      const payload = {
        nickname: editForm.nickname.trim(),
        bio: editForm.bio.trim(),
        region: editForm.region.trim(),
        socialMedia: editForm.socialMedia.trim(),
        // 头像与公开开关不在这个表单里改，但仍要原样回传，避免后端把未提及的字段当成清空。
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
      closeSheet();
      editError.value = '';
      toast(t('settings.profile.saved'), 'success');
    } catch (reason) {
      editError.value = errorText(reason);
    } finally {
      editBusy.value = false;
    }
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
      onUpdate: updateField,
      onSubmit: saveEditor,
    },
    size: 'full',
    actions: [
      { label: t('common.save'), variant: 'primary', disabled: () => editBusy.value, onClick: () => saveEditor() },
      { label: t('common.cancel'), disabled: () => editBusy.value, onClick: (close) => close() },
    ],
  });
}
