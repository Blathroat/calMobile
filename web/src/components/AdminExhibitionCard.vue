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
import { EXHIBITION_STATUS, statusTone } from '@/services/status';
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
    ? `暂停后「${item.title}」不可报名，展商不能自行恢复。`
    : `恢复后「${item.title}」将重新按需审核的方式收集报名。`;
  confirmSheet({
    title,
    message,
    confirmLabel: title,
    onConfirm: async () => {
      try {
        const result = await api.exhibitions.setStatus(String(item.id), nextStatus);
        const ok = result?.ok === true;
        toast(String(ok ? `已${title}` : result?.error || t('common.failed')), ok ? 'success' : 'error');
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
      :aria-label="`查看 ${item.title} 详情`"
      @click="router.push(`/detail/${item.id}`)"
    >
      <MediaBox :src="coverOf(item.imageUri)" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
      <span class="row-copy">
        <strong class="row-title truncate">{{ item.title }}</strong>
        <span class="row-meta">{{ `${formatDateWithWeekday(item.date)} ${item.time}` }}</span>
        <span class="row-meta truncate">{{ item.venue }}</span>
        <span class="row-meta">{{ `${item.status} · ${item.registrationCount ?? 0} 条报名` }}</span>
      </span>
      <StatusTag :text="String(item.modeLabel || item.status || '')" :tone="statusTone(String(item.status || ''))" />
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
