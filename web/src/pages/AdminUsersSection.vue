<script setup lang="ts">
/**
 * 管理后台「用户」分区。
 *
 * 纯展示 + 事件回抛：状态、取数、防抖与导航都留在 AdminPage。
 * 根节点保持多根 fragment，条件与原顺序不变，不额外包一层元素。
 */
import AppIcon from '@/components/AppIcon.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import RoleTag from '@/components/RoleTag.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatLocalChineseDate, truncate } from '@/services/format';
import { openSheet } from '@/services/sheet';
import { statusTone, userStatusLabel } from '@/services/status';
import { useBootstrapStore } from '@/stores/bootstrap';
import { computed, type Ref } from 'vue';
import type { User } from '@/api/types';
import { t } from '@/i18n';

const props = defineProps<{
  users: { data: Ref<User[] | undefined>; error: Ref<Error | undefined>; loading: Ref<boolean> };
  userItems: User[];
  query: string;
  /** 当前身份筛选值：user / exhibitor / admin，空串表示「全部」。 */
  roleFilter: string;
  /** 当前账号状态筛选值：active / limited / banned，空串表示「全部」。 */
  statusFilter: string;
  copy: { adjustStatus: string; adjustRole: string; manageExhibitions: string; manageMeetings: string };
}>();
const emit = defineEmits<{
  retry: [];
  search: [value: string];
  'change-role': [value: string];
  'change-status': [value: string];
  'open-public': [user: User];
  manage: [user: User];
  'adjust-role': [user: User];
  'disable-two-factor': [user: User];
  'open-exhibitions': [user: User];
  'open-meetings': [user: User];
}>();

interface FilterItem {
  value: string;
  label: string;
}

/**
 * 身份 / 状态筛选项：值沿用协议 code，空串是「全部」（父组件不会把它发给服务端）。
 * 「普通用户」比权限面板里的「用户」更明确；状态文案与卡片右侧的标签保持一致。
 */
const ROLE_FILTER_ITEMS: FilterItem[] = [
  { value: '', label: t('admin.users.filterAll') },
  { value: 'user', label: t('admin.users.filterRoleUser') },
  { value: 'exhibitor', label: t('admin.users.filterRoleExhibitor') },
  { value: 'admin', label: t('admin.users.filterRoleAdmin') },
];
const STATUS_FILTER_ITEMS: FilterItem[] = [
  { value: '', label: t('admin.users.filterAll') },
  { value: 'active', label: t('admin.users.filterStatusActive') },
  { value: 'limited', label: t('admin.users.filterStatusLimited') },
  { value: 'banned', label: t('admin.users.filterStatusBanned') },
];

/** 选择栏上显示的当前值文案：值为空串时是「全部」。 */
function filterLabel(items: readonly FilterItem[], value: string): string {
  return items.find((item) => item.value === value)?.label ?? items[0]!.label;
}

const roleFilterLabel = computed(() => filterLabel(ROLE_FILTER_ITEMS, props.roleFilter));
const statusFilterLabel = computed(() => filterLabel(STATUS_FILTER_ITEMS, props.statusFilter));

/**
 * 打开筛选抽屉：与编辑展会页选分类同一套画法（带对勾的列表，点一项即收起）。
 * 只有换了一项才回抛，和原来分段控件的行为一致；取数与地址栏仍留在 AdminPage。
 */
function openFilterSheet(
  title: string,
  items: readonly FilterItem[],
  current: string,
  onPick: (value: string) => void,
): void {
  openSheet({
    title,
    layout: 'list',
    actions: items.map((item) => ({
      label: item.label,
      checked: item.value === current,
      onClick: (close: () => void) => {
        close();
        if (item.value !== current) onPick(item.value);
      },
    })),
  });
}

function openRoleSheet(): void {
  openFilterSheet(t('admin.users.filterRole'), ROLE_FILTER_ITEMS, props.roleFilter, (value) =>
    emit('change-role', value),
  );
}

function openStatusSheet(): void {
  openFilterSheet(t('admin.users.filterStatus'), STATUS_FILTER_ITEMS, props.statusFilter, (value) =>
    emit('change-status', value),
  );
}

/** 是否有筛选生效：空态文案据此区分「本来就没有用户」和「被筛掉了」。 */
const filtersActive = computed(() => props.roleFilter !== '' || props.statusFilter !== '');

/**
 * 列表为空时的标题：关键字与筛选同时生效时说明两者共同作用的结果，
 * 不能复用「没有找到与某关键字匹配的用户」——那时用户可能压根没搜过。
 */
const emptyTitle = computed(() => {
  if (props.query) {
    return filtersActive.value
      ? t('admin.users.noMatchFiltered', { query: props.query })
      : t('admin.users.noMatch', { query: props.query });
  }
  return filtersActive.value ? t('admin.users.noFilterMatch') : t('admin.users.empty');
});

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
    <!-- 身份与状态排成一行：借用编辑展会页「活动分类」的下划线选择栏，
         点开是带对勾的列表抽屉；变化只回抛，地址栏与取数留在 AdminPage。 -->
    <div class="user-filter-row">
      <div class="field">
        <span id="admin-user-role-label" class="field-label">{{ t('admin.users.filterRole') }}</span>
        <button
          id="admin-user-role-filter"
          class="input input-line filter-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-labelledby="admin-user-role-label"
          @click="openRoleSheet"
        >
          <span class="filter-value">{{ roleFilterLabel }}</span>
          <AppIcon name="chevronDown" size="icon icon-sm" />
        </button>
      </div>
      <div class="field">
        <span id="admin-user-status-label" class="field-label">{{ t('admin.users.filterStatus') }}</span>
        <button
          id="admin-user-status-filter"
          class="input input-line filter-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-labelledby="admin-user-status-label"
          @click="openStatusSheet"
        >
          <span class="filter-value">{{ statusFilterLabel }}</span>
          <AppIcon name="chevronDown" size="icon icon-sm" />
        </button>
      </div>
    </div>
    <div v-if="users.error.value" class="notice" data-tone="accent">
      <span>{{ users.error.value.message }}</span>
    </div>

    <StateBlock v-if="userItems.length === 0" :title="emptyTitle" />
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
            <span class="row-meta">{{ lastLoginMeta(user) }}</span>
            <!-- 用户协议开启时，每个账号同意到哪一版也要能看见（关闭时整行不渲染）。 -->
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

<style>
/* 身份 / 状态两个选择栏排成一行：宽屏并排、窄屏按 150px 下限自动落成两行，
   与编辑展会页的日期 / 分类选择器同一套版式（下划线触发按钮 + 右侧箭头）。 */
.user-filter-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--s4);
}

.filter-trigger {
  justify-content: space-between;
  gap: var(--s2);
  text-align: start;
}

.filter-trigger svg {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
}

.filter-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
