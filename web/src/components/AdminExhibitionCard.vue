<script setup lang="ts">
/**
 * 管理视角的展会卡片。
 *
 * 按钮与管理后台「展会」分区一致：查看报名、编辑展会、暂停或恢复报名。
 * 卡片右侧在状态灯下面还有一枚二维码分享按钮，与展商后台是同一个分享抽屉。
 */
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import { registrationLink } from '@/services/registration-link';
import { EXHIBITION_STATUS, acceptsRegistration, exhibitionModeCode, modeLabel, statusTone } from '@/services/status';
import { coverOf } from '@/services/cover';
import { formatDateWithWeekday, joinText } from '@/services/format';
import { useBootstrapStore } from '@/stores/bootstrap';
import MediaBox from '@/components/MediaBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import ShareQrSheet from '@/components/ShareQrSheet.vue';
import AppIcon from '@/components/AppIcon.vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

const props = defineProps<{ item: Exhibition }>();
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();
const bootstrap = useBootstrapStore();

/**
 * 分享展会：与展商后台共用 `ShareQrSheet`，二维码内容就是报名站链接。
 * 没配报名站地址时不打开空二维码，只提示原因。
 */
function openShareQr(): void {
  const item = props.item;
  const link = registrationLink(bootstrap.publicBaseUrl, item.id);
  if (!link) {
    toast(t('exhibition.detail.registrationSiteMissing'), 'error');
    return;
  }
  openSheet({
    title: t('share.qrTitle'),
    component: ShareQrSheet,
    // 面板状态是全局响应式的：只传字符串快照，避免把会变的共享对象包成代理。
    props: {
      text: link,
      title: String(item.title ?? ''),
      fileName: `exhibition-qr-${String(item.id)}.png`,
    },
  });
}

/** 暂停 / 恢复报名：管理员暂停后普通用户不能报名，展商不能自行恢复。 */
function toggleLock(): void {
  const item = props.item;
  // 暂停 / 恢复只按报名方式判断：报名截止日已过的展会 openForRegistration 也是 false，
  // 但状态仍是「报名中」，不能因此把按钮换成「恢复报名」。
  const closing = acceptsRegistration(item.statusCode);
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
    <div class="admin-exh-head">
      <!-- 主体整块可点进详情；右侧的状态灯与二维码按钮留在外面（按钮不能嵌套）。 -->
      <button
        class="admin-exh-main"
        type="button"
        :aria-label="t('exhibition.list.viewAria', { title: item.title })"
        @click="router.push(`/detail/${item.id}`)"
      >
        <MediaBox :src="coverOf(item.imageUri)" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
        <span class="row-copy">
          <strong class="row-title truncate">{{ item.title }}</strong>
          <span class="row-meta">{{ joinText([formatDateWithWeekday(item.date), item.time], ' ') }}</span>
          <span class="row-meta truncate">{{ item.venue }}</span>
          <span class="row-meta">{{
            t('exhibition.list.statusWithRegistrations', {
              status: modeLabel(exhibitionModeCode(item)),
              count: String(item.registrationCount ?? 0),
            })
          }}</span>
        </span>
      </button>
      <!-- 右侧竖排：信号灯在上，二维码分享按钮在下（与展商后台同一个抽屉）。 -->
      <div class="admin-exh-side">
        <StatusTag :text="modeLabel(exhibitionModeCode(item))" :tone="statusTone(exhibitionModeCode(item))" />
        <button
          class="icon-hit admin-exh-qr"
          type="button"
          :aria-label="t('admin.exhibitions.shareQr')"
          :title="t('admin.exhibitions.shareQr')"
          @click="openShareQr"
        >
          <AppIcon name="qr" />
        </button>
      </div>
    </div>
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
          acceptsRegistration(item.statusCode)
            ? t('admin.exhibitions.pauseRegistration')
            : t('admin.exhibitions.resumeRegistration')
        }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 卡片上半：左侧整块可点的主体 + 右侧竖排的状态灯与二维码按钮。
   主体原本借用 .row-card 的排布，这里只保留它实际用到的那几条（纸面由外层 .card 给）。 */
.admin-exh-head {
  display: flex;
  align-items: center;
  gap: var(--s3);
  min-width: 0;
}

.admin-exh-main {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--s3);
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: start;
}

/* 状态灯与二维码按钮同一列：灯在上、按钮在下，按钮的 44px 命中区不挤压标题。 */
.admin-exh-side {
  flex: none;
  display: grid;
  justify-items: center;
  gap: var(--s1);
}
</style>
