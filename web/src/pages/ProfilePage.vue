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
import { REGISTRATION_STATUS } from '@/services/status';
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
      attended: records.filter((record) => record.status === REGISTRATION_STATUS.ATTENDED).length,
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
  const code = String(user.value.role || '');
  const role = String(user.value.roleLabel || '');
  const status = String(user.value.status || '');
  const statusCode = String(user.value.statusCode || '');
  const normal = statusCode === 'active' || status === t('admin.users.normal');
  const tagged = code === 'exhibitor' || code === 'admin';
  if (normal) return tagged ? '' : role;
  if (tagged) return status;
  return role && status ? role + ' · ' + status : role || status;
});

// ── 展商时长：限时展商看到到期日，到期后说明原因与续期入口 ──

/** 限时展商身份卡里的一行：有效期至某日。 */
const membershipLine = computed(() => {
  if (String(user.value.role || '') !== 'exhibitor') return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? `${t('profile.membership.until')}${date}` : '';
});

/** 7 天内到期的提醒：说明还能用多久、可以续期。 */
const membershipSoon = computed(() => {
  if (String(user.value.role || '') !== 'exhibitor') return '';
  const days = daysUntil(user.value.exhibitorExpiresAt);
  if (days === null || days > 7) return '';
  return `${t('profile.membership.soon')}${days}${t('profile.membership.soonTail')}`;
});

/** 已经自动到期的账号：说明原因与续期方式（管理员手动降级会清掉到期时间，不会走到这里）。 */
const membershipExpired = computed(() => {
  if (user.value.exhibitorExpired !== true) return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? `${t('profile.membership.expired')}${date}${t('profile.membership.expiredHint')}` : '';
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
      <div v-if="loadFailed" class="notice" data-tone="accent">
        <span>{{ loadError }}</span>
      </div>
      <div class="profile-stack" :data-busy="loading ? 'true' : undefined">
        <!-- 身份卡：头像、昵称、角色与账号状态；底部是活动概览。 -->
        <div class="card" data-tone="fill">
          <div class="row" data-gap="md">
            <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
            <span class="row-copy">
              <span class="name-line">
                <strong class="identity-name">{{ user.nickname || user.username }}</strong>
                <RoleTag :role-code="String(user.role || '')" />
              </span>
              <span v-if="identityLine" class="row-meta">{{ identityLine }}</span>
              <span v-if="membershipLine" class="row-meta">{{ membershipLine }}</span>
            </span>
            <button
              class="icon-button"
              type="button"
              :aria-label="t('settings.profile.editProfile')"
              :disabled="limited"
              :title="limited ? limitHint : t('settings.profile.editProfile')"
              @click="openEditor"
            >
              <AppIcon name="edit" />
            </button>
          </div>
          <!-- 活动概览：整行可点，进入我的活动；取不到数据时整块不渲染 -->
          <template v-if="activity">
            <hr class="divider" />
            <button class="profile-stats" type="button" @click="router.push(paths.registrations)">
              <span class="profile-stat">
                <strong>{{ activity.attended }}</strong>
                <span class="row-meta">{{ t('profile.stats.attended') }}</span>
              </span>
              <span class="profile-stat">
                <strong>{{ activity.total }}</strong>
                <span class="row-meta">{{ t('profile.stats.registrations') }}</span>
              </span>
              <AppIcon name="chevronRight" />
            </button>
          </template>
        </div>

        <!-- 受限：说明为什么编辑入口不可用 -->
        <div v-if="limited" class="notice" data-tone="accent">
          <strong>{{ limitHint }}</strong>
        </div>

        <!-- 限时展商：快到期与已到期都说明原因和续期方式，避免身份标签悄悄消失 -->
        <div v-if="membershipSoon" class="notice" data-tone="accent">
          <span>{{ membershipSoon }}</span>
        </div>
        <div v-if="membershipExpired" class="notice" data-tone="accent">
          <span>{{ membershipExpired }}</span>
        </div>

        <!-- 个人简介：有内容时按正文排版，空态给出可点的「填写简介」 -->
        <div class="card">
          <span class="section-label">{{ t('profile.bio') }}</span>
          <p v-if="hasBio" class="bio-text">{{ String(profile.bio) }}</p>
          <div v-else class="bio-empty">
            <p class="field-hint">{{ t('profile.bioEmpty') }}</p>
            <button
              class="text-action"
              type="button"
              :disabled="limited"
              :title="limited ? limitHint : undefined"
              @click="openEditor"
            >
              {{ t('profile.bioEmptyAction') }}
            </button>
          </div>
        </div>

        <!-- 公开资料：地区与社交账号都是「标签 + 值」，空值弱化显示 -->
        <div class="card">
          <span class="section-label">{{ t('profile.public.details') }}</span>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('settings.profile.region') }}</span>
            <strong class="truncate" :class="hasProfileValue('region') ? 'strong' : 'dim'">{{
              profileValue('region', 'profile.notFilled')
            }}</strong>
          </div>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('settings.profile.social') }}</span>
            <strong class="truncate" :class="hasProfileValue('socialMedia') ? 'strong' : 'dim'">{{
              profileValue('socialMedia', 'profile.notFilled')
            }}</strong>
          </div>
        </div>

        <!-- 入口：公开主页、用户设置、安全设置各自一行，不套卡片 -->
        <div class="list" data-gap="sm">
          <button
            v-if="publicPath"
            class="row-card"
            type="button"
            data-pressable="true"
            @click="router.push(publicPath)"
          >
            <span class="dim" aria-hidden="true"><AppIcon name="user" size="icon icon-sm" /></span>
            <span class="row-copy">
              <strong class="row-title">{{ t('profile.previewPublic') }}</strong>
              <span class="row-meta">{{ publicMeta }}</span>
            </span>
            <AppIcon name="chevronRight" />
          </button>
          <button class="row-card" type="button" data-pressable="true" @click="router.push('/settings')">
            <span class="dim" aria-hidden="true"><AppIcon name="settings" size="icon icon-sm" /></span>
            <span class="row-copy">
              <strong class="row-title">{{ t('settings.title') }}</strong>
              <span class="row-meta">{{ COPY.settingsMeta }}</span>
            </span>
            <AppIcon name="chevronRight" />
          </button>
          <button class="row-card" type="button" data-pressable="true" @click="router.push('/security')">
            <span class="dim" aria-hidden="true"><AppIcon name="shield" size="icon icon-sm" /></span>
            <span class="row-copy">
              <strong class="row-title">{{ t('security.title') }}</strong>
              <span class="row-meta">{{ t('settings.securityMeta') }}</span>
            </span>
            <AppIcon name="chevronRight" />
          </button>
        </div>

        <!-- 退出登录：整页唯一的破坏性动作，放在最底部并走二次确认 -->
        <button class="cta ghost" type="button" :disabled="logoutBusy" @click="logout">
          {{ t('profile.logout') }}
        </button>
      </div>
    </template>
  </template>
</template>

<style>
/* 外壳只给 .page-surface 的直接子元素留间距。忙碌标记需要包一层，间距在这一层补回。 */
.profile-stack {
  display: flex;
  flex-direction: column;
  gap: var(--s5);
}

.profile-stack > * {
  flex: none;
}

/* 简介正文：正文色与正文行高，保留用户输入的换行。 */
.bio-text {
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-base);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* 简介空态：一句说明 + 一个可点的入口，不占用正文的位置。 */
.bio-empty {
  display: grid;
  gap: var(--s1);
  justify-items: start;
}

.bio-empty .text-action[disabled] {
  color: var(--ink-3);
  cursor: not-allowed;
}
</style>
