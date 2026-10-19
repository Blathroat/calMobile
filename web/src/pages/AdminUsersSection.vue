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
import { statusTone } from '@/services/status';
import type { Ref } from 'vue';
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
          style="border: 0; padding: 0; background: transparent; width: 100%"
          :aria-label="t('admin.users.viewPublicAria', { name: String(user.nickname ?? '') })"
          @click="emit('open-public', user)"
        >
          <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || '')" />
          <span class="row-copy">
            <span class="name-line">
              <strong class="row-title truncate">{{ user.nickname }}</strong>
              <RoleTag :role-code="String(user.roleCode || '')" />
            </span>
            <span class="row-meta">{{
              t('admin.users.lastLogin', {
                status: String(user.status),
                time: String(user.lastLoginTime || t('admin.users.unknown')),
              })
            }}</span>
            <span v-if="exhibitorMeta(user)" class="row-meta">{{ exhibitorMeta(user) }}</span>
            <span class="row-meta truncate">{{ truncate(user.email, 40) }}</span>
            <span v-if="user.twoFactorEnabled === true" class="row-meta">{{ t('admin.users.twoFactorEnabled') }}</span>
          </span>
          <StatusTag :text="String(user.status || '')" :tone="statusTone(String(user.status || ''))" />
        </button>
        <div class="action-row">
          <!-- 到期的展商已降为普通用户，但他们的展会/会议还在，管理员仍要能从卡片接管 -->
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
        </div>
        <!-- 兜底出口：用户邮箱用不了（离职、邮箱被回收）时，只有管理员能帮他关掉两步验证 -->
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
  </template>
</template>
