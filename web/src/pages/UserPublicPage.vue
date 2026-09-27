<script setup lang="ts">
/**
 * 屏幕 14 · 用户公开页
 * 线框：docs/newUI/remaining-ui.html #screen-user-public
 * 业务：展示昵称、简介、所在地区、社交账号与已参加展会。
 *
 * 普通访问者按用户的「展示我的报名」策略过滤；管理员从管理后台进入时不受该策略影响，
 * 始终能查看用户已参加的展会，页面会说明当前是管理视角，避免把「管理可见」当成公开范围。
 *
 * 取数走 `useAsync` + api 的查询缓存：从搜索列表点进来时数据已经预热过，不会先闪骨架屏。
 */
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useSessionStore } from '@/stores/session';
import AvatarBox from '@/components/AvatarBox.vue';
import MediaBox from '@/components/MediaBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatRecordDate } from '@/services/format';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const query = useAsync<JsonObject>();
const profile = computed(() => query.data.value);
const found = computed(() => profile.value?.found === true);
/** 首次结果还没回来时不画空状态：先骨架，否则首帧会闪一下错误块。 */
const settled = computed(() => query.data.value !== undefined || query.error.value !== undefined);
const adminView = computed(() => profile.value?.viewedAsAdmin === true);
/** 用户自己的「展示我的报名」策略：关掉时下方只说明「不展示」。 */
const showRegistrations = computed(() => profile.value?.showRegistrations === true);
const registrations = computed(() => asList(profile.value?.registrations));
const isOwn = computed(() => {
  const nickname = String(route.params.nickname ?? '');
  return nickname !== '' && nickname === String(session.user.nickname ?? '');
});
const visibilityLabel = computed(() => {
  if (adminView.value) return t('s_iq65l2');
  return showRegistrations.value ? t('s_q3pv0x') : t('s_ex547b');
});
const footLabel = computed(() => (isOwn.value
  ? t('s_1u66l1')
  : (adminView.value ? t('s_1m9kuky') : t('s_17zyr1e'))));

function asList(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value as JsonObject[] : [];
}

/** 用户公开页读 nickname + userId：搜索页预热用的是同一份参数，缓存键才对得上。 */
function load(): void {
  void query.run(() => api.users.publicProfile({
    nickname: String(route.params.nickname ?? ''),
    userId: String(route.query.userId ?? ''),
  }));
}

/** 底部出口随视角变化：本人回个人主页，管理员回管理后台，其它访问者回首页。 */
function leave(): void {
  void router.push(isOwn.value ? '/profile' : (adminView.value ? '/admin' : '/home'));
}

onMounted(load);
</script>

<template>
  <!-- 管理视角：管理员看得到全部已参加展会，页面明确说明，避免误解为公开范围。 -->
  <div v-if="adminView" class="notice" data-tone="accent">
    <strong>{{ t('s_1tdesxa') }}</strong>
    <span>{{ t('s_10tql41') }}</span>
  </div>

  <!-- 已有资料时刷新失败：旧资料留在屏幕上，错误只作为附加说明。 -->
  <div v-if="query.error.value && profile" class="notice" data-tone="accent">
    <span>{{ query.error.value.message }}</span>
  </div>

  <SkeletonBlock v-if="!settled" :rows="3" />
  <StateBlock
    v-else-if="!profile"
    tone="error"
    :title="t('s_kvpltc')"
    :description="query.error.value?.message"
    :action-label="t('s_lswd2v')"
    @action="load"
  />
  <!-- 用户可能已被停用或删除：说清原因并给出唯一出口，不留可点的操作。 -->
  <StateBlock
    v-else-if="!found"
    icon="user"
    :title="t('s_8wvztz')"
    :description="String(profile.error || t('s_jvqxyf'))"
    :action-label="t('s_17zyr1e')"
    @action="router.push('/home')"
  />
  <template v-else>
    <div class="card">
      <div class="row" data-gap="md">
        <AvatarBox :src="String(profile.avatar || '')" :name="String(profile.nickname || '')" />
        <span class="row-copy">
          <strong class="row-title">{{ profile.nickname }}</strong>
          <!-- 分隔用的「 · 」留在模板里而不放进文案资源：Android 的 string 资源会裁掉首尾空白。 -->
          <span class="row-meta">{{ isOwn ? `${profile.role} · ${t('s_14nrrfg')}` : profile.role }}</span>
          <span class="row-meta">{{ profile.bio || t('s_1aifth0') }}</span>
        </span>
        <StatusTag :text="visibilityLabel" :tone="adminView || showRegistrations ? 'ok' : 'muted'" />
      </div>
    </div>

    <div class="card">
      <span class="section-label">{{ t('s_wkyvc2') }}</span>
      <div class="row" data-between="true">
        <span class="row-meta">{{ t('s_11ftk7j') }}</span>
        <span class="strong truncate">{{ profile.region || t('s_c907jt') }}</span>
      </div>
      <div class="row" data-between="true">
        <span class="row-meta">{{ t('s_1hnvqec') }}</span>
        <span class="strong truncate">{{ profile.socialMedia || t('s_lltmb4') }}</span>
      </div>
    </div>

    <div class="card">
      <div class="row" data-between="true">
        <span class="section-label">{{ t('s_6osh3w') }}</span>
        <span class="pill">{{ registrations.length }} 条</span>
      </div>
      <div v-if="registrations.length > 0" class="list" data-gap="sm">
        <div v-for="record in registrations" :key="String(record.id || record.exhibitionTitle)" class="row-card">
          <MediaBox class-name="thumb thumb-cover thumb-sm" />
          <span class="row-copy">
            <strong class="row-title truncate">{{ record.exhibitionTitle }}</strong>
            <span class="row-meta">{{ formatRecordDate(record) }} · {{ record.statusLabel }}</span>
          </span>
          <StatusTag :text="String(record.statusLabel || '')" />
        </div>
      </div>
      <p v-else class="row-meta">{{ showRegistrations ? t('s_8kqs1o') : t('s_g4uu62') }}</p>
    </div>
  </template>

  <Teleport v-if="found" defer to="#app-foot">
    <div class="page-foot">
      <button class="cta ghost" type="button" @click="leave">{{ footLabel }}</button>
    </div>
  </Teleport>
</template>
