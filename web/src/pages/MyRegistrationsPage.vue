<script setup lang="ts">
/**
 * 屏幕 07 · 我的活动（列表）
 *
 * 展会报名与私人会议申请放在同一页。状态文字由后端下发，颜色只作辅助线索。
 * 报名和会议卡片都进入各自的详情页。
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
import RoleTag from '@/components/RoleTag.vue';
import { formatMeetingWhen, formatRecordDate, truncate } from '@/services/format';
import type { JsonObject, Registration } from '@/api/types';
import { isJoinSurface, paths } from '@/app/surface';
import { t } from '@/i18n';

const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();

interface Activities {
  registrations: Registration[];
  meetings: JsonObject[];
}

const query = useAsync<Activities>();
const records = computed(() => query.data.value?.registrations ?? []);
const meetings = computed(() => query.data.value?.meetings ?? []);
const hasContent = computed(() => query.data.value !== undefined);
const isEmpty = computed(() => records.value.length === 0 && meetings.value.length === 0);
/** 条数是派生数据（与首页的「N 场」同类），不占用文案 key；数据到位前保持「—」。 */
const emptyDescription = t('registration.list.joinEmptyHint');
const registrationSection = t('registration.list.exhibitionSection');
const meetingSection = t('registration.list.privateMeeting');

const countLabel = computed(() => {
  if (!session.loggedIn) return t('registration.list.signedOut');
  return hasContent.value ? `${records.value.length + meetings.value.length} 条记录` : '—';
});

onMounted(() => {
  // 路由已要求登录；未登录时不发请求，直接画出「先去登录」的引导。
  if (session.loggedIn) void load();
});

async function load(): Promise<void> {
  await query.run(async () => {
    const [registrations, meetings] = await Promise.all([
      api.registrations.list(),
      api.meetings.mine(),
    ]);
    return {
      registrations,
      meetings: Array.isArray(meetings) ? meetings : [],
    };
  });
}

/** 手指按下就预取详情，点进去时不再等首屏。 */
function warm(id: unknown): void {
  void api.registrations.get(String(id)).catch(() => undefined);
}

function warmMeeting(id: unknown): void {
  void api.meetings.get(String(id)).catch(() => undefined);
}

/** 报名摘要：没有额外信息时沿用旧页面同一句说明。 */
function summary(record: Registration): string {
  return truncate(record.answers, 34) || t('registration.detail.noCollectedInfo');
}

function meetingSummary(meeting: JsonObject): string {
  return truncate(meeting.answers, 34) || t('registration.list.noCollectFields');
}

function openLogin(): void {
  void router.push({ path: '/login', query: { redirect: paths.registrations } });
}
</script>

<template>
  <div class="row" data-between="true">
    <div class="stack" data-gap="sm">
      <span class="eyebrow">{{ bootstrap.brand.en }}</span>
      <h2>{{ t('registration.list.title') }}</h2>
    </div>
    <span class="pill">{{ countLabel }}</span>
  </div>

  <!-- 访客（会话过期后仍停留在本页）走登录引导，与「报名记录为空」是两回事 -->
  <StateBlock
    v-if="!session.loggedIn"
    icon="user"
    :title="t('registration.list.loginToView')"
    :description="t('registration.list.loginHint')"
    :action-label="t('registration.list.goLogin')"
    @action="openLogin"
  />

  <template v-else>
    <div class="list" data-gap="sm">
      <SkeletonBlock v-if="query.loading.value && !hasContent" :rows="3" />

      <StateBlock
        v-else-if="query.error.value && !hasContent"
        tone="error"
        :title="t('registration.list.loadFailed')"
        :description="query.error.value.message"
        :action-label="t('common.retry')"
        @action="load"
      />

      <StateBlock
        v-else-if="isEmpty"
        icon="ticket"
        :title="t('registration.list.empty')"
        :description="isJoinSurface ? emptyDescription : t('registration.list.emptyHint')"
        :action-label="isJoinSurface ? '' : t('registration.list.browseHome')"
        @action="router.push(paths.home)"
      />

      <template v-else>
        <template v-if="records.length > 0">
          <span v-if="meetings.length > 0" class="section-label">{{ registrationSection }}</span>
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

        <template v-if="meetings.length > 0">
          <span v-if="records.length > 0" class="section-label">{{ meetingSection }}</span>
          <button
            v-for="meeting in meetings"
            :key="String(meeting.id)"
            class="row-card"
            type="button"
            data-pressable="true"
            :aria-label="`查看与 ${meeting.exhibitorName} 的会议详情`"
            @pointerdown="warmMeeting(meeting.id)"
            @click="router.push(paths.meetingDetail(String(meeting.id)))"
          >
            <span class="avatar" aria-hidden="true">{{ String(meeting.exhibitorName || '展').slice(0, 1) }}</span>
            <span class="row-copy">
              <span class="name-line">
                <strong class="row-title truncate">{{ meeting.exhibitorName }}</strong>
                <RoleTag :role-code="String(meeting.exhibitorRole || '')" />
              </span>
              <span class="row-meta">{{ formatMeetingWhen(meeting.meetingDate, meeting.meetingTime) }}</span>
              <span class="row-meta truncate">{{ meetingSummary(meeting) }}</span>
            </span>
            <StatusTag :text="String(meeting.status || '')" />
          </button>
        </template>
      </template>
    </div>

    <!-- 刷新失败但屏幕上还有旧记录：原位提示，不清空已有内容 -->
    <div v-if="query.error.value && hasContent" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>
  </template>
</template>
