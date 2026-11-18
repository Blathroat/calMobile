<script setup lang="ts">
/**
 * 屏幕 03 · 展会详情
 *
 * 业务：展会信息 + 报名收集项 + 系统日历 + 分享。
 * 简介可能是展商编辑器产出的 HTML，也可能是 Markdown，两种格式都在渲染前过清洗入口。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { isJoinSurface, paths } from '@/app/surface';
import { useAsync } from '@/composables/useAsync';
import { usePullRefresh } from '@/services/pull-refresh';
import { tagRead, type CachedRead } from '@/services/query-cache';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { registrationLink } from '@/services/registration-link';
import { device } from '@/services/device-services';
import { loadMarkdownParser, markdownToHtml, plainText, sanitizeHtml } from '@/services/markdown';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import AppIcon from '@/components/AppIcon.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import AvatarBox from '@/components/AvatarBox.vue';
import ImageViewer from '@/components/ImageViewer.vue';
import { formatDateRange } from '@/services/format';
import { REGISTRATION_STATUS, modeLabel, roleLabel, statusTone } from '@/services/status';
import type { ExhibitionDetail, JsonObject, Registration } from '@/api/types';
import { t } from '@/i18n';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const bootstrap = useBootstrapStore();
const joinLinkMissing = t('exhibition.detail.registrationSiteMissing');
const query = useAsync<ExhibitionDetail>();

const COPY = {
  openViewer: t('exhibition.detail.viewLargeImage'),
};

const exhibition = computed(() => query.data.value?.exhibition);
const fields = computed<JsonObject[]>(() => query.data.value?.fields ?? []);
const found = computed(() => query.data.value?.found !== false);
const exhibitionId = computed(() => String(route.params.id ?? ''));

const registrations = ref<Registration[]>([]);
const calendarState = ref<{ inCalendar: boolean; granted: boolean }>({ inCalendar: false, granted: false });
const calendarBusy = ref(false);
const viewerOpen = ref(false);
const cover = computed(() => String(exhibition.value?.imageUri ?? '').trim());
let calendarRequested = false;

const description = computed(() => {
  const item = exhibition.value;
  if (!item) return { html: '', text: '' };
  const raw = String(item.description ?? '');
  if (item.descriptionFormat === 'html') {
    if (/<[a-z][\s\S]*>/i.test(raw)) return { html: sanitizeHtml(raw), text: '' };
    return { html: '', text: plainText(raw, 4000) };
  }
  return { html: markdownToHtml(raw), text: '' };
});

const canRegister = computed(() => session.user.can?.register === true);
const registerLimited = computed(() => session.loggedIn === true && session.user.can?.register === false);
const registerBlocked = computed(() => exhibition.value?.openForRegistration === false || registerLimited.value);

const myRegistration = computed<Registration | null>(() => {
  const id = exhibitionId.value;
  if (!id) return null;
  return (
    registrations.value.find(
      (record) =>
        String(record.exhibitionId ?? '') === id && String(record.statusCode ?? '') !== REGISTRATION_STATUS.CANCELLED,
    ) ?? null
  );
});

const registerLabel = computed(() => {
  if (myRegistration.value) return t('exhibition.detail.viewMyRegistration');
  if (exhibition.value?.openForRegistration === false) return t('exhibition.detail.registrationClosed');
  if (isJoinSurface && session.loggedIn !== true) return t('exhibition.detail.registerNow');
  return registerLimited.value || canRegister.value
    ? t('exhibition.detail.registerNow')
    : t('exhibition.detail.registerAfterLogin');
});

const registerDisabled = computed(() => myRegistration.value === null && registerBlocked.value);
const registerTitle = computed(() =>
  registerDisabled.value && registerLimited.value ? t('exhibition.detail.registerRestricted') : undefined,
);

function footerHint(): string {
  const item = exhibition.value;
  if (!item) return '';
  if (myRegistration.value) return t('exhibition.detail.registeredHint');
  if (item.openForRegistration === false) {
    return t('exhibition.detail.closedWithMode', { mode: modeLabel(String(item.statusCode || '')) });
  }
  if (registerLimited.value) return t('exhibition.detail.registerRestricted');
  if (isJoinSurface && session.loggedIn !== true) return t('exhibition.detail.joinTrackHint');
  return t('exhibition.detail.trackInActivities');
}

async function loadMyRegistration(): Promise<void> {
  if (session.loggedIn !== true) return;
  try {
    const records = await api.registrations.list();
    if (Array.isArray(records)) registrations.value = records;
  } catch {
    registrations.value = [];
  }
}

async function load(): Promise<void> {
  calendarRequested = false;
  const data = await query.run(() => {
    const pending = api.exhibitions.get(exhibitionId.value) as CachedRead<ExhibitionDetail>;
    return tagRead(
      pending.then(async (detail) => {
        if (detail.exhibition?.description) await loadMarkdownParser();
        return detail;
      }),
      pending.cached,
      pending.revalidating,
    );
  });
  if (data?.found === false) {
    calendarState.value = { inCalendar: false, granted: false };
    return;
  }
  if (!calendarRequested && !isJoinSurface) {
    calendarRequested = true;
    void loadCalendarState();
  }
}

async function loadCalendarState(): Promise<void> {
  const item = exhibition.value;
  if (!item) return;
  try {
    const result = await device.calendarStatus({ title: String(item.title ?? ''), date: String(item.date ?? '') });
    calendarState.value = { inCalendar: result.inCalendar === true, granted: result.granted === true };
  } catch {
    calendarState.value = { inCalendar: false, granted: false };
  }
}

async function toggleCalendar(): Promise<void> {
  const item = exhibition.value;
  if (!item) return;
  calendarBusy.value = true;
  try {
    const result = await device.toggleCalendar({
      title: String(item.title ?? ''),
      venue: String(item.venue ?? ''),
      time: String(item.time ?? ''),
      date: String(item.date ?? ''),
      description: plainText(item.description, 200),
    });
    calendarState.value = { inCalendar: result.inCalendar === true, granted: result.granted === true };
    toast(result.message || t('exhibition.detail.calendarUpdated'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    calendarBusy.value = false;
  }
}

function startRegistration(): void {
  const item = exhibition.value;
  if (!item) return;
  if (myRegistration.value) {
    void router.push(paths.registrationDetail(String(myRegistration.value.id)));
    return;
  }
  if (isJoinSurface && session.loggedIn !== true) {
    void router.push(paths.registrationForm(item.id));
    return;
  }
  if (registerLimited.value) {
    toast(t('exhibition.detail.registerRestricted'), 'error');
    return;
  }
  if (!canRegister.value) {
    toast(t('exhibition.detail.loginBeforeRegister'));
    return;
  }
  void router.push(paths.registrationForm(item.id));
}

function openExhibitorHome(): void {
  const nickname = String(exhibition.value?.exhibitor ?? '');
  if (!nickname) return;
  if (!isJoinSurface) {
    void router.push(`/user-public/${encodeURIComponent(nickname)}`);
    return;
  }
  const target = `/u/${encodeURIComponent(nickname)}`;
  if (session.loggedIn === true) void router.push(target);
  else void router.push({ path: '/login', query: { redirect: target } });
}

function share(): void {
  const item = exhibition.value;
  if (!item) return;
  const link = registrationLink(bootstrap.publicBaseUrl, item.id);
  const text = [
    String(item.title ?? ''),
    `${formatDateRange(item.date, item.endDate)} ${String(item.time ?? '')}`.trim(),
    String(item.venue ?? ''),
    link ? t('exhibition.detail.registrationLinkPrefix', { link }) : '',
  ]
    .filter(Boolean)
    .join('\n');
  openSheet({
    title: t('exhibition.detail.shareExhibition'),
    message: (link ? text : `${text}\n${joinLinkMissing}`).replace(/\n/g, '  '),
    actions: [
      { label: t('common.cancel'), onClick: (close) => close() },
      {
        label: t('exhibition.detail.share'),
        variant: 'primary',
        onClick: async (close) => {
          close();
          try {
            await device.shareText(String(item.title ?? ''), text);
          } catch (reason) {
            toast(reason instanceof Error ? reason.message : String(reason), 'error');
          }
        },
      },
    ],
  });
}

async function refreshAll(): Promise<void> {
  await Promise.all([load(), loadMyRegistration()]);
}

usePullRefresh(
  () => refreshAll(),
  computed(() => query.loading.value && query.data.value !== undefined),
);

onMounted(() => {
  void load();
  void loadMyRegistration();
});
</script>

<template>
  <Teleport defer to="#app-top-actions">
    <button
      class="icon-button"
      type="button"
      :aria-label="t('exhibition.detail.shareExhibition')"
      :title="t('exhibition.detail.shareExhibition')"
      @click="share"
    >
      <AppIcon name="share" />
    </button>
  </Teleport>

  <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="3" />

  <StateBlock
    v-else-if="query.error.value"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />

  <StateBlock
    v-else-if="!found || !exhibition"
    tone="error"
    :title="t('exhibition.detail.notFound')"
    :description="String(query.data.value?.error || t('exhibition.detail.removedByExhibitor'))"
    :action-label="t('exhibition.detail.backHome')"
    @action="router.push('/home')"
  />

  <template v-else>
    <button
      v-if="cover"
      class="hero ph-img hero-button"
      type="button"
      :aria-label="COPY.openViewer"
      @click="viewerOpen = true"
    >
      <img :src="cover" :alt="t('exhibition.detail.coverAlt', { title: String(exhibition.title ?? '') })" />
    </button>

    <div class="detail-heading">
      <div class="detail-meta-top">
        <span v-if="exhibition.category" class="eyebrow">{{ exhibition.category }}</span>
        <StatusTag
          :text="modeLabel(String(exhibition.statusCode || ''))"
          :tone="statusTone(String(exhibition.statusCode || ''))"
        />
      </div>
      <h2 class="detail-title">{{ exhibition.title }}</h2>
      <p v-if="exhibition.exhibitorNote" class="detail-subline muted">{{ exhibition.exhibitorNote }}</p>
    </div>

    <div class="card detail-spec-card">
      <div class="spec-row">
        <AppIcon name="calendar" size="icon icon-sm" />
        <span class="spec-value">{{ formatDateRange(exhibition.date, exhibition.endDate) }} {{ exhibition.time }}</span>
      </div>
      <div class="spec-row">
        <AppIcon name="mapPin" size="icon icon-sm" />
        <span class="spec-value">{{ exhibition.venue }}</span>
      </div>
    </div>

    <button
      class="row-card"
      type="button"
      data-pressable="true"
      :aria-label="t('exhibition.detail.exhibitorHomeAria', { exhibitor: String(exhibition.exhibitor ?? '') })"
      @click="openExhibitorHome"
    >
      <AvatarBox :name="String(exhibition.exhibitor || '')" />
      <span class="row-copy">
        <span class="name-line">
          <strong class="row-title truncate">{{ exhibition.exhibitor }}</strong>
          <span v-if="exhibition.exhibitorRole === 'exhibitor' || exhibition.exhibitorRole === 'admin'" class="pill">{{
            roleLabel(String(exhibition.exhibitorRole))
          }}</span>
        </span>
        <span class="row-meta">{{ t('exhibition.detail.viewExhibitorHome') }}</span>
      </span>
      <AppIcon name="chevronRight" />
    </button>

    <div class="card detail-content-card">
      <span class="section-label">{{ t('exhibition.detail.introduction') }}</span>
      <div v-if="description.html" class="rich-content" v-html="description.html" />
      <p v-else-if="description.text" class="row-meta">{{ description.text }}</p>
      <p v-else class="muted">{{ t('exhibition.detail.introductionEmpty') }}</p>
    </div>

    <div v-if="fields.length > 0" class="card detail-content-card" data-tone="fill">
      <span class="section-label">{{ t('exhibition.detail.registrationInfo') }}</span>
      <p class="row-meta">
        {{
          t('exhibition.detail.fieldsSummary', {
            count: fields.length,
            titles: fields.map((field) => String(field.title ?? '')).join('、'),
          })
        }}
      </p>
    </div>
  </template>

  <Teleport v-if="exhibition && found" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <div :class="isJoinSurface ? undefined : 'grid-cols-2'">
          <button
            v-if="!isJoinSurface"
            class="cta ghost"
            type="button"
            :disabled="calendarBusy"
            :data-loading="calendarBusy ? 'true' : 'false'"
            @click="toggleCalendar"
          >
            {{
              calendarState.inCalendar
                ? t('exhibition.detail.removeFromCalendar')
                : t('exhibition.detail.addToCalendar')
            }}
          </button>
          <button
            class="cta"
            type="button"
            :disabled="registerDisabled"
            :title="registerTitle"
            @click="startRegistration"
          >
            {{ registerLabel }}
          </button>
        </div>
        <p v-if="footerHint()" class="field-hint text-center">{{ footerHint() }}</p>
      </div>
    </div>
  </Teleport>

  <ImageViewer
    v-if="viewerOpen && exhibition && cover"
    :src="cover"
    :alt="t('exhibition.detail.coverAlt', { title: String(exhibition.title ?? '') })"
    @close="viewerOpen = false"
  />
</template>

<style>
.hero-button {
  display: block;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: zoom-in;
  appearance: none;
}
</style>

<style scoped>
.detail-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-meta-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
}

.detail-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: var(--lh-tight);
}

.detail-subline {
  font-size: var(--fs-xs);
}

.detail-spec-card {
  gap: var(--s2);
}

.spec-row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
  color: var(--ink-2);
}

.spec-value {
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 1.45;
}

.detail-content-card {
  gap: var(--s2);
}
</style>
