<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（身份卡 + 活动概览 + 简介 + 公开资料 + 入口）
 * 严格保留三枚 .card 索引钩子与三枚 button.row-card 契约。
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
  settingsMeta: t('profile.settingsSummary'),
};

const router = useRouter();
const session = useSessionStore();

const user = computed(() => session.user);
const loggedIn = computed(() => session.loggedIn);
const limited = computed(() => user.value.can?.profile === false);
const limitHint = computed(() => t('profile.restricted'));

const profile = reactive<JsonObject>({});
const loading = ref(true);
const loadFailed = ref(false);
const loadError = ref('');
const activity = ref<{ attended: number; total: number } | null>(null);

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('exhibition.form.saveFailed');
}

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
    // 增强信息失败保持隐藏
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

const identityLine = computed(() => {
  const code = String(user.value.role || '');
  const role = roleLabel(code);
  const statusCode = String(user.value.statusCode || '');
  const status =
    statusCode === USER_STATUS.RESTRICTED || statusCode === USER_STATUS.BANNED ? userStatusLabel(statusCode) : '';
  const tagged = code === 'exhibitor' || code === 'admin';
  if (tagged) return status;
  if (!status) return role;
  return role ? `${role}  ${status}` : status;
});

const membershipLine = computed(() => {
  if (String(user.value.role || '') !== 'exhibitor') return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? t('profile.membership.until', { date }) : '';
});

const membershipSoon = computed(() => {
  if (String(user.value.role || '') !== 'exhibitor') return '';
  const days = daysUntil(user.value.exhibitorExpiresAt);
  if (days === null || days > 7) return '';
  return t('profile.membership.soon', { days });
});

const membershipExpired = computed(() => {
  if (user.value.exhibitorExpired !== true) return '';
  const date = formatLocalChineseDate(user.value.exhibitorExpiresAt);
  return date ? t('profile.membership.expired', { date }) : '';
});

function hasProfileValue(key: string): boolean {
  const value = profile[key];
  return typeof value === 'string' && value !== '';
}

function profileValue(key: string, emptyKey: string): string {
  return hasProfileValue(key) ? String(profile[key]) : t(emptyKey);
}

const hasBio = computed(() => hasProfileValue('bio'));

const publicPath = computed(() => {
  const nickname = String(user.value.nickname || user.value.username || '');
  if (!nickname) return '';
  const id = String(user.value.id || '');
  const query = id ? '?userId=' + encodeURIComponent(id) : '';
  return '/user-public/' + encodeURIComponent(nickname) + query;
});

const publicMeta = computed(() =>
  profile.showRegistrations === true ? t('profile.publicRegistrationsShown') : t('profile.publicRegistrationsHidden'),
);

function openEditor(): void {
  openProfileEditor(profile, {
    blocked: () => {
      if (!limited.value) return false;
      toast(limitHint.value, 'error');
      return true;
    },
  });
}

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
      <div v-if="loadFailed" class="notice" data-tone="error">
        <span>{{ loadError }}</span>
      </div>

      <div class="profile-page" :data-busy="loading ? 'true' : undefined">
        <!-- 身份区（cards()[0]） -->
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
              data-variant="outlined"
              type="button"
              :aria-label="t('settings.profile.editProfile')"
              :disabled="limited"
              :title="limited ? limitHint : t('settings.profile.editProfile')"
              @click="openEditor"
            >
              <AppIcon name="edit" />
            </button>
          </div>
          <template v-if="activity">
            <button class="profile-stats profile-stats-bar" type="button" @click="router.push(paths.registrations)">
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

        <div v-if="limited" class="notice" data-tone="warn">
          <strong>{{ limitHint }}</strong>
        </div>

        <div v-if="membershipSoon" class="notice" data-tone="warn">
          <span>{{ membershipSoon }}</span>
        </div>
        <div v-if="membershipExpired" class="notice" data-tone="warn">
          <span>{{ membershipExpired }}</span>
        </div>

        <!-- 个人简介（cards()[1]） -->
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

        <!-- 公开资料（cards()[2]） -->
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

        <!-- 入口行 -->
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
.profile-page {
  display: flex;
  flex-direction: column;
  gap: var(--s5);
}

.profile-page > * {
  flex: none;
}

.profile-page .card[data-plain='true'] {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.profile-page .card.profile-leaf[data-plain='true'] {
  gap: var(--s4);
  padding-bottom: var(--s5);
  border-bottom: var(--hairline) solid var(--stroke);
}

.leaf-top {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--s4);
  min-width: 0;
}

.profile-page .leaf-avatar {
  width: 64px;
  height: 64px;
  font-size: var(--fs-lg);
}

.leaf-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-inline-end: 40px;
}

.profile-page .leaf-name {
  font-size: var(--fs-lg);
  font-weight: 600;
}

.leaf-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

.leaf-eyebrow {
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.leaf-expiry {
  color: var(--ink-3);
  font-size: var(--fs-xs);
}

.leaf-edit {
  position: absolute;
  top: 2px;
  inset-inline-end: 0;
  color: var(--ink-2);
}

.profile-page .profile-stats-bar {
  gap: var(--s7);
  padding: var(--s3) var(--s4);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
}

.profile-page .profile-stat > strong {
  font-size: var(--fs-lg);
  font-weight: 600;
}

.profile-stat-label {
  color: var(--ink-2);
  font-size: var(--fs-xs);
}

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

.profile-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--s5);
  row-gap: var(--s3);
  margin: 0;
}

.profile-facts dt {
  color: var(--ink-3);
  font-size: var(--fs-label);
  font-weight: 680;
}

.profile-facts dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--fs-body);
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-facts dd.dim {
  color: var(--ink-3);
  font-weight: 400;
}

.row-icon {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
  color: var(--ink-2);
}

.row-chev {
  flex: none;
  display: inline-flex;
  color: var(--ink-3);
}

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
