<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（身份卡 + 简介卡 + 设置与安全入口）
 * 旧实现：app/src/main/assets/web/js/pages/profile.js（`git show 5e3d9ab^`）
 *
 * 这一屏回答「我是谁、我公开了什么」。身份卡右上角的铅笔打开与用户设置相同的
 * 编辑资料抽屉（`services/profile-editor.ts`）；简介正文与社交账号各占一卡。
 * 设置与安全两个入口直接是行卡片，不再套一层卡片，避免双重边框。
 *
 * 头像裁剪、通知、配色、明暗、隐私开关与安全入口仍在 `UserSettingsPage.vue`，
 * 入口有两个：顶栏右侧的设置图标（路由 meta 的 `topAction`）与这一屏的设置行。
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

// ── 取数：本页只用到个人资料 ──────────────────────────────────────

const profile = reactive<JsonObject>({});
const loading = ref(true);
const loadFailed = ref(false);
const loadError = ref('');

/** 取数失败优先用后端/传输层自带的原因，没有就回落到通用文案。 */
function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('exhibition.form.saveFailed');
}

/**
 * 只拉个人资料：通知偏好属于设置页，放在这里拉会让本页的失败态跟着一起抖。
 *
 * 失败在原位给出错误块与重试，而不是画出空资料 —— 后端没起时页面照常渲染、
 * 每行都显示「未填写」，是最容易让人误判「加载成功」的一种假象。
 */
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

onMounted(load);

usePullRefresh(
  () => load(),
  computed(() => loading.value && Boolean(user.value.id)),
  loggedIn,
);

// ── 展示用取值 ────────────────────────────────────────────────────

function identityMeta(): string {
  const code = String(user.value.role || '');
  const role = String(user.value.roleLabel || '');
  const status = String(user.value.status || t('admin.users.normal'));
  if (code === 'exhibitor' || code === 'admin') return status;
  return role ? `${role} · ${status}` : status;
}

/** 资料字段的展示值：缺失时沿用旧页面给出的空态文案。 */
function profileValue(key: string, emptyKey: string): string {
  const value = profile[key];
  return typeof value === 'string' && value !== '' ? value : t(emptyKey);
}

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
  <!-- 访客：与旧页面一致，原位说明并给出登录入口，而不是让下面的开关显示默认值 -->
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
        <!-- 身份卡：头像、昵称、角色/状态与地区。编辑资料跟在姓名行右侧，打开同一个抽屉。 -->
        <div class="card" data-tone="fill">
          <div class="row" data-gap="md">
            <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
            <span class="row-copy">
              <span class="name-line">
                <strong class="identity-name">{{ user.nickname || user.username }}</strong>
                <RoleTag :role-code="String(user.role || '')" />
              </span>
              <span class="row-meta">{{ identityMeta() }}</span>
              <span class="row-meta truncate">{{ profileValue('region', 'profile.notFilled') }}</span>
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
        </div>

        <!-- 简介与社交账号：正文保留用户输入的换行，社交账号单独一行，不再用空行拼在一起。 -->
        <div class="card">
          <span class="section-label">{{ t('profile.bio') }}</span>
          <p class="bio-text">{{ profileValue('bio', 'profile.bioEmpty') }}</p>
          <hr class="divider" />
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('settings.profile.social') }}</span>
            <strong class="strong truncate">{{ profileValue('socialMedia', 'profile.notFilled') }}</strong>
          </div>
        </div>

        <!-- 设置与安全：独立行卡片，不再套在卡片里 -->
        <div class="list" data-gap="sm">
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

/* 简介正文：正文色与正文行高，保留用户输入的换行；空态文案也走这段样式。 */
.bio-text {
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-base);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
