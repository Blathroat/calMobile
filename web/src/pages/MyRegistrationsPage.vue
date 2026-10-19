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
import { useRevealReady } from '@/composables/useReveal';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { tagRead, type CachedRead } from '@/services/query-cache';
import { usePullRefresh } from '@/services/pull-refresh';
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
const emptyDescription = t('registration.list.joinEmptyHint');
const registrationSection = t('registration.list.exhibitionSection');
const meetingSection = t('registration.list.privateMeeting');

/** 条数是已加载记录数之和；数据到位前保持「—」。 */
const countLabel = computed(() => {
  if (!session.loggedIn) return t('registration.list.signedOut');
  if (!hasContent.value) return '—';
  return t('registration.list.recordCount', { count: records.value.length + meetings.value.length });
});
/** 第一次画出整表时不播进入动画；之后新卡片才滑入。 */
const revealReady = useRevealReady();

onMounted(() => {
  // 路由已要求登录；未登录时不发请求，直接画出「先去登录」的引导。
  if (session.loggedIn) void load();
});

/** 报名和会议各自带上缓存快照，有一边过期也能先画出另一边。 */
function readActivities(): CachedRead<Activities> {
  const registrations = api.registrations.list() as CachedRead<Registration[]>;
  const meetings = api.meetings.mine() as CachedRead<JsonObject[]>;
  const cached =
    registrations.cached !== undefined || meetings.cached !== undefined
      ? {
          registrations: registrations.cached ?? [],
          meetings: Array.isArray(meetings.cached) ? meetings.cached : [],
        }
      : undefined;
  return tagRead(
    Promise.all([registrations, meetings]).then(([nextRegistrations, nextMeetings]) => ({
      registrations: nextRegistrations,
      meetings: Array.isArray(nextMeetings) ? nextMeetings : [],
    })),
    cached,
    registrations.revalidating || meetings.revalidating,
  );
}

async function load(): Promise<void> {
  await query.run(() => readActivities());
}

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && hasContent.value),
  computed(() => session.loggedIn),
);

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
    <div class="list" data-gap="sm" :data-busy="query.loading.value && hasContent ? 'true' : undefined">
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
          <TransitionGroup name="reveal" tag="div" class="list reveal" data-gap="sm" :css="revealReady">
            <button
              v-for="record in records"
              :key="String(record.id)"
              class="row-card"
              type="button"
              data-pressable="true"
              :aria-label="t('registration.list.viewRegistrationAria', { title: String(record.exhibitionTitle ?? '') })"
              @pointerdown="warm(record.id)"
              @click="router.push(paths.registrationDetail(String(record.id)))"
            >
              <!-- 报名接口不下发展会封面，这里保留线框的斜线占位 -->
              <MediaBox class-name="thumb" />
              <span class="row-copy">
                <strong class="row-title truncate">{{ record.exhibitionTitle }}</strong>
                <span class="row-meta">{{ formatRecordDate(record) }} {{ record.exhibitionTime }}</span>
                <span class="row-meta truncate">{{ record.exhibitionVenue }}</span>
                <span class="row-meta truncate">{{
                  t('registration.list.answersLine', { summary: summary(record) })
                }}</span>
              </span>
              <StatusTag :text="String(record.statusLabel || record.status || '')" />
            </button>
          </TransitionGroup>
        </template>

        <template v-if="meetings.length > 0">
          <span v-if="records.length > 0" class="section-label">{{ meetingSection }}</span>
          <TransitionGroup name="reveal" tag="div" class="list reveal" data-gap="sm" :css="revealReady">
            <button
              v-for="meeting in meetings"
              :key="String(meeting.id)"
              class="row-card"
              type="button"
              data-pressable="true"
              :aria-label="t('registration.list.viewMeetingAria', { name: String(meeting.exhibitorName ?? '') })"
              @pointerdown="warmMeeting(meeting.id)"
              @click="router.push(paths.meetingDetail(String(meeting.id)))"
            >
              <span class="avatar" aria-hidden="true">{{
                String(meeting.exhibitorName || t('exhibition.detail.brandMark')).slice(0, 1)
              }}</span>
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
          </TransitionGroup>
        </template>
      </template>
    </div>

    <!-- 刷新失败但屏幕上还有旧记录：原位提示，不清空已有内容 -->
    <div v-if="query.error.value && hasContent" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>
  </template>
</template>
