<script setup lang="ts">
/**
 * 管理视角的展会卡片：版式与「展商后台」的展会卡一致。
 *
 * 上半是整块可点进详情的主体（缩略图 + 标题 / 时间 / 地点 / 状态信号灯），
 * 右侧垂直居中一枚二维码分享按钮；下半是同一套 ghost 小按钮的操作行。
 * 与展商卡唯一的差别是多了「暂停 / 恢复报名」：只有对这场展会**有管理权限**的账号
 * （管理员，或它自己的主办人）才显示，别让只读视角看到点不动的按钮。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import { registrationLink } from '@/services/registration-link';
import { canManageExhibition } from '@/services/exhibition-scope';
import { EXHIBITION_STATUS, acceptsRegistration, exhibitionModeCode, modeLabel, statusTone } from '@/services/status';
import { coverOf } from '@/services/cover';
import { formatDateWithWeekday, joinText } from '@/services/format';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
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
const session = useSessionStore();

/** 有管理权限才给「暂停 / 恢复报名」：管理员不限，主办人只能管自己的展会。 */
const canManage = computed(() => canManageExhibition(session.user, props.item));

/** 卡片上的状态信号灯：状态与报名数合成一条，和展商卡同一套文案。 */
const modeCode = computed(() => exhibitionModeCode(props.item));

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
    <!-- 上半：主体与二维码按钮叠在同一块可点区域上。按钮绝对定位在右侧垂直居中，
         主体的右内距给它让出 44px 触控位，标题与状态不会被压住；按钮不能放进主体
         那个 <button> 里（按钮不能嵌套）。 -->
    <div class="admin-exh-head">
      <button
        class="admin-exh-main"
        type="button"
        :aria-label="t('exhibition.list.viewAria', { title: item.title })"
        @click="router.push(`/detail/${item.id}`)"
      >
        <MediaBox
          :src="coverOf(item.imageUri)"
          class-name="thumb thumb-cover admin-exh-thumb"
          :alt="String(item.title || '')"
        />
        <span class="row-copy">
          <strong class="row-title admin-exh-title">{{ item.title }}</strong>
          <span class="row-meta">{{ joinText([formatDateWithWeekday(item.date), item.time], ' ') }}</span>
          <span class="row-meta truncate">{{ item.venue }}</span>
          <!-- 状态与报名数合成一条信号灯：既没有「左边空着」的单独一行，
               也不会和标题抢宽度。 -->
          <StatusTag
            :text="
              t('exhibition.list.statusWithRegistrations', {
                status: modeLabel(modeCode),
                count: String(item.registrationCount ?? 0),
              })
            "
            :tone="statusTone(modeCode)"
          />
          <span v-if="item.qrEnabled === true" class="row-meta">{{ t('exhibitor.qrEnabled') }}</span>
        </span>
      </button>

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

    <div class="action-row">
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
      <button v-if="canManage" class="cta ghost" data-size="small" type="button" @click="toggleLock">
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
/* 以下版式与展商后台的展会卡（`ExhibitorPage.vue` 的 .exh-* 那一组）一一对应，
   差别只在类名前缀：这里是组件，scoped 样式不能和页面共用选择器。 */

/* 缩略图按设计稿的 44×78 竖版；全局 .thumb 是 36×64，这里放大一档。 */
.admin-exh-thumb {
  height: 78px;
}

/* 上半：相对定位只给二维码按钮当定位基准，不改卡片原有的网格排布。 */
.admin-exh-head {
  position: relative;
  min-width: 0;
}

/* 主体整块可点，纸面的内距交给外层 .card，这里只排内容。
   右侧留出二维码按钮的 44px 触控位加一档间距，长标题不会钻到按钮底下。 */
.admin-exh-main {
  display: flex;
  align-items: flex-start;
  gap: var(--s3);
  width: 100%;
  min-width: 0;
  padding: 0 calc(var(--touch) + var(--s2)) 0 0;
  text-align: start;
}

/* 二维码分享按钮：贴右侧垂直居中，命中区 44px，视觉上仍是一枚细线图标。 */
.admin-exh-qr {
  position: absolute;
  inset-inline-end: 0;
  top: 50%;
  transform: translateY(-50%);
}

/* 标题最多两行：320 宽下也不会被截成四五个字。 */
.admin-exh-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
</style>
