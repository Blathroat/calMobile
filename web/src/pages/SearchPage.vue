<script setup lang="ts">
/**
 * 屏幕 06 · 搜索
 * 线框：docs/newUI/remaining-ui.html #screen-search
 * 业务：GET /search 在展会与用户之间按关键词检索，响应是 `{ query, exhibitions, users, count }`。
 *
 * 输入停止 220ms 才发请求（防抖），回车立即搜。结果进 api 的查询缓存：改回上次的关键词
 * 直接出内容；重新搜索时保留旧结果、只把结果容器标记成忙碌，列表不会先闪一下空白。
 *
 * 两类结果分节展示：展会进详情页，用户进用户公开页。手指按下（`@pointerdown`）就先预热
 * 目标页的取数，点进去时数据通常已经在缓存里，省掉一次首屏等待。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import AvatarBox from '@/components/AvatarBox.vue';
import MediaBox from '@/components/MediaBox.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StateBlock from '@/components/StateBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import { truncate } from '@/services/format';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

/** 输入防抖：停手 220ms 才真正发请求，避免逐字打字打出一串请求。 */
const DEBOUNCE_MS = 220;

const route = useRoute();
const router = useRouter();

/** 深链 `?q=` 带进来的关键词；之后以输入框为准。 */
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '');
/** 真正发出去过的关键词：空结果文案要说清「和什么相关」。 */
const searched = ref('');
const query = useAsync<JsonObject>();

const results = computed(() => query.data.value);
const exhibitions = computed(() => asList(results.value?.exhibitions));
const users = computed(() => asList(results.value?.users));
const hasContent = computed(() => results.value !== undefined);
const isEmptyResult = computed(() => hasContent.value && exhibitions.value.length === 0 && users.value.length === 0);
const countLabel = computed(() => (!keyword.value.trim() || !hasContent.value
  ? t('s_1s57su3')
  : `${Number(results.value?.count) || 0} 条结果`));

let timer: number | undefined;

function asList(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value as JsonObject[] : [];
}

async function run(text: string): Promise<void> {
  if (!text) {
    // 清空输入就立刻回到「输入关键词开始搜索」（旧实现同样马上换回空状态块）。
    // 旧结果一并丢掉，否则上一次的「0 条结果」会被当成新关键词的结果先画出来。
    searched.value = '';
    query.data.value = undefined;
    query.error.value = undefined;
    return;
  }
  searched.value = text;
  // 客户端把 /search 的返回类型标成了数组，实际是 `{ query, exhibitions, users, count }`，
  // 这里按真实结构转一次（改 client.ts 的类型不在本次改动范围内）。
  await query.run(async () => (await api.search(text)) as unknown as JsonObject);
}

function onInput(): void {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    void run(keyword.value.trim());
  }, DEBOUNCE_MS);
}

function submitNow(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  void run(keyword.value.trim());
}

function retry(): void {
  void run(keyword.value.trim());
}

/** 手指按下就预取详情，点进去时数据通常已经到了。 */
function warmExhibition(id: unknown): void {
  const value = String(id ?? '');
  if (!value) return;
  void api.exhibitions.get(value).catch(() => undefined);
}

/** 用户公开页按昵称取数，预热必须用同一份参数才打得中缓存。 */
function warmUser(user: JsonObject): void {
  const nickname = String(user.nickname ?? '');
  if (!nickname) return;
  void api.users.publicProfile({ nickname, userId: String(user.id ?? '') }).catch(() => undefined);
}

function openExhibition(id: unknown): void {
  const value = String(id ?? '');
  if (!value) return;
  void router.push(`/detail/${encodeURIComponent(value)}`);
}

function openUser(user: JsonObject): void {
  const nickname = String(user.nickname ?? '');
  if (!nickname) return;
  void router.push({
    path: `/user-public/${encodeURIComponent(nickname)}`,
    query: { userId: String(user.id ?? '') },
  });
}

onMounted(() => {
  if (keyword.value.trim()) void run(keyword.value.trim());
});

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>

<template>
  <div class="field">
    <label for="search-input">{{ t('s_1sd7orv') }}</label>
    <input
      id="search-input"
      v-model="keyword"
      class="input"
      type="search"
      autocomplete="off"
      :placeholder="t('s_crhxaz')"
      :aria-label="t('s_1j51671')"
      @input="onInput"
      @keydown.enter.prevent="submitNow"
    >
  </div>

  <div class="row" data-between="true">
    <span class="section-label">{{ t('s_i8d8h8') }}</span>
    <span class="pill">{{ countLabel }}</span>
  </div>

  <!-- 已有内容时刷新失败：旧结果留在屏幕上，错误只作为附加说明，不再整块换成错误页。 -->
  <div v-if="query.error.value && hasContent" class="notice" data-tone="accent">
    <span>{{ query.error.value.message }}</span>
  </div>

  <div :data-busy="query.loading.value && hasContent ? 'true' : undefined">
    <SkeletonBlock v-if="keyword.trim() && query.loading.value && !hasContent" :rows="2" />
    <StateBlock
      v-else-if="keyword.trim() && query.error.value && !hasContent"
      tone="error"
      :title="t('s_2be1oh')"
      :description="query.error.value.message"
      :action-label="t('s_lswd2v')"
      @action="retry"
    />
    <StateBlock
      v-else-if="!keyword.trim() || !hasContent"
      icon="search"
      :title="t('s_3fklp8')"
      :description="t('s_1m0n2yt')"
    />
    <StateBlock
      v-else-if="isEmptyResult"
      icon="search"
      :title="`没有找到与“${searched}”相关的结果`"
      :description="t('s_s4kamn')"
      :action-label="t('s_17zyr1e')"
      @action="router.push('/home')"
    />
    <div v-else class="stack">
      <template v-if="exhibitions.length > 0">
        <span class="section-label">展会 · {{ exhibitions.length }}</span>
        <div class="list" data-gap="sm">
          <button
            v-for="item in exhibitions"
            :key="String(item.id)"
            class="row-card"
            type="button"
            data-pressable="true"
            @pointerdown="warmExhibition(item.id)"
            @click="openExhibition(item.id)"
          >
            <MediaBox
              :src="String(item.imageUri || '')"
              class-name="thumb thumb-sm thumb-cover"
              :alt="String(item.title || '')"
            />
            <span class="row-copy">
              <span class="row" data-gap="md">
                <strong class="row-title truncate">{{ item.title }}</strong>
                <StatusTag :text="String(item.modeLabel || item.status || '')" />
              </span>
              <span class="row-meta">{{ item.dateLabel }} {{ item.time }}</span>
              <span class="row-meta truncate">{{ item.venue }}</span>
            </span>
          </button>
        </div>
      </template>

      <template v-if="users.length > 0">
        <span class="section-label">用户 · {{ users.length }}</span>
        <div class="list" data-gap="sm">
          <button
            v-for="user in users"
            :key="String(user.id)"
            class="row-card"
            type="button"
            data-pressable="true"
            @pointerdown="warmUser(user)"
            @click="openUser(user)"
          >
            <AvatarBox :name="String(user.nickname || '')" />
            <span class="row-copy">
              <strong class="row-title">{{ user.nickname }} · {{ user.role }}</strong>
              <span class="row-meta truncate">{{ truncate(user.email, 40) }}</span>
            </span>
            <StatusTag :text="String(user.status || '')" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
