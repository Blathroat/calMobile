<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（身份卡 + 资料展示 + 设置入口）
 * 旧实现：app/src/main/assets/web/js/pages/profile.js（`git show 5e3d9ab^`）
 *
 * 这一屏回答「我是谁、我公开了什么」。头像卡片下方展示地区；简介标题右侧的铅笔
 * 打开与用户设置相同的编辑资料抽屉（`services/profile-editor.ts`）。
 * 头像裁剪、通知、配色、明暗、隐私开关与安全入口仍在 `UserSettingsPage.vue`，
 * 入口有两个：顶栏右侧的设置图标（路由 meta 的 `topAction`）与这一屏的设置卡片。
 *
 * 退出登录仍走 `POST /auth/logout`，一次调用清掉服务端与本地会话。
 */
import { computed, onMounted, reactive, ref } from 'vue';
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
  /** 简介下方社交账号行的前缀，与后面的内容同一字重。 */
  socialPrefix: t('profile.socialPrefix'),
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
async function load(): Promise<void> {
  await bootApp().catch(() => undefined);
  loading.value = true;
  try {
    const result = await api.profile.get();
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
    message: t('profile.guestHint'),
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
    <SkeletonBlock v-if="loading" :rows="4" />

    <StateBlock
      v-else-if="loadFailed"
      tone="error"
      :title="t('security.profileLoadFailed')"
      :description="loadError"
      :action-label="t('common.retry')"
      @action="load"
    />

    <template v-else>
      <!-- 身份卡：头像、昵称、角色/状态，以及地区（地区的空态与简介区原来的空态一致） -->
      <div class="card">
        <div class="row" data-gap="md">
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
          <span class="row-copy">
            <span class="name-line">
              <strong class="row-title">{{ user.nickname || user.username }}</strong>
              <RoleTag :role-code="String(user.role || '')" />
            </span>
            <span class="row-meta">{{ identityMeta() }}</span>
            <span class="row-meta truncate">{{ profileValue('region', 'profile.notFilled') }}</span>
          </span>
        </div>
      </div>

      <!-- 简介与社交账号。地区已上收到身份卡；铅笔打开与设置页相同的编辑资料抽屉。 -->
      <div class="card">
        <div class="row">
          <span class="section-label">{{ t('profile.bio') }}</span>
          <button
            class="icon-button"
            data-inline="true"
            type="button"
            :aria-label="t('settings.profile.editProfile')"
            :disabled="limited"
            :title="limited ? limitHint : t('settings.profile.editProfile')"
            @click="openEditor"
          >
            <AppIcon name="edit" />
          </button>
        </div>
        <p class="row-meta">
          {{ profileValue('bio', 'profile.bioEmpty') }}<br /><br />{{ COPY.socialPrefix
          }}{{ profileValue('socialMedia', 'profile.notFilled') }}
        </p>
      </div>

      <!-- 设置入口：与顶栏右侧的设置图标进同一页（头像、通知、隐私、安全都在那里） -->
      <div class="card">
        <span class="section-label">{{ t('settings.title') }}</span>
        <button class="row-card" type="button" data-pressable="true" @click="router.push('/settings')">
          <span class="dim" aria-hidden="true"><AppIcon name="settings" size="icon icon-sm" /></span>
          <span class="row-copy">
            <strong class="row-title">{{ t('settings.title') }}</strong>
            <span class="row-meta">{{ COPY.settingsMeta }}</span>
          </span>
          <AppIcon name="chevronRight" />
        </button>
      </div>

      <!-- 退出登录：整页唯一的破坏性动作，放在最底部并走二次确认 -->
      <button class="cta ghost" type="button" :disabled="logoutBusy" @click="logout">
        {{ t('profile.logout') }}
      </button>
    </template>
  </template>
</template>
