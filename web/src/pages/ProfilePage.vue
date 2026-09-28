<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（身份卡 + 资料展示 + 设置入口）
 * 线框：docs/newUI/remaining-ui.html #screen-profile
 * 旧实现：app/src/main/assets/web/js/pages/profile.js（`git show 5e3d9ab^`）
 *
 * 这一屏只回答「我是谁、我公开了什么」：身份与资料是只读展示，底部给一个设置入口。
 * 账号维护（编辑资料、修改密码、通知设置、应用配色、明暗模式、**隐私开关**、安全入口）
 * 都在 `UserSettingsPage.vue`，入口有两个：顶栏右侧的设置图标（路由 meta 的 `topAction`）
 * 与这一屏的设置卡片，两者进的是同一页。
 *
 * 退出登录仍走 `POST /auth/logout`，一次调用清掉服务端与本地会话。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import AppIcon from '@/components/AppIcon.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const COPY = {
  /** 设置入口的说明：把设置页里能改的东西列出来，省得点进去才发现。 */
  settingsMeta: t('s_lcz4jf'),
};

const router = useRouter();
const session = useSessionStore();

const user = computed(() => session.user);
const loggedIn = computed(() => session.loggedIn);

// ── 取数：本页只用到个人资料 ──────────────────────────────────────

const profile = reactive<JsonObject>({});
const loading = ref(true);
const loadFailed = ref(false);
const loadError = ref('');

/** 取数失败优先用后端/传输层自带的原因，没有就回落到通用文案。 */
function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : t('s_1q9u8le');
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
  const role = String(user.value.roleLabel || '');
  const status = String(user.value.status || t('s_tt5vxa'));
  return role ? `${role} · ${status}` : status;
}

/** 资料字段的展示值：缺失时沿用旧页面给出的空态文案。 */
function profileValue(key: string, emptyKey: string): string {
  const value = profile[key];
  return typeof value === 'string' && value !== '' ? value : t(emptyKey);
}

// ── 退出登录 ──────────────────────────────────────────────────────

const logoutBusy = ref(false);

function logout(): void {
  confirmSheet({
    title: t('s_12hokt7'),
    message: t('s_1b7h1x'),
    confirmLabel: t('s_12hokt7'),
    tone: 'danger',
    onConfirm: async () => {
      logoutBusy.value = true;
      try {
        await api.auth.logout();
        session.clear();
        toast(t('s_pdyp8r'));
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
    :title="t('s_1h1rste')"
    :description="t('s_1b7h1x')"
    :action-label="t('s_533bde')"
    @action="router.push({ path: '/login', query: { redirect: '/profile' } })"
  />

  <template v-else>
    <SkeletonBlock v-if="loading" :rows="4" />

    <StateBlock
      v-else-if="loadFailed"
      tone="error"
      :title="t('s_1sz2kuw')"
      :description="loadError"
      :action-label="t('s_lswd2v')"
      @action="load"
    />

    <template v-else>
      <!-- 身份卡：只展示头像、昵称、角色/状态与邮箱；「编辑」「上传头像」都在设置页 -->
      <div class="card">
        <div class="row" data-gap="md">
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" large />
          <span class="row-copy">
            <strong class="row-title">{{ user.nickname || user.username }}</strong>
            <span class="row-meta">{{ identityMeta() }}</span>
            <span class="row-meta truncate">{{ user.email || t('s_1hhb6bo') }}</span>
          </span>
        </div>
      </div>

      <!-- 资料：简介 + 地区 + 社交账号（只展示，改资料在设置页） -->
      <div class="card">
        <span class="section-label">{{ t('s_ml9unw') }}</span>
        <p class="row-meta">{{ profileValue('bio', 's_17mtsm3') }}</p>
        <div class="stack" data-gap="sm">
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('s_11ftk7j') }}</span>
            <span class="strong truncate">{{ profileValue('region', 's_15h5nhd') }}</span>
          </div>
          <div class="row" data-between="true">
            <span class="row-meta">{{ t('s_1hnvqec') }}</span>
            <span class="strong truncate">{{ profileValue('socialMedia', 's_15h5nhd') }}</span>
          </div>
        </div>
      </div>

      <!-- 设置入口：与顶栏右侧的设置图标进同一页（编辑资料、隐私、安全都在那里） -->
      <div class="card">
        <span class="section-label">{{ t('s_1vmubx9') }}</span>
        <button class="row-card" type="button" data-pressable="true" @click="router.push('/settings')">
          <span class="dim" aria-hidden="true"><AppIcon name="settings" size="icon icon-sm" /></span>
          <span class="row-copy">
            <strong class="row-title">{{ t('s_1vmubx9') }}</strong>
            <span class="row-meta">{{ COPY.settingsMeta }}</span>
          </span>
          <AppIcon name="chevronRight" />
        </button>
      </div>

      <!-- 退出登录：整页唯一的破坏性动作，放在最底部并走二次确认 -->
      <button class="cta ghost" type="button" :disabled="logoutBusy" @click="logout">
        {{ t('s_12hokt7') }}
      </button>
    </template>
  </template>
</template>
