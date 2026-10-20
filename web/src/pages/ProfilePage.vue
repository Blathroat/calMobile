<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（身份卡 + 活动概览 + 简介 + 公开资料 + 入口）
 * 旧实现：app/src/main/assets/web/js/pages/profile.js（`git show 5e3d9ab^`）
 *
 * 这一屏回答三件事：我是谁（身份卡）、我给别人的印象（简介与公开资料）、
 * 我参加过什么（身份卡底部的活动概览）。最后才是用户设置、安全设置与退出登录。
 *
 * 身份卡右侧的铅笔打开与用户设置相同的编辑资料抽屉（`services/profile-editor.ts`）。
 * 没有简介时显示可点的空态，不把操作指引当正文。
 *
 * 活动概览复用 `registrations` 列表的查询缓存：它是增强信息，取不到就不显示，
 * 不让资料主状态跟着失败（与展会详情页判断「我的报名」同一类处理）。
 *
 * 退出登录仍走 `POST /auth/logout`，一次调用清掉服务端与本地会话。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { usePullRefresh } from '@/services/pull-refresh';
import { useRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import { openProfileEditor } from '@/services/profile-editor';
import { paths } from '@/app/surface';
import { REGISTRATION_STATUS, USER_STATUS, roleLabel, userStatusLabel } from '@/services/status';
import { daysUntil, formatLocalChineseDate } from '@/services/format';
import AppIcon from '@/components/AppIcon.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import RoleTag from '@/components/RoleTag.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const COPY = {
  /** 设置入口的说明：把设置页里能改的东西列出来，省得点进去才发现。 */
  settingsMeta: t('profile.settingsSummary'),
};

const router = useRouter();
const session = useSessionStore();

const user = computed(() => session.user);
const loggedIn = computed(() => session.loggedIn);
/** 受限账号不能改资料：只有后端明确下发 `false` 才算。 */
const limited = computed(() => user.value.can?.profile === false);
const limitHint = computed(() => t('profile.restricted'));

// ── 取数：资料是主状态，活动概览是增强信息 ──────────────────────

const profile = reactive<JsonObject>({});
const loading = ref(true);
const loadFailed = ref(false);
const loadError = ref('');
const activity = ref<{ attended: number; total: number } | null>(null);

/** 取数失败优先用后端/传输层自带的原因，没有就回落到通用文案。 */
function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('exhibition.form.saveFailed');
}

/** 会话里已经有的资料先铺上，公开页和设置页改过头像后这里不用等 GET。 */
function paintFromSession(): void {
  const current = session.user;
  if (!current.id) return;
  const text = (value: unknown, fallback: unknown) => (typeof value === 'string' ? value : fallback);
  Object.assign(profile, {
    bio: text(current.bio, profile.bio),
    region: text(current.region, profile.region),
    socialMedia: text(current.socialMedia, profile.socialMedia),
    showRegistrations: current.showRegistrations === true,
  });
}

/**
 * 资料是主状态：失败在原位给出错误块与重试，而不是画出空资料。
 * 会话里已经有 id 时，错误只作为附加提示，已经画出的身份卡不清空。
 */
async function load(): Promise<void> {
  await bootApp().catch(() => undefined);
  paintFromSession();
  loading.value = true;
  const epoch = session.profileEpoch;
  try {
    const result = await api.profile.get();
    if (epoch !== session.profileEpoch) {
      paintFromSession();
      return;
    }
    Object.assign(profile, result ?? {});
    session.applyUser({ ...user.value, ...result });
    loadFailed.value = false;
    loadError.value = '';
  } catch (reason) {
    loadFailed.value = true;
    loadError.value = errorText(reason);
  } finally {
    loading.value = false;
  }
}

/**
 * 活动概览：报名列表条数与已参加场数。
 *
 * 只用于身份卡底部的一行摘要，属于增强信息：取不到就不显示，不弹错误、
 * 也不影响资料主状态。列表本身走查询缓存，和其它页面共用同一条 `registrations` 键。
 */
async function loadActivity(): Promise<void> {
  if (session.loggedIn !== true) return;
  try {
    const records = await api.registrations.list();
    if (!Array.isArray(records)) return;
    activity.value = {
      attended: records.filter((record) => String(record.statusCode ?? '') === REGISTRATION_STATUS.ATTENDED).length,
      total: records.length,
    };
  } catch {
    // 增强信息失败保持隐藏；下拉刷新时会再试一次。
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([load(), loadActivity()]);
}

onMounted(() => {
  void load();
  void loadActivity();
});

usePullRefresh(
  () => refreshAll(),
  computed(() => loading.value && Boolean(user.value.id)),
  loggedIn,
);

// ── 展示用取值 ────────────────────────────────────────────────────

/** 身份说明行：正常状态不占一行，只在受限/封禁时说明账号状态。 */
const identityLine = computed(() => {
  // 角色与状态都按 code 取文案：接口下发的 roleLabel / status 是中文标签，装语言包后不能直接用。
  const code = String(user.value.role || '');
  const role = roleLabel(code);
  const statusCode = String(user.value.statusCode || '');
  const status =
    statusCode === USER_STATUS.RESTRICTED || statusCode === USER_STATUS.BANNED ? userStatusLabel(statusCode) : '';
  const tagged = code === 'exhibitor' || code === 'admin';
  if (tagged) return status;
  if (!status) return role;
  return role ? role + ' · ' + status : status;
});

// ── 展商时长：限时展商看到到期日，到期后说明原因与续期入口 ──

/** 限时展商身份卡里的一行：有效期至某日。 */
const membershipLine = computed(() => {
  if (String(user.value.role || '') !== 'exhibitor') return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? t('profile.membership.until', { date }) : '';
});

/** 7 天内到期的提醒：说明还能用多久、可以续期。 */
const membershipSoon = computed(() => {
  if (String(user.value.role || '') !== 'exhibitor') return '';
  const days = daysUntil(user.value.exhibitorExpiresAt);
  if (days === null || days > 7) return '';
  return t('profile.membership.soon', { days });
});

/** 已经自动到期的账号：说明原因与续期方式（管理员手动降级会清掉到期时间，不会走到这里）。 */
const membershipExpired = computed(() => {
  if (user.value.exhibitorExpired !== true) return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? t('profile.membership.expired', { date }) : '';
});

function hasProfileValue(key: string): boolean {
  const value = profile[key];
  return typeof value === 'string' && value !== '';
}

/** 资料字段的展示值：缺失时沿用旧页面给出的空态文案。 */
function profileValue(key: string, emptyKey: string): string {
  return hasProfileValue(key) ? String(profile[key]) : t(emptyKey);
}

const hasBio = computed(() => hasProfileValue('bio'));

/** 自己的公开主页：优先按昵称定位；带上 userId，昵称重名时也能落到本账号。 */
const publicPath = computed(() => {
  const nickname = String(user.value.nickname || user.value.username || '');
  if (!nickname) return '';
  const id = String(user.value.id || '');
  const query = id ? '?userId=' + encodeURIComponent(id) : '';
  return '/user-public/' + encodeURIComponent(nickname) + query;
});

/** 公开主页入口右侧说明的是「别人能看到什么」，不是本页的开关状态。 */
const publicMeta = computed(() =>
  profile.showRegistrations === true ? t('profile.publicRegistrationsShown') : t('profile.publicRegistrationsHidden'),
);

/** 编辑资料：与设置页「编辑资料」打开同一抽屉。受限账号先说明原因。 */
function openEditor(): void {
  openProfileEditor(profile, {
    blocked: () => {
      if (!limited.value) return false;
      toast(limitHint.value, 'error');
      return true;
    },
  });
}

// ── 退出登录 ──────────────────────────────────────────────────────

const logoutBusy = ref(false);

function logout(): void {
  confirmSheet({
    title: t('profile.logout'),
    message: t('app.logoutMessage'),
    confirmLabel: t('profile.logout'),
    tone: 'danger',
    onConfirm: async () => {
      logoutBusy.value = true;
      try {
        await api.auth.logout();
        session.clear();
        toast(t('profile.loggedOut'));
        await router.replace('/login');
      } catch (reason) {
        toast(errorText(reason), 'error');
      } finally {
        logoutBusy.value = false;
      }
    },
  });
}
</script>

<template>
  <!-- 访客：与旧页面一致，原位说明并给出登录入口 -->
  <StateBlock
    v-if="!loggedIn"
    icon="user"
    :title="t('profile.guestTitle')"
    :description="t('profile.guestHint')"
    :action-label="t('registration.list.goLogin')"
    @action="router.push({ path: '/login', query: { redirect: '/profile' } })"
  />

  <template v-else>
    <SkeletonBlock v-if="loading && !user.id" :rows="4" />

    <StateBlock
      v-else-if="loadFailed && !user.id"
      tone="error"
      :title="t('security.profileLoadFailed')"
      :description="loadError"
      :action-label="t('common.retry')"
      @action="load"
    />

    <template v-else>
      <!-- 已有资料时刷新失败：旧内容留在屏幕上，错误只作为附加说明 -->
      <div v-if="loadFailed" class="notice" data-tone="error">
        <span>{{ loadError }}</span>
      </div>

      <div class="profile-page" :data-busy="loading ? 'true' : undefined">
        <!-- 身份区：不是卡片（.card 只是 profile-page.test.ts 的索引钩子，
             本页 [data-plain] 把边框、底色、阴影、内距都去掉）。 -->
        <div class="card profile-leaf" data-plain="true">
          <div class="leaf-top">
            <AvatarBox
              :src="String(user.avatar || '')"
              :name="String(user.nickname || user.username || '')"
              large
              class="leaf-avatar"
            />
            <div class="leaf-copy">
              <strong class="identity-name leaf-name">{{ user.nickname || user.username }}</strong>
              <div class="leaf-meta">
                <RoleTag :role-code="String(user.role || '')" />
                <span v-if="identityLine" class="leaf-eyebrow">{{ identityLine }}</span>
              </div>
              <span v-if="membershipLine" class="leaf-expiry">{{ membershipLine }}</span>
            </div>
            <button
              class="icon-button leaf-edit"
              type="button"
              :aria-label="t('settings.profile.editProfile')"
              :disabled="limited"
              :title="limited ? limitHint : t('settings.profile.editProfile')"
              @click="openEditor"
            >
              <AppIcon name="edit" />
            </button>
          </div>
          <!-- 活动概览：分隔线之上一行数字，整行可点进我的活动；取不到数据时整块不渲染 -->
          <template v-if="activity">
            <hr class="divider" />
            <button class="profile-stats" type="button" @click="router.push(paths.registrations)">
              <span class="profile-stat">
                <strong>{{ activity.attended }}</strong>
                <span class="profile-stat-label">{{ t('profile.stats.attended') }}</span>
              </span>
              <span class="profile-stat">
                <strong>{{ activity.total }}</strong>
                <span class="profile-stat-label">{{ t('profile.stats.registrations') }}</span>
              </span>
              <AppIcon name="chevronRight" />
            </button>
          </template>
        </div>

        <!-- 受限：说明为什么编辑入口不可用 -->
        <div v-if="limited" class="notice" data-tone="warn">
          <strong>{{ limitHint }}</strong>
        </div>

        <!-- 限时展商：快到期与已到期都说明原因和续期方式，避免身份标签悄悄消失 -->
        <div v-if="membershipSoon" class="notice" data-tone="warn">
          <span>{{ membershipSoon }}</span>
        </div>
        <div v-if="membershipExpired" class="notice" data-tone="warn">
          <span>{{ membershipExpired }}</span>
        </div>

        <!-- 个人简介：组标题在上，正文按 1.68 行高排，保留用户输入的换行 -->
        <div class="card profile-block" data-plain="true">
          <span class="section-label">{{ t('profile.bio') }}</span>
          <p v-if="hasBio" class="bio-text">{{ String(profile.bio) }}</p>
          <div v-else class="bio-empty">
            <p class="field-hint">{{ t('profile.bioEmpty') }}</p>
            <button
              class="text-action bio-fill"
              type="button"
              :disabled="limited"
              :title="limited ? limitHint : undefined"
              @click="openEditor"
            >
              {{ t('profile.bioEmptyAction') }}
            </button>
          </div>
        </div>

        <!-- 公开资料：两列 label / value，空值用 --ink-3 -->
        <div class="card profile-block" data-plain="true">
          <span class="section-label">{{ t('profile.public.details') }}</span>
          <dl class="profile-facts">
            <dt>{{ t('settings.profile.region') }}</dt>
            <dd :class="hasProfileValue('region') ? undefined : 'dim'">
              {{ profileValue('region', 'profile.notFilled') }}
            </dd>
            <dt>{{ t('settings.profile.social') }}</dt>
            <dd :class="hasProfileValue('socialMedia') ? undefined : 'dim'">
              {{ profileValue('socialMedia', 'profile.notFilled') }}
            </dd>
          </dl>
        </div>

        <!-- 入口：公开主页、用户设置、安全设置各自一行，行间距 --s2 -->
        <div class="list" data-gap="sm">
          <button
            v-if="publicPath"
            class="row-card"
            type="button"
            data-pressable="true"
            @click="router.push(publicPath)"
          >
            <span class="row-icon" aria-hidden="true"><AppIcon name="user" /></span>
            <span class="row-copy">
              <strong class="row-title">{{ t('profile.previewPublic') }}</strong>
              <span class="row-meta">{{ publicMeta }}</span>
            </span>
            <span class="row-chev" aria-hidden="true"><AppIcon name="chevronRight" /></span>
          </button>
          <button class="row-card" type="button" data-pressable="true" @click="router.push('/settings')">
            <span class="row-icon" aria-hidden="true"><AppIcon name="settings" /></span>
            <span class="row-copy">
              <strong class="row-title">{{ t('settings.title') }}</strong>
              <span class="row-meta">{{ COPY.settingsMeta }}</span>
            </span>
            <span class="row-chev" aria-hidden="true"><AppIcon name="chevronRight" /></span>
          </button>
          <button class="row-card" type="button" data-pressable="true" @click="router.push('/security')">
            <span class="row-icon" aria-hidden="true"><AppIcon name="shield" /></span>
            <span class="row-copy">
              <strong class="row-title">{{ t('security.title') }}</strong>
              <span class="row-meta">{{ t('settings.securityMeta') }}</span>
            </span>
            <span class="row-chev" aria-hidden="true"><AppIcon name="chevronRight" /></span>
          </button>
        </div>

        <!-- 退出登录：整页唯一的破坏性动作，居中文字按钮，上方留 --s7 -->
        <div class="profile-logout">
          <button class="text-action logout-action" type="button" :disabled="logoutBusy" @click="logout">
            {{ t('profile.logout') }}
          </button>
        </div>
      </div>
    </template>
  </template>
</template>

<style>
/* 页面纵向节奏：区块之间 --s5。 */
.profile-page {
  display: flex;
  flex-direction: column;
  gap: var(--s5);
}

.profile-page > * {
  flex: none;
}

/* 身份 / 简介 / 公开资料三块保留 .card 类（测试索引），视觉上去掉卡片外观。 */
.profile-page .card[data-plain='true'] {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

/* 身份区：底边一条发丝线收口。 */
.profile-page .card.profile-leaf[data-plain='true'] {
  gap: var(--s3);
  padding-bottom: var(--s5);
  border-bottom: var(--hairline) solid var(--stroke);
}

.leaf-top {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--s3);
  min-width: 0;
}

/* 96px 圆头像：圆环由 .avatar 自带的 1px --stroke 描边提供。 */
.profile-page .leaf-avatar {
  width: 96px;
  height: 96px;
  font-size: var(--fs-h1);
}

.leaf-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  padding-top: var(--s1);
  /* 给右上角的铅笔让位，长昵称不会钻到按钮下面。 */
  padding-inline-end: var(--touch);
}

/* 昵称：整页最大字号，只有字重和字号，不换字体。 */
.profile-page .leaf-name {
  font-size: var(--fs-h1);
  font-weight: 700;
}

.leaf-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

/* 角色与账号状态：一行小字距标签，不抢昵称。 */
.leaf-eyebrow {
  color: var(--ink-3);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: 0.06em;
}

/* 展商有效期：一行弱化说明。 */
.leaf-expiry {
  color: var(--ink-3);
  font-size: var(--fs-label);
}

.leaf-edit {
  position: absolute;
  top: 0;
  inset-inline-end: 0;
  color: var(--ink-2);
}

/* 活动概览：两个数字（--fs-h2、700）配下面小标签，右端静默箭头由令牌给。 */
.profile-page .profile-stats {
  gap: var(--s7);
}

.profile-page .profile-stat > strong {
  font-size: var(--fs-h2);
  font-weight: 700;
}

.profile-stat-label {
  color: var(--ink-3);
  font-size: var(--fs-label);
}

/* 简介与公开资料：组标题 + 内容。 */
.profile-page .profile-block {
  gap: var(--s3);
}

.bio-text {
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: 1.68;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* 简介空态：一句说明 + 一个可点的入口，不占正文的位置。 */
.bio-empty {
  display: grid;
  gap: var(--s1);
  justify-items: start;
}

.profile-page .bio-fill {
  min-height: var(--touch);
  padding-inline: 0;
}

.profile-page .bio-fill[disabled] {
  color: var(--ink-3);
  cursor: not-allowed;
}

/* 公开资料：两列 label / value。 */
.profile-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--s4);
  row-gap: var(--s3);
  margin: 0;
}

.profile-facts dt {
  color: var(--ink-3);
  font-size: var(--fs-label);
  font-weight: 700;
}

.profile-facts dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-facts dd.dim {
  color: var(--ink-3);
}

/* 入口行左侧的静默图标与右侧箭头。 */
.row-icon,
.row-chev {
  flex: none;
  display: inline-flex;
  color: var(--ink-3);
}

/* 退出登录：居中 danger 文字按钮；父级 gap 之外再补到 --s7。 */
.profile-logout {
  display: flex;
  justify-content: center;
  margin-top: calc(var(--s7) - var(--s5));
}

.profile-page .logout-action {
  min-height: var(--touch);
  padding-inline: var(--s5);
  color: var(--danger-ink);
}
</style>
