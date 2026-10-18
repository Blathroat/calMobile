<script setup lang="ts">
/**
 * 屏幕 14 · 用户公开页
 * 业务：展示身份卡（含已参加展会数）、昵称、简介、所在地区、社交账号与已参加展会。
 *
 * 身份卡上的已参加展会数是公开事实，不受「展示我的报名」策略影响；该策略只决定下方
 * 报名记录列表是否可见。管理员从管理后台进入时不受该策略影响，始终能查看用户已参加的展会，
 * 页面会说明当前是管理视角，避免把「管理可见」当成公开范围。
 *
 * 取数走 `useAsync` + api 的查询缓存：从搜索列表点进来时数据已经预热过，不会先闪骨架屏。
 */
import { computed, onMounted } from 'vue';
import { usePullRefresh } from '@/services/pull-refresh';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { paths } from '@/app/surface';
import { useAsync } from '@/composables/useAsync';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import AvatarBox from '@/components/AvatarBox.vue';
import MediaBox from '@/components/MediaBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import { formatRecordDate } from '@/services/format';
import { coverOf } from '@/services/cover';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const query = useAsync<JsonObject>();
const profile = computed(() => query.data.value);
const found = computed(() => profile.value?.found === true);
/** 首次结果还没回来时不画空状态：先骨架，否则首帧会闪一下错误块。 */
const settled = computed(() => query.data.value !== undefined || query.error.value !== undefined);
const adminView = computed(() => profile.value?.viewedAsAdmin === true);
/** 用户自己的「展示我的报名」策略：关掉时下方只说明「不展示」。 */
const showRegistrations = computed(() => profile.value?.showRegistrations === true);
const registrations = computed(() => asList(profile.value?.registrations));
/** 已参加展会数：服务端始终下发，不受「展示我的报名」影响。 */
const attendedCount = computed(() => Number(profile.value?.attendedCount) || 0);
/** 这个用户自己开办的展会：只有展商 / 管理员有，普通用户是空数组。 */
const hosted = computed(() => asList(profile.value?.exhibitions));
const isOwn = computed(() => {
  const nickname = String(route.params.nickname ?? '');
  return nickname !== '' && nickname === String(session.user.nickname ?? '');
});
/** 看自己的公开页时用会话里的头像。公开资料缓存还停在旧地址时，上传后也能立刻换上。 */
const avatarSrc = computed(() => {
  const selfId = String(session.user.id || '');
  const pageId = String(profile.value?.id || route.query.userId || '');
  if (selfId && pageId && selfId === pageId) return String(session.user.avatar || '');
  return String(profile.value?.avatar || '');
});
/** 展商和管理员的角色改由名字后的标签表达，这里不再重复。 */
const identityLine = computed(() => {
  const code = String(profile.value?.roleCode || '');
  const tagged = code === 'exhibitor' || code === 'admin';
  const own = isOwn.value ? t('profile.public.ownPage') : '';
  if (tagged) return own;
  const role = String(profile.value?.role || '');
  if (own && role) return `${role} · ${own}`;
  return own || role;
});
/** 管理员包含全部展商能力，公开页上同样可以接受会议预约。 */
const canHostMeetings = computed(() => {
  const role = profile.value?.roleCode;
  return role === 'exhibitor' || role === 'admin';
});
/** 主办人主页能预约；未开启时按钮仍在，只是置灰并改文案。 */
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
  /** 展商主页的主区块：这个人自己开办的展会（普通用户没有，整块不渲染）。 */
  hostedTitle: t('profile.public.hostedExhibitions'),
};

/** 报名人数的量词放在这里，模板里不出现中文。 */
function registrationCountLabel(item: JsonObject): string {
  return `${Number(item.registrationCount ?? 0)} 人报名`;
}

function asList(value: unknown): JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

/** 用户公开页读 nickname + userId：搜索页预热用的是同一份参数，缓存键才对得上。 */
function load(): Promise<unknown> {
  return query.run(() =>
    api.users.publicProfile({
      nickname: String(route.params.nickname ?? ''),
      userId: String(route.query.userId ?? ''),
    }),
  );
}

/** 未开启时按钮是 disabled，点不到这里。受限账号不能报名，就地说明，不把人送进会被守卫踢回的申请页。 */
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

onMounted(load);

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && settled.value),
);
</script>

<template>
  <!-- 管理视角：管理员看得到全部已参加展会，页面明确说明，避免误解为公开范围。 -->
  <div v-if="adminView" class="notice" data-tone="accent">
    <strong>{{ t('profile.public.adminView') }}</strong>
    <span>{{ t('profile.public.adminNotice') }}</span>
  </div>

  <!-- 已有资料时刷新失败：旧资料留在屏幕上，错误只作为附加说明。 -->
  <div v-if="query.error.value && profile" class="notice" data-tone="accent">
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
  <!-- 用户可能已被停用或删除：说清原因并给出唯一出口，不留可点的操作。 -->
  <StateBlock
    v-else-if="!found"
    icon="user"
    :title="t('meeting.apply.noPublicProfile')"
    :description="String(profile.error || t('profile.public.unavailable'))"
    :action-label="t('exhibition.detail.backHome')"
    @action="router.push('/home')"
  />
  <template v-else>
    <div class="card">
      <div class="row" data-gap="md">
        <AvatarBox :src="avatarSrc" :name="String(profile.nickname || '')" />
        <span class="row-copy">
          <span class="name-line">
            <strong class="row-title">{{ profile.nickname }}</strong>
            <RoleTag :role-code="String(profile.roleCode || '')" />
          </span>
          <!-- 分隔用的「 · 」留在模板里而不放进文案资源：Android 的 string 资源会裁掉首尾空白。 -->
          <span v-if="identityLine" class="row-meta">{{ identityLine }}</span>
          <span class="row-meta">{{ profile.bio || t('profile.public.bioEmpty') }}</span>
        </span>
        <StatusTag :text="visibilityLabel" :tone="adminView || showRegistrations ? 'ok' : 'muted'" />
      </div>
      <!-- 已参加展会数不受隐私开关影响：开关只决定下方的报名记录列表 -->
      <hr class="divider" />
      <div class="profile-stats">
        <span class="profile-stat">
          <strong>{{ attendedCount }}</strong>
          <span class="row-meta">{{ t('profile.stats.attended') }}</span>
        </span>
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('profile.public.details') }}</span>
      <div class="row" data-between="true">
        <span class="row-meta">{{ t('settings.profile.region') }}</span>
        <span class="strong truncate">{{ profile.region || t('profile.public.regionUndisclosed') }}</span>
      </div>
      <div class="row" data-between="true">
        <span class="row-meta">{{ t('settings.profile.social') }}</span>
        <span class="strong truncate">{{ profile.socialMedia || t('profile.public.socialHidden') }}</span>
      </div>
    </div>

    <div v-if="canManageMeetings || canRequestMeeting" class="stack" data-gap="sm">
      <div v-if="canManageMeetings" class="grid-cols-2">
        <button class="cta ghost" type="button" @click="openExhibitionAdmin">
          {{ manageExhibitionsLabel }}
        </button>
        <button class="cta ghost" type="button" @click="openMeetingAdmin">
          {{ manageMeetingsLabel }}
        </button>
      </div>
      <button
        v-if="canRequestMeeting"
        class="cta ghost"
        type="button"
        :disabled="!meetingsOpen"
        @click="requestMeeting"
      >
        {{ meetingsOpen ? requestMeetingLabel : closedMeetingLabel }}
      </button>
    </div>

    <!-- 开办的展会：展商主页的主要内容，放在「已参加展会」之前 -->
    <div v-if="hosted.length > 0" class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ COPY.hostedTitle }}</span>
        <span class="pill">{{ hosted.length }} 个</span>
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
          <MediaBox class-name="thumb thumb-cover thumb-sm" :src="coverOf(item.imageUri)" />
          <span class="row-copy">
            <strong class="row-title truncate">{{ item.title }}</strong>
            <span class="row-meta">{{ `${item.dateLabel || item.date} · ${item.venue}` }}</span>
            <span class="row-meta">{{ registrationCountLabel(item) }}</span>
          </span>
          <StatusTag :text="String(item.status || '')" />
        </button>
      </div>
    </div>

    <div class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('profile.public.attendedExhibitions') }}</span>
        <span class="pill">{{ registrations.length }} 条</span>
      </div>
      <div v-if="registrations.length > 0" class="list" data-gap="sm">
        <div v-for="record in registrations" :key="String(record.id || record.exhibitionTitle)" class="row-card">
          <MediaBox class-name="thumb thumb-cover thumb-sm" />
          <span class="row-copy">
            <strong class="row-title truncate">{{ record.exhibitionTitle }}</strong>
            <span class="row-meta">{{ formatRecordDate(record) }} · {{ record.statusLabel }}</span>
          </span>
          <StatusTag :text="String(record.statusLabel || '')" />
        </div>
      </div>
      <p v-else class="row-meta">
        {{ showRegistrations ? t('profile.public.noRegistrations') : t('profile.public.registrationsHidden') }}
      </p>
    </div>
  </template>
</template>
