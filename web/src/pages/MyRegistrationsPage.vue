<script setup lang="ts">
/**
 * 屏幕 07 · 我的报名（列表）
 * 线框：docs/newUI/remaining-ui.html #screen-my-registrations
 *
 * 状态文字由后端下发（待审核 / 已通过 / 已撤销），颜色只作辅助线索；
 * 列表项按下即预热报名详情，点进去时数据已在缓存里，不再闪骨架屏。
 */
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import MediaBox from '@/components/MediaBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatRecordDate, truncate } from '@/services/format';
import type { Registration } from '@/api/types';
import { isJoinSurface, paths } from '@/app/surface';
import { t } from '@/i18n';

const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();

const query = useAsync<Registration[]>();
const records = computed(() => query.data.value ?? []);
const hasContent = computed(() => query.data.value !== undefined);
/** 条数是派生数据（与首页的「N 场」同类），不占用文案 key；数据到位前保持「—」。 */
const emptyDescription = t('s_1scjlq7');

const countLabel = computed(() => {
  if (!session.loggedIn) return t('s_1ydrtwl');
  return hasContent.value ? `${records.value.length} 条记录` : '—';
});

onMounted(() => {
  // 路由已要求登录；未登录时不发请求，直接画出「先去登录」的引导。
  if (session.loggedIn) void load();
});

async function load(): Promise<void> {
  await query.run(() => api.registrations.list());
}

/** 手指按下就预取详情，点进去时不再等首屏。 */
function warm(id: unknown): void {
  void api.registrations.get(String(id)).catch(() => undefined);
}

/** 报名摘要：没有额外信息时沿用旧页面同一句说明。 */
function summary(record: Registration): string {
  return truncate(record.answers, 34) || t('s_v8pba2');
}

function openLogin(): void {
  void router.push({ path: '/login', query: { redirect: paths.registrations } });
}
</script>

<template>
  <div class="row" data-between="true">
    <div class="stack" data-gap="sm">
      <span class="eyebrow">{{ bootstrap.brand.en }}</span>
      <h2>{{ t('s_1m2dh8u') }}</h2>
    </div>
    <span class="pill">{{ countLabel }}</span>
  </div>

  <!-- 访客（会话过期后仍停留在本页）走登录引导，与「报名记录为空」是两回事 -->
  <StateBlock
    v-if="!session.loggedIn"
    icon="user"
    :title="t('s_1eiqw54')"
    :description="t('s_mf99no')"
    :action-label="t('s_533bde')"
    @action="openLogin"
  />

  <template v-else>
    <div class="list" data-gap="sm">
      <SkeletonBlock v-if="query.loading.value && !hasContent" :rows="3" />

      <StateBlock
        v-else-if="query.error.value && !hasContent"
        tone="error"
        :title="t('s_1wh1onp')"
        :description="query.error.value.message"
        :action-label="t('s_lswd2v')"
        @action="load"
      />

      <StateBlock
        v-else-if="records.length === 0"
        icon="ticket"
        :title="t('s_a8pyd6')"
        :description="isJoinSurface ? emptyDescription : t('s_yfjo64')"
        :action-label="isJoinSurface ? '' : t('s_11ps4x5')"
        @action="router.push(paths.home)"
      />

      <template v-else>
        <button
          v-for="record in records"
          :key="String(record.id)"
          class="row-card"
          type="button"
          data-pressable="true"
          :aria-label="`查看 ${record.exhibitionTitle} 的报名详情`"
          @pointerdown="warm(record.id)"
          @click="router.push(paths.registrationDetail(String(record.id)))"
        >
          <!-- 报名接口不下发展会封面，这里保留线框的斜线占位 -->
          <MediaBox class-name="thumb" />
          <span class="row-copy">
            <strong class="row-title truncate">{{ record.exhibitionTitle }}</strong>
            <span class="row-meta">{{ formatRecordDate(record) }} {{ record.exhibitionTime }}</span>
            <span class="row-meta truncate">{{ record.exhibitionVenue }}</span>
            <span class="row-meta truncate">报名信息：{{ summary(record) }}</span>
          </span>
          <StatusTag :text="String(record.statusLabel || record.status || '')" />
        </button>
      </template>
    </div>

    <!-- 刷新失败但屏幕上还有旧记录：原位提示，不清空已有内容 -->
    <div v-if="query.error.value && hasContent" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>
  </template>
</template>
