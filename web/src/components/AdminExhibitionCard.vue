<script setup lang="ts">
/**
 * 管理视角的展会卡片。
 *
 * 按钮与管理后台「展会」分区一致：查看报名、编辑展会、暂停或恢复报名。
 */
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { EXHIBITION_STATUS, modeLabel, statusTone } from '@/services/status';
import { coverOf } from '@/services/cover';
import { formatDateWithWeekday } from '@/services/format';
import MediaBox from '@/components/MediaBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

const props = defineProps<{ item: Exhibition }>();
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();

/** 暂停 / 恢复报名：管理员暂停后普通用户不能报名，展商不能自行恢复。 */
function toggleLock(): void {
  const item = props.item;
  const closing = item.openForRegistration === true;
  const title = closing ? t('admin.exhibitions.pauseRegistration') : t('admin.exhibitions.resumeRegistration');
  const nextStatus = closing ? EXHIBITION_STATUS.CLOSED : EXHIBITION_STATUS.REVIEW_REQUIRED;
  const message = closing
    ? t('exhibition.card.pauseMessage', { title: item.title })
    : t('exhibition.card.resumeMessage', { title: item.title });
  const doneText = closing ? t('exhibition.card.pauseDone') : t('exhibition.card.resumeDone');
  confirmSheet({
    title,
    message,
    confirmLabel: title,
    onConfirm: async () => {
      try {
        const result = await api.exhibitions.setStatus(String(item.id), nextStatus);
        const ok = result?.ok === true;
        toast(String(ok ? doneText : result?.error || t('common.failed')), ok ? 'success' : 'error');
        if (ok) emit('changed');
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}
</script>

<template>
  <div class="card">
    <button
      class="row-card"
      type="button"
      data-pressable="true"
      style="border: 0; padding: 0; background: transparent"
      :aria-label="t('exhibition.list.viewAria', { title: item.title })"
      @click="router.push(`/detail/${item.id}`)"
    >
      <MediaBox :src="coverOf(item.imageUri)" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
      <span class="row-copy">
        <strong class="row-title truncate">{{ item.title }}</strong>
        <span class="row-meta">{{ `${formatDateWithWeekday(item.date)} ${String(item.time ?? '')}`.trim() }}</span>
        <span class="row-meta truncate">{{ item.venue }}</span>
        <span class="row-meta">{{
          t('exhibition.list.statusWithRegistrations', {
            status: modeLabel(String(item.statusCode ?? '')),
            count: String(item.registrationCount ?? 0),
          })
        }}</span>
      </span>
      <StatusTag :text="modeLabel(String(item.statusCode || ''))" :tone="statusTone(String(item.statusCode || ''))" />
    </button>
    <div class="grid-cols-2">
      <button
        class="cta ghost"
        data-size="small"
        type="button"
        @click="router.push(`/review?exhibitionId=${encodeURIComponent(String(item.id))}`)"
      >
        {{ t('admin.exhibitions.viewRegistrations') }}
      </button>
      <button
        class="cta ghost"
        data-size="small"
        type="button"
        @click="router.push(`/exhibition-form/${String(item.id)}`)"
      >
        {{ t('admin.exhibitions.edit') }}
      </button>
      <button class="cta ghost" data-size="small" type="button" @click="toggleLock">
        {{
          item.openForRegistration === true
            ? t('admin.exhibitions.pauseRegistration')
            : t('admin.exhibitions.resumeRegistration')
        }}
      </button>
    </div>
  </div>
</template>
