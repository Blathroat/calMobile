import { computed, ref } from 'vue';
import { api } from '@/app/runtime';
import { confirmSheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { PATTERNS, check } from '@/services/validate';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

/** 管理员转移展会归属的输入、确认、请求与结果状态。 */
export function useExhibitionOwnerTransfer(getExhibitionId: () => string) {
  const ownerName = ref('');
  const ownerEmail = ref('');
  const ownerError = ref('');
  const ownerBusy = ref(false);
  const ownerLabel = computed(() => ownerName.value || t('exhibition.form.ownerNone'));

  function ownerEmailError(): string {
    return check(ownerEmail.value, {
      label: t('exhibition.form.ownerEmailLabel'),
      required: true,
      max: 120,
      pattern: PATTERNS.email,
      patternMessage: t('exhibition.form.ownerEmailInvalid'),
    });
  }

  function askTransferOwner(): void {
    if (ownerBusy.value) return;
    const message = ownerEmailError();
    if (message) {
      ownerError.value = message;
      toast(message, 'error');
      return;
    }
    ownerError.value = '';
    const email = ownerEmail.value.trim();
    confirmSheet({
      title: t('exhibition.form.ownerConfirmTitle'),
      message: t('exhibition.form.ownerConfirmMessage', { email }),
      confirmLabel: t('exhibition.form.ownerSubmit'),
      onConfirm: async () => {
        ownerBusy.value = true;
        try {
          const result = await api.exhibitions.setOwner(getExhibitionId(), email);
          const exhibition = (result?.exhibition ?? {}) as JsonObject;
          ownerName.value = String(exhibition.exhibitor ?? '');
          ownerEmail.value = '';
          toast(t('exhibition.form.ownerUpdated'), 'success');
        } catch (reason) {
          ownerError.value = reason instanceof Error ? reason.message : String(reason);
          toast(ownerError.value, 'error');
        } finally {
          ownerBusy.value = false;
        }
      },
    });
  }

  return { ownerName, ownerEmail, ownerError, ownerBusy, ownerLabel, askTransferOwner };
}
