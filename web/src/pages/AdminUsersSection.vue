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
import { truncate } from '@/services/format';
import { statusTone } from '@/services/status';
import type { Ref } from 'vue';
import type { User } from '@/api/types';
import { t } from '@/i18n';

defineProps<{
  users: { data: Ref<User[] | undefined>; error: Ref<Error | undefined>; loading: Ref<boolean> };
  userItems: User[];
  query: string;
  copy: { adjustStatus: string; manageExhibitions: string; manageMeetings: string };
}>();
const emit = defineEmits<{
  retry: [];
  search: [value: string];
  'open-public': [user: User];
  manage: [user: User];
  'disable-two-factor': [user: User];
  'open-exhibitions': [user: User];
  'open-meetings': [user: User];
}>();
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
      <span class="pill">{{ `${userItems.length} 位用户` }}</span>
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
      :title="query ? `没有找到与“${query}”相关的用户` : t('admin.users.empty')"
    />
    <div v-else class="list" data-gap="sm" :data-busy="users.loading.value ? 'true' : undefined">
      <div v-for="user in userItems" :key="String(user.id)" class="card">
        <button
          class="row-card"
          type="button"
          data-pressable="true"
          style="border: 0; padding: 0; background: transparent; width: 100%"
          :aria-label="`查看 ${user.nickname} 的公开页`"
          @click="emit('open-public', user)"
        >
          <AvatarBox :name="String(user.nickname || '')" />
          <span class="row-copy">
            <span class="name-line">
              <strong class="row-title truncate">{{ user.nickname }}</strong>
              <RoleTag :role-code="String(user.roleCode || '')" />
            </span>
            <span class="row-meta">{{
              `${user.status} · 最近登录 ${user.lastLoginTime || t('admin.users.unknown')}`
            }}</span>
            <span class="row-meta truncate">{{ truncate(user.email, 40) }}</span>
            <span v-if="user.twoFactorEnabled === true" class="row-meta">{{ t('admin.users.twoFactorEnabled') }}</span>
          </span>
          <StatusTag :text="String(user.status || '')" :tone="statusTone(String(user.status || ''))" />
        </button>
        <div class="action-row">
          <button class="cta ghost" data-size="small" type="button" @click="emit('manage', user)">
            {{ copy.adjustStatus }}
          </button>
          <template v-if="user.roleCode === 'exhibitor' || user.roleCode === 'admin'">
            <button class="cta ghost" data-size="small" type="button" @click="emit('open-exhibitions', user)">
              {{ copy.manageExhibitions }}
            </button>
            <button class="cta ghost" data-size="small" type="button" @click="emit('open-meetings', user)">
              {{ copy.manageMeetings }}
            </button>
          </template>
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
