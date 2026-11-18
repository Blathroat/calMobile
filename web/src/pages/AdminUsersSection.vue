<script setup lang="ts">
/**
 * 管理后台「用户」分区。
 *
 * 纯展示 + 事件回抛：状态、取数、防抖与导航都留在 AdminPage。
 * 根节点保持多根 fragment，条件与原顺序不变，不额外包一层元素。
 */
import AvatarBox from '@/components/AvatarBox.vue';
import RoleTag from '@/components/RoleTag.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatLocalChineseDate, truncate } from '@/services/format';
import { statusTone, userStatusLabel } from '@/services/status';
import { useBootstrapStore } from '@/stores/bootstrap';
import { computed, type Ref } from 'vue';
import type { User } from '@/api/types';
import { t } from '@/i18n';

defineProps<{
  users: { data: Ref<User[] | undefined>; error: Ref<Error | undefined>; loading: Ref<boolean> };
  userItems: User[];
  query: string;
  copy: { adjustStatus: string; adjustRole: string; manageExhibitions: string; manageMeetings: string };
}>();
const emit = defineEmits<{
  retry: [];
  search: [value: string];
  'open-public': [user: User];
  manage: [user: User];
  'adjust-role': [user: User];
  'disable-two-factor': [user: User];
  'open-exhibitions': [user: User];
  'open-meetings': [user: User];
}>();

/** 限时展商的到期说明；永久展商与普通用户不显示这一行。 */
function exhibitorMeta(user: User): string {
  const date = formatLocalChineseDate(user.exhibitorExpiresAt);
  if (!date) return '';
  return user.exhibitorExpired === true
    ? t('admin.users.exhibitorExpired', { date })
    : t('admin.users.exhibitorUntil', { date });
}

/**
 * 「最近登录」一行：日期后面跟最近登录 IP 所属地区（如「2026-11-17 江苏省苏州市」）。
 *
 * 卡片右侧的 StatusTag 是唯一的状态显示，这里不再重复状态文字。
 * 时间缺失时退回注册时间（服务端已兜底一层，这里再兜一层，旧快照也不显示「未知」）；
 * 地区为空时只显示日期。
 */
function lastLoginMeta(user: User): string {
  const date = String(user.lastLoginTime || user.registrationTime || '') || t('admin.users.unknown');
  const region = String(user.lastLoginRegion || '');
  return t('admin.users.lastLogin', { time: region ? `${date} ${region}` : date });
}

/** 当前生效的用户协议版本；0 表示管理员没开启协议，卡片上不显示同意状态。 */
const agreementVersion = computed(() => {
  const agreement = useBootstrapStore().agreement;
  return agreement?.enabled === true ? Number(agreement.version) || 0 : 0;
});

/**
 * 用户协议同意状态：管理端要能一眼看出每个账号同意到哪一版。
 * 只有协议开启（当前版本 > 0）时才显示；关闭时这些信息对管理员没有意义。
 */
function agreementMeta(user: User): string {
  const current = agreementVersion.value;
  if (current <= 0) return '';
  const accepted = Number(user.agreedTermsVersion) || 0;
  if (accepted >= current) {
    const date = formatLocalChineseDate(user.agreedTermsAt);
    return date
      ? t('admin.users.agreementAccepted', { version: accepted, date })
      : t('admin.users.agreementAcceptedNoDate', { version: accepted });
  }
  if (accepted > 0) return t('admin.users.agreementOutdated', { version: accepted });
  return t('admin.users.agreementNever');
}
</script>

<template>
  <SkeletonBlock v-if="users.loading.value && users.data.value === undefined" :rows="3" />
  <StateBlock
    v-else-if="users.error.value && users.data.value === undefined"
    tone="error"
    :title="t('common.loadFailed')"
    :description="users.error.value.message"
    :action-label="t('common.retry')"
    @action="emit('retry')"
  />
  <template v-else>
    <div class="row" data-between="true">
      <span class="section-label">{{ t('admin.users.manage') }}</span>
      <span class="pill">{{ t('admin.users.count', { count: userItems.length }) }}</span>
    </div>
    <div class="field">
      <label for="admin-user-search">{{ t('admin.users.search') }}</label>
      <input
        id="admin-user-search"
        class="input"
        type="search"
        autocomplete="off"
        :placeholder="t('admin.users.searchPlaceholder')"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div v-if="users.error.value" class="notice" data-tone="accent">
      <span>{{ users.error.value.message }}</span>
    </div>

    <StateBlock
      v-if="userItems.length === 0"
      :title="query ? t('admin.users.noMatch', { query }) : t('admin.users.empty')"
    />
    <div v-else class="list" data-gap="sm" :data-busy="users.loading.value ? 'true' : undefined">
      <div v-for="user in userItems" :key="String(user.id)" class="card">
        <button
          class="row-card"
          type="button"
          data-pressable="true"
          :aria-label="t('admin.users.viewPublicAria', { name: String(user.nickname ?? '') })"
          @click="emit('open-public', user)"
        >
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || '')" />
          <span class="row-copy">
            <span class="name-line">
              <strong class="row-title truncate">{{ user.nickname }}</strong>
              <RoleTag :role-code="String(user.roleCode || '')" />
            </span>
            <span class="row-meta">{{ lastLoginMeta(user) }}</span>
            <span v-if="agreementMeta(user)" class="row-meta" data-agreement-status="true">{{
              agreementMeta(user)
            }}</span>
            <span v-if="exhibitorMeta(user)" class="row-meta">{{ exhibitorMeta(user) }}</span>
            <span class="row-meta truncate">{{ truncate(user.email, 40) }}</span>
            <span v-if="user.twoFactorEnabled === true" class="row-meta">{{ t('admin.users.twoFactorEnabled') }}</span>
          </span>
          <StatusTag
            :text="userStatusLabel(String(user.statusCode || ''))"
            :tone="statusTone(String(user.statusCode || ''))"
          />
        </button>
        <div class="action-row" style="flex-wrap: wrap">
          <template v-if="user.roleCode === 'exhibitor' || user.roleCode === 'admin' || user.exhibitorExpired === true">
            <button class="cta ghost" data-size="small" type="button" @click="emit('open-exhibitions', user)">
              {{ copy.manageExhibitions }}
            </button>
            <button class="cta ghost" data-size="small" type="button" @click="emit('open-meetings', user)">
              {{ copy.manageMeetings }}
            </button>
            <button class="cta ghost" data-size="small" type="button" @click="emit('manage', user)">
              {{ copy.adjustStatus }}
            </button>
          </template>
          <button v-else class="cta ghost" data-size="small" type="button" @click="emit('manage', user)">
            {{ copy.adjustStatus }}
          </button>
          <button class="cta ghost" data-size="small" type="button" @click="emit('adjust-role', user)">
            {{ copy.adjustRole }}
          </button>
          <button
            v-if="user.twoFactorEnabled === true"
            class="cta ghost"
            data-size="small"
            type="button"
            @click="emit('disable-two-factor', user)"
          >
            {{ t('admin.users.disableTwoFactor') }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
