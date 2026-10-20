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
import { exhibitionStatusLabel, registrationStatusLabel, statusTone } from '@/services/status';
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
  return t('profile.public.registrationCount', { count: Number(item.registrationCount ?? 0) });
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
    <!-- 扉页：头像居中、昵称、角色与已参加数、简介、一行公开范围。整段直接排在纸面上。 -->
    <header class="public-leaf">
      <AvatarBox :src="avatarSrc" :name="String(profile.nickname || '')" large class="public-avatar" />
      <strong class="public-name">{{ profile.nickname }}</strong>
      <p class="public-role">
        <RoleTag :role-code="String(profile.roleCode || '')" />
        <!-- 分隔用的「 · 」留在模板里而不放进文案资源：Android 的 string 资源会裁掉首尾空白。 -->
        <span v-if="identityLine" class="public-role-text">{{ identityLine }}</span>
      </p>
      <!-- 已参加展会数不受隐私开关影响：开关只决定下方的报名记录列表 -->
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

    <!-- 公开资料：两列 label / value -->
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

    <!-- 开办的展会：行卡列表，缩略图 44×78 的海报比例 -->
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
            <span class="row-meta">{{ `${item.dateLabel || item.date} · ${item.venue}` }}</span>
            <span class="row-meta">{{ registrationCountLabel(item) }}</span>
          </span>
          <StatusTag
            :text="exhibitionStatusLabel(String(item.statusCode || ''))"
            :tone="statusTone(String(item.statusCode || ''))"
          />
        </button>
      </div>
    </section>

    <!-- 已参加展会：两列竖版 3:4 海报格；图下两行小字（展会名 + 日期），状态压在图上角 -->
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
/* 扉页：居中排版，靠一条发丝线与下方分区断开；这里不是卡片。 */
.public-leaf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s3);
  padding-bottom: var(--s5);
  border-bottom: var(--hairline) solid var(--stroke);
  text-align: center;
}

/* 96px 圆头像：圆环由 .avatar 自带的 1px --stroke 描边提供。 */
.public-leaf .public-avatar {
  width: 96px;
  height: 96px;
  font-size: var(--fs-h1);
}

/* 昵称：整页最大字号。 */
.public-name {
  font-size: var(--fs-h1);
  font-weight: 700;
  letter-spacing: -0.015em;
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
  color: var(--ink-3);
  font-size: var(--fs-label);
  font-weight: 700;
}

/* 已参加数：数字大一号，标签弱化；整行居中。 */
.public-leaf .profile-stats {
  width: auto;
  justify-content: center;
  gap: var(--s2);
}

.public-leaf .profile-stat > strong {
  font-size: var(--fs-h2);
  font-weight: 700;
}

.public-stat-label {
  color: var(--ink-3);
  font-size: var(--fs-label);
}

.public-bio {
  max-width: 34em;
  color: var(--ink-2);
  font-size: var(--fs-body);
  line-height: 1.68;
  overflow-wrap: anywhere;
}

.public-scope {
  display: flex;
  justify-content: center;
}

/* 分区：组标题在上，内容在下，不加卡片。 */
.public-section {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}

.public-section-head {
  display: flex;
  align-items: center;
  gap: var(--s3);
  min-width: 0;
}

/* 公开资料：两列 label / value。 */
.public-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--s4);
  row-gap: var(--s3);
  margin: 0;
}

.public-facts dt {
  color: var(--ink-3);
  font-size: var(--fs-label);
  font-weight: 700;
}

.public-facts dd {
  margin: 0;
  min-width: 0;
  color: var(--ink);
  font-size: var(--fs-body);
  overflow-wrap: anywhere;
}

/* 开办的展会缩略图：设计稿的 44×78 海报比例（令牌里的 .thumb 是 36×64，这里按任务值覆盖）。 */
/* 比 .thumb 高一档，样式顺序不影响尺寸。 */
.row-card .public-thumb {
  width: 44px;
  height: 78px;
}

/* 已参加展会：两列竖版海报格，格子间距 --s3。 */
.attended-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s3);
}

.attended-tile {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  min-width: 0;
}

.tile-cover-wrap {
  position: relative;
}

/* 3:4 竖版，不是 9:16 也不是方形；底色与斜线占位沿用 .ph-img。 */
.tile-cover {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  overflow: hidden;
}

/* 状态信号灯压在图上角：纸色小底保证在任何封面上都读得清。 */
.tile-status {
  position: absolute;
  top: var(--s2);
  inset-inline-start: var(--s2);
  display: inline-flex;
  align-items: center;
  padding: 3px var(--s2);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-pill);
  background: var(--screen);
}

.tile-name {
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--lh-tight);
}

.tile-date {
  color: var(--ink-3);
  font-size: var(--fs-label);
}

/* 宽屏上仍是同一套格子，只是多给一列，免得海报被拉到过大。 */
@media (min-width: 640px) {
  .attended-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
