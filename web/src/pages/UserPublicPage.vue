<script setup lang="ts">
/**
 * 屏幕 14 · 用户公开页
 */
import { computed, onMounted } from 'vue';
import { usePullRefresh } from '@/services/pull-refresh';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { paths } from '@/app/surface';
import { useAsync } from '@/composables/useAsync';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import AppIcon from '@/components/AppIcon.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import MediaBox from '@/components/MediaBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import { formatRecordDate } from '@/services/format';
import { coverOf } from '@/services/cover';
import { openProfileEditor } from '@/services/profile-editor';
import type { JsonObject } from '@/api/types';
import { exhibitionStatusLabel, registrationStatusLabel, statusTone } from '@/services/status';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const query = useAsync<JsonObject>();
const profile = computed(() => query.data.value);
const found = computed(() => profile.value?.found === true);
const settled = computed(() => query.data.value !== undefined || query.error.value !== undefined);
const adminView = computed(() => profile.value?.viewedAsAdmin === true);
const showRegistrations = computed(() => profile.value?.showRegistrations === true);
const registrations = computed(() => asList(profile.value?.registrations));
const attendedCount = computed(() => Number(profile.value?.attendedCount) || 0);
const hosted = computed(() => asList(profile.value?.exhibitions));
const isOwn = computed(() => {
  const nickname = String(route.params.nickname ?? '');
  return nickname !== '' && nickname === String(session.user.nickname ?? '');
});
const avatarSrc = computed(() => {
  const selfId = String(session.user.id || '');
  const pageId = String(profile.value?.id || route.query.userId || '');
  if (selfId && pageId && selfId === pageId) return String(session.user.avatar || '');
  return String(profile.value?.avatar || '');
});
const identityLine = computed(() => {
  const code = String(profile.value?.roleCode || '');
  const tagged = code === 'exhibitor' || code === 'admin';
  const own = isOwn.value ? t('profile.public.ownPage') : '';
  if (tagged) return own;
  const role = String(profile.value?.role || '');
  if (own && role) return `${role}  ${own}`;
  return own || role;
});
const canHostMeetings = computed(() => {
  const role = profile.value?.roleCode;
  return role === 'exhibitor' || role === 'admin';
});
const canRequestMeeting = computed(() => found.value && canHostMeetings.value && !isOwn.value);
const meetingsOpen = computed(() => profile.value?.meetingsOpen === true);
const canManageMeetings = computed(() => adminView.value && canHostMeetings.value);
const closedMeetingLabel = t('meeting.apply.notAccepting');
const requestMeetingLabel = t('profile.public.requestMeeting');
const manageExhibitionsLabel = t('admin.users.manageExhibitions');
const manageMeetingsLabel = t('admin.users.manageMeetings');
const visibilityLabel = computed(() => {
  if (adminView.value) return t('profile.public.statusAdmin');
  return showRegistrations.value ? t('profile.public.statusPublic') : t('profile.public.statusPartial');
});

const COPY = {
  hostedTitle: t('profile.public.hostedExhibitions'),
};

function registrationCountLabel(item: JsonObject): string {
  return t('profile.public.registrationCount', { count: Number(item.registrationCount ?? 0) });
}

function asList(value: unknown): JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

function load(): Promise<unknown> {
  return query.run(() =>
    api.users.publicProfile({
      nickname: String(route.params.nickname ?? ''),
      userId: String(route.query.userId ?? ''),
    }),
  );
}

function requestMeeting(): void {
  if (!meetingsOpen.value) return;
  if (!session.can('register')) {
    toast(t('exhibition.detail.registerRestricted'), 'error');
    return;
  }
  const id = String(profile.value?.id || '');
  if (!id) return;
  void router.push(paths.meetingApply(id));
}

function openExhibitionAdmin(): void {
  const id = String(profile.value?.id || '');
  if (!id) return;
  void router.push(`/admin/exhibitions/${encodeURIComponent(id)}`);
}

function openMeetingAdmin(): void {
  const id = String(profile.value?.id || '');
  if (!id) return;
  void router.push(`/admin/meetings/${encodeURIComponent(id)}`);
}

function editAdminProfile(): void {
  const item = profile.value;
  const id = String(item?.id || '');
  if (!item || !id) return;
  openProfileEditor(item, {
    targetUserId: id,
    onSaved: () => void load(),
  });
}

onMounted(load);

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && settled.value),
);
</script>

<template>
  <div v-if="adminView" class="notice" data-tone="accent">
    <strong>{{ t('profile.public.adminView') }}</strong>
    <span>{{ t('profile.public.adminNotice') }}</span>
  </div>

  <div v-if="query.error.value && profile" class="notice" data-tone="error">
    <span>{{ query.error.value.message }}</span>
  </div>

  <SkeletonBlock v-if="!settled" :rows="3" />
  <StateBlock
    v-else-if="!profile"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value?.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <StateBlock
    v-else-if="!found"
    icon="user"
    :title="t('meeting.apply.noPublicProfile')"
    :description="String(profile.error || t('profile.public.unavailable'))"
    :action-label="t('exhibition.detail.backHome')"
    @action="router.push('/home')"
  />
  <template v-else>
    <header class="public-leaf">
      <AvatarBox :src="avatarSrc" :name="String(profile.nickname || '')" large class="public-avatar" />
      <div class="public-name-row">
        <strong class="public-name">{{ profile.nickname }}</strong>
        <button
          v-if="adminView"
          class="icon-button public-edit"
          data-variant="outlined"
          type="button"
          :aria-label="t('settings.profile.editProfile')"
          :title="t('settings.profile.editProfile')"
          @click="editAdminProfile"
        >
          <AppIcon name="edit" />
        </button>
      </div>
      <p class="public-role">
        <RoleTag :role-code="String(profile.roleCode || '')" />
        <span v-if="identityLine" class="public-role-text">{{ identityLine }}</span>
      </p>
      <div class="profile-stats">
        <span class="profile-stat">
          <strong>{{ attendedCount }}</strong>
          <span class="public-stat-label">{{ t('profile.stats.attended') }}</span>
        </span>
      </div>
      <p class="public-bio">{{ profile.bio || t('profile.public.bioEmpty') }}</p>
      <p class="public-scope">
        <StatusTag :text="visibilityLabel" :tone="adminView || showRegistrations ? 'ok' : 'muted'" />
      </p>
    </header>

    <section class="public-section">
      <span class="section-label">{{ t('profile.public.details') }}</span>
      <dl class="public-facts">
        <dt>{{ t('settings.profile.region') }}</dt>
        <dd>{{ profile.region || t('profile.public.regionUndisclosed') }}</dd>
        <dt>{{ t('settings.profile.social') }}</dt>
        <dd>{{ profile.socialMedia || t('profile.public.socialHidden') }}</dd>
      </dl>
    </section>

    <div v-if="canManageMeetings || canRequestMeeting" class="stack" data-gap="sm">
      <div v-if="canManageMeetings" class="grid-cols-2">
        <button class="cta ghost" type="button" @click="openExhibitionAdmin">
          {{ manageExhibitionsLabel }}
        </button>
        <button class="cta ghost" type="button" @click="openMeetingAdmin">
          {{ manageMeetingsLabel }}
        </button>
      </div>
      <button v-if="canRequestMeeting" class="cta" type="button" :disabled="!meetingsOpen" @click="requestMeeting">
        {{ meetingsOpen ? requestMeetingLabel : closedMeetingLabel }}
      </button>
    </div>

    <section v-if="hosted.length > 0" class="public-section">
      <div class="public-section-head">
        <span class="section-label">{{ COPY.hostedTitle }}</span>
        <span class="pill">{{ t('profile.public.hostedCount', { count: hosted.length }) }}</span>
      </div>
      <div class="list" data-gap="sm">
        <button
          v-for="item in hosted"
          :key="String(item.id)"
          class="row-card"
          type="button"
          data-pressable="true"
          @click="router.push(`/detail/${encodeURIComponent(String(item.id))}`)"
        >
          <MediaBox class-name="thumb thumb-cover public-thumb" :src="coverOf(item.imageUri)" />
          <span class="row-copy">
            <strong class="row-title truncate">{{ item.title }}</strong>
            <span class="meta-inline row-meta">
              <span>{{ item.dateLabel || item.date }}</span>
              <span class="truncate">{{ item.venue }}</span>
            </span>
            <span class="row-meta">{{ registrationCountLabel(item) }}</span>
          </span>
          <StatusTag
            :text="exhibitionStatusLabel(String(item.statusCode || ''))"
            :tone="statusTone(String(item.statusCode || ''))"
          />
        </button>
      </div>
    </section>

    <section class="public-section">
      <div class="public-section-head">
        <span class="section-label">{{ t('profile.public.attendedExhibitions') }}</span>
        <span class="pill">{{ t('profile.public.recordCount', { count: registrations.length }) }}</span>
      </div>
      <div v-if="registrations.length > 0" class="attended-grid">
        <div v-for="record in registrations" :key="String(record.id || record.exhibitionTitle)" class="attended-tile">
          <div class="tile-cover-wrap">
            <MediaBox class-name="tile-cover" />
            <span class="tile-status">
              <StatusTag
                :text="registrationStatusLabel(String(record.statusCode || ''))"
                :tone="statusTone(String(record.statusCode || ''))"
              />
            </span>
          </div>
          <strong class="tile-name clamp-2">{{ record.exhibitionTitle }}</strong>
          <span class="tile-date">{{ formatRecordDate(record) }}</span>
        </div>
      </div>
      <p v-else class="row-meta">
        {{ showRegistrations ? t('profile.public.noRegistrations') : t('profile.public.registrationsHidden') }}
      </p>
    </section>
  </template>
</template>

<style>
.public-leaf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s3);
  padding: var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
  text-align: center;
}

.public-leaf .public-avatar {
  width: 68px;
  height: 68px;
  font-size: var(--fs-lg);
}

.public-name-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
  min-width: 0;
}

.public-edit {
  flex: none;
}

.public-name {
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: var(--lh-tight);
  overflow-wrap: anywhere;
}

.public-role {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
}

.public-role-text {
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.public-leaf .profile-stats {
  width: auto;
  justify-content: center;
  gap: 0;
  padding: var(--s2) var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
}

.public-leaf .profile-stat {
  align-items: center;
  text-align: center;
}

.public-leaf .profile-stat > strong {
  font-size: var(--fs-lg);
  font-weight: 600;
}

.public-stat-label {
  color: var(--ink-2);
  font-size: var(--fs-xs);
  text-align: center;
}

.public-bio {
  max-width: 34em;
  color: var(--ink-2);
  font-size: var(--fs-body);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.public-scope {
  display: flex;
  justify-content: center;
}

.public-section {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}

.public-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s3);
  min-width: 0;
}

.public-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--s5);
  row-gap: var(--s2);
  margin: 0;
  padding: var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
}

.public-facts dt {
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.public-facts dd {
  margin: 0;
  min-width: 0;
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 500;
  overflow-wrap: anywhere;
}

.row-card .public-thumb {
  height: 72px;
}

.attended-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s3);
}

.attended-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: var(--s2);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
}

.tile-cover-wrap {
  position: relative;
}

.tile-cover {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-chip);
  overflow: hidden;
}

.tile-status {
  position: absolute;
  top: 6px;
  inset-inline-start: 6px;
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-chip);
  background: var(--surface-card);
}

.tile-name {
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: var(--lh-tight);
}

.tile-date {
  color: var(--ink-3);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}

@media (min-width: 640px) {
  .attended-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
