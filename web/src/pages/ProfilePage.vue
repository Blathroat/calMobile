<script setup lang="ts">
/**
 * 屏幕 09 · 个人主页（身份卡 + 资料展示 + 隐私开关）
 * 线框：docs/newUI/remaining-ui.html #screen-profile
 * 旧实现：app/src/main/assets/web/js/pages/profile.js（`git show 5e3d9ab^`）
 *
 * 这一屏只回答「我是谁、我公开了什么」：身份与资料是只读展示，只有一个隐私开关。
 * 账号维护（编辑资料、修改密码、通知设置、应用配色、明暗模式、安全入口）已按屏幕拆到
 * `UserSettingsPage.vue`，入口是顶栏右侧的设置图标（路由 meta 的 `topAction`，
 * 因此本页不再自己放一个设置按钮）。
 *
 * 隐私开关写入走 `PUT /profile`，其余字段原样回传：后端把整份资料当成一次覆盖，
 * 少传字段会被当成清空。受限账号（后端明确下发 `can.profile === false`）不能写，
 * 开关先置灰并说明原因，而不是等后端 403。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet } from '@/services/sheet';
import AvatarBox from '@/components/AvatarBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const router = useRouter();
const session = useSessionStore();

const user = computed(() => session.user);
const loggedIn = computed(() => session.loggedIn);
/** 受限账号：只有后端明确下发 `false` 才算，老后端不下发 `profile` 时行为不变。 */
const limited = computed(() => user.value.can?.profile === false);
/** 受限时统一用同一句说明原因，避免每个入口各写一套说法。 */
const limitHint = computed(() => t('s_1kliyri'));

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

// ── 隐私开关 ──────────────────────────────────────────────────────

const privacyBusy = ref(false);

/** 受限账号不能写资料：先拦一次，避免置灰开关被聚焦或旧缓存页面点到。 */
function guardLimited(): boolean {
  if (!limited.value) return false;
  toast(limitHint.value, 'error');
  return true;
}

/** 开关立即生效：失败时回滚界面状态，避免看起来已保存。 */
async function savePrivacy(value: boolean): Promise<void> {
  if (guardLimited()) return;
  const previous = profile.showRegistrations === true;
  profile.showRegistrations = value;
  privacyBusy.value = true;
  try {
    const saved = await api.profile.save({
      nickname: String(user.value.nickname || ''),
      bio: String(profile.bio || ''),
      region: String(profile.region || ''),
      socialMedia: String(profile.socialMedia || ''),
      avatar: String(user.value.avatar || ''),
      showRegistrations: value,
    });
    const fresh = (saved.user as JsonObject | undefined) ?? {};
    session.applyUser({ ...user.value, ...fresh });
    Object.assign(profile, fresh);
    toast(value ? t('s_92i7f7') : t('s_dn42iy'), 'success');
  } catch (reason) {
    profile.showRegistrations = previous;
    toast(errorText(reason), 'error');
  } finally {
    privacyBusy.value = false;
  }
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

      <!-- 隐私：是否在公开页展示自己的报名记录 -->
      <div class="card">
        <span class="section-label">{{ t('s_lh9gvq') }}</span>
        <div class="switch-row">
          <span class="switch-copy">
            <strong>{{ t('s_1utpn11') }}</strong>
            <span class="row-meta">{{ t('s_1wgtu4f') }}</span>
          </span>
          <label class="switch" for="privacy-registrations">
            <input
              id="privacy-registrations"
              type="checkbox"
              :checked="profile.showRegistrations === true"
              :disabled="limited || privacyBusy"
              @change="savePrivacy(($event.target as HTMLInputElement).checked)"
            >
            <span />
          </label>
        </div>
        <p class="field-hint">
          {{ limited
            ? limitHint
            : (profile.showRegistrations === true ? t('s_1kyf8ic') : t('s_413sl5')) }}
        </p>
      </div>

      <!-- 退出登录：整页唯一的破坏性动作，放在最底部并走二次确认 -->
      <button class="cta ghost" type="button" :disabled="logoutBusy" @click="logout">
        {{ t('s_12hokt7') }}
      </button>
    </template>
  </template>
</template>
