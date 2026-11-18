<script setup lang="ts">
/**
 * 屏幕 10 · 展商后台
 *
 * 顶部核销入口，卡片主体点进详情，右侧二维码分享按钮，底部三枚操作键帽。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { coverOf } from '@/services/cover';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import { copyText } from '@/services/clipboard';
import { registrationLink } from '@/services/registration-link';
import { modeLabel, statusTone } from '@/services/status';
import AppIcon from '@/components/AppIcon.vue';
import SegControl from '@/components/SegControl.vue';
import MeetingInbox from '@/components/MeetingInbox.vue';
import ShareQrSheet from '@/components/ShareQrSheet.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import MediaBox from '@/components/MediaBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import type { Exhibition } from '@/api/types';
import { t } from '@/i18n';

const router = useRouter();
const route = useRoute();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

const TABS = [
  { value: 'exhibitions', label: t('admin.exhibitions.title') },
  { value: 'meetings', label: t('registration.list.privateMeeting') },
];
const tabIds = new Set(TABS.map((item) => item.value));
const tab = ref(tabFromQuery());
const partitionLabel = t('exhibitor.sections');

function tabFromQuery(): string {
  const value = String(route.query.tab ?? '');
  return tabIds.has(value) ? value : 'exhibitions';
}

function changeTab(value: string): void {
  if (value === tab.value) return;
  void router.replace({ query: { ...route.query, tab: value } });
}

watch(
  () => route.fullPath,
  () => {
    if (route.path !== '/exhibitor') return;
    tab.value = tabFromQuery();
  },
);
const query = useAsync<Exhibition[]>();

const items = computed<Exhibition[]>(() => query.data.value ?? []);
const hasContent = computed(() => query.data.value !== undefined);
const limited = computed(() => session.user.can?.limited === true);

const registrationTotal = computed(() =>
  items.value.reduce((sum, item) => sum + (Number(item.registrationCount) || 0), 0),
);

function load(): Promise<unknown> {
  return query.run(() => api.exhibitions.list());
}

function createExhibition(): void {
  if (limited.value) {
    toast(t('exhibition.form.publishBlocked'), 'error');
    return;
  }
  void router.push('/exhibition-form');
}

function openExhibitionForm(id: unknown): void {
  if (limited.value) {
    toast(t('exhibition.form.editBlocked'), 'error');
    return;
  }
  void router.push(`/exhibition-form/${String(id)}`);
}

const joinLinkMissing = t('exhibition.detail.registrationSiteMissing');
const joinLinkCopied = t('exhibitor.registrationLinkCopied');
const joinLinkCopyFailed = t('exhibitor.copyLinkFailed');
const joinLinkCopy = t('exhibitor.copyLink');

async function copyJoinLink(id: unknown): Promise<void> {
  const link = registrationLink(bootstrap.publicBaseUrl, id);
  if (!link) {
    toast(joinLinkMissing, 'error');
    return;
  }
  if (await copyText(link)) {
    toast(joinLinkCopied);
    return;
  }
  toast(joinLinkCopyFailed, 'error');
}

function openShareQr(item: Exhibition): void {
  const link = registrationLink(bootstrap.publicBaseUrl, item.id);
  if (!link) {
    toast(joinLinkMissing, 'error');
    return;
  }
  openSheet({
    title: t('share.qrTitle'),
    component: ShareQrSheet,
    props: {
      text: link,
      title: String(item.title ?? ''),
      fileName: `exhibition-qr-${String(item.id)}.png`,
    },
  });
}

function openCheckin(): void {
  if (limited.value) {
    toast(t('exhibitor.cannotCheckin'), 'error');
    return;
  }
  void router.push('/checkin');
}

function warm(id: unknown): void {
  if (id === undefined || id === null) return;
  void api.exhibitions.get(String(id)).catch(() => undefined);
}

onMounted(() => {
  void load();
});

usePullRefresh(
  () => load(),
  computed(() => query.loading.value && hasContent.value),
  computed(() => tab.value !== 'meetings'),
);
</script>

<template>
  <SegControl :model-value="tab" :items="TABS" :label="partitionLabel" @update:model-value="changeTab" />

  <MeetingInbox v-if="tab === 'meetings'" mode="exhibitor" />

  <SkeletonBlock v-else-if="query.loading.value && !hasContent" :rows="3" />

  <StateBlock
    v-else-if="query.error.value && !hasContent"
    tone="error"
    :title="t('exhibitor.listLoadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />

  <StateBlock
    v-else-if="items.length === 0"
    icon="briefcase"
    :title="t('exhibitor.noHosted')"
    :description="limited ? t('exhibition.form.publishBlocked') : t('exhibitor.createFirstHint')"
    :action-label="limited ? '' : t('exhibition.editor.newExhibition')"
    @action="createExhibition"
  />

  <template v-else>
    <div v-if="limited" class="notice" data-tone="warn">
      <strong>{{ t('exhibition.form.publishBlocked') }}</strong>
      <span>{{ t('exhibition.form.restrictedAccount') }}</span>
    </div>

    <div v-if="query.error.value" class="notice" data-tone="accent">
      <span>{{ query.error.value.message }}</span>
    </div>

    <div class="exh-toolbar">
      <div class="row" data-gap="sm">
        <span class="section-label">{{ t('exhibitor.hostedExhibitions') }}</span>
        <span class="pill">{{
          t('exhibition.list.countLabel', { count: items.length, registrations: registrationTotal })
        }}</span>
      </div>
      <button
        class="cta exh-checkin-btn"
        data-size="small"
        type="button"
        :disabled="limited"
        :title="limited ? t('exhibitor.cannotCheckin') : undefined"
        @click="openCheckin"
      >
        <AppIcon name="qr" size="icon icon-sm" />
        {{ t('exhibitor.checkin') }}
      </button>
    </div>

    <div class="list exh-list" data-gap="sm">
      <div v-for="item in items" :key="String(item.id)" class="card exh-card">
        <div class="exh-head">
          <button
            class="exh-main"
            type="button"
            data-pressable="true"
            :aria-label="t('exhibition.list.viewAria', { title: item.title })"
            @pointerdown="warm(item.id)"
            @click="router.push(`/detail/${item.id}`)"
          >
            <MediaBox
              :src="coverOf(item.imageUri)"
              class-name="thumb thumb-cover exh-thumb"
              :alt="String(item.title || '')"
            />
            <span class="row-copy">
              <strong class="row-title exh-title">{{ item.title }}</strong>
              <span class="row-meta">{{ item.dateLabel }} {{ item.time }}</span>
              <span class="row-meta truncate">{{ item.venue }}</span>
              <StatusTag
                :text="
                  t('exhibition.list.statusWithRegistrations', {
                    status: modeLabel(String(item.statusCode ?? '')),
                    count: String(item.registrationCount ?? 0),
                  })
                "
                :tone="statusTone(String(item.statusCode || ''))"
              />
            </span>
          </button>

          <button
            class="icon-hit exh-qr"
            type="button"
            :aria-label="t('exhibitor.shareQr')"
            :title="t('exhibitor.shareQr')"
            @click="openShareQr(item)"
          >
            <AppIcon name="qr" />
          </button>
        </div>

        <div class="action-row">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            @click="router.push(`/review?exhibitionId=${encodeURIComponent(String(item.id))}`)"
          >
            {{ t('admin.exhibitions.viewRegistrations') }}
          </button>
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="limited"
            :title="limited ? t('exhibition.form.editBlocked') : undefined"
            @click="openExhibitionForm(item.id)"
          >
            {{ t('admin.exhibitions.edit') }}
          </button>
          <button class="cta ghost" data-size="small" type="button" @click="copyJoinLink(item.id)">
            {{ joinLinkCopy }}
          </button>
        </div>
      </div>
    </div>
  </template>

  <Teleport v-if="tab === 'exhibitions' && items.length > 0" to="body">
    <button
      class="round-action exh-fab"
      type="button"
      :disabled="limited"
      :aria-label="t('exhibition.editor.newExhibition')"
      :title="limited ? t('exhibition.form.publishBlocked') : t('exhibition.editor.newExhibition')"
      @click="createExhibition"
    >
      <AppIcon name="plus" />
    </button>
  </Teleport>
</template>

<style scoped>
.exh-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  flex-wrap: wrap;
}

.exh-checkin-btn {
  width: auto;
  flex: none;
  padding-inline: var(--s3);
}

.exh-list {
  padding-bottom: 56px;
}

.exh-thumb {
  height: 72px;
}

.exh-card {
  gap: var(--s3);
}

.exh-head {
  position: relative;
  min-width: 0;
}

.exh-main {
  display: flex;
  align-items: flex-start;
  gap: var(--s3);
  width: 100%;
  min-width: 0;
  padding: 0 calc(36px + var(--s2)) 0 0;
  text-align: start;
}

.exh-qr {
  position: absolute;
  inset-inline-end: 0;
  top: 0;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-input);
  background: var(--f3);
  color: var(--ink-2);
}

.exh-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.exh-fab {
  position: fixed;
  right: max(var(--s4), calc((100vw - var(--app-max)) / 2 + var(--s4)));
  bottom: calc(var(--s5) + var(--safe-bottom) + 56px);
  z-index: 30;
}

.exh-fab[disabled] {
  background: var(--f3);
  color: var(--ink-3);
  box-shadow: none;
  cursor: not-allowed;
}
</style>
