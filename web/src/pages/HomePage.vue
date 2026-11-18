<script setup lang="ts">
/**
 * 屏幕 02 · 首页（月视图 + 当天展会列表）
 *
 * 日历卡片支持左右跟手滑动切换月份，两侧常备相邻月份预览面板。
 * 点选日期纯属本地状态切换，零请求、零重建闪烁。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, bootApp } from '@/app/runtime';
import { paths } from '@/app/surface';
import { preloadAdjacentMonths } from '@/app/preload';
import { useBootstrapStore } from '@/stores/bootstrap';
import { toast } from '@/services/toast';
import AppIcon from '@/components/AppIcon.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import MediaBox from '@/components/MediaBox.vue';
import CalendarMonthPanel from '@/components/CalendarMonthPanel.vue';
import { useAsync } from '@/composables/useAsync';
import { useRevealReady } from '@/composables/useReveal';
import { suppressPull, usePullRefresh } from '@/services/pull-refresh';
import { resolveCalendarSwipe } from '@/services/calendar-swipe';
import type { CachedRead } from '@/services/query-cache';
import { coverOf } from '@/services/cover';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import { addMonths, formatChineseTime, monthLabel } from '@/services/format';
import type { JsonObject } from '@/api/types';
import { modeLabel, registrationStatusLabel, statusTone } from '@/services/status';
import { t } from '@/i18n';

const router = useRouter();
const bootstrap = useBootstrapStore();

const view = ref({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  day: 0,
});
const landingApplied = ref(false);

const monthQuery = useAsync<{ data: JsonObject; year: number; month: number }>();
const monthData = computed(() => monthQuery.data.value?.data);
const error = computed(() => monthQuery.error.value?.message ?? '');
const loading = monthQuery.loading;
const hasContent = computed(() => monthData.value !== undefined);
const revealReady = useRevealReady();

const calendarHost = ref<HTMLElement>();
const swipeHost = ref<HTMLElement>();
const previousPreview = ref<HTMLElement>();
const nextPreview = ref<HTMLElement>();
const dragging = ref(false);

const previousMonth = computed(() => addMonths(view.value.year, view.value.month, -1));
const nextMonth = computed(() => addMonths(view.value.year, view.value.month, 1));

const items = computed<JsonObject[]>(() => dayRows('exhibitions'));
const meetings = computed<JsonObject[]>(() => dayRows('meetings'));

function dayRows(key: 'exhibitions' | 'meetings'): JsonObject[] {
  const day = view.value.day;
  if (day <= 0) return [];
  const all = Array.isArray(monthData.value?.[key]) ? (monthData.value?.[key] as JsonObject[]) : [];
  return all.filter((item) => {
    if (key === 'exhibitions' && Array.isArray(item.days)) return (item.days as unknown[]).includes(day);
    return Number(item.day) === day;
  });
}

function meetingLine(meeting: JsonObject): string {
  const time = formatChineseTime(meeting.meetingTime);
  return time ? t('registration.list.privateMeetingAt', { time }) : t('registration.list.privateMeeting');
}

const meetingInitial = t('home.meetingInitial');

const selectedMeta = computed(() => {
  const count = items.value.length + meetings.value.length;
  return count > 0 ? t('home.selectedCount', { count }) : t('home.noSchedule');
});

const announcement = ref('');

async function load(): Promise<boolean> {
  const requested = { ...view.value };
  const applyLanding = !landingApplied.value;
  const result = await monthQuery.run(async (signal) => {
    await bootApp();
    signal.throwIfAborted();
    if (applyLanding) {
      const landing = (bootstrap.calendar.landing ?? {}) as JsonObject;
      const year = Number(landing.year);
      const month = Number(landing.month);
      if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
        requested.year = year;
        requested.month = month;
      }
    }
    const monthPromise = api.exhibitions.month({
      year: requested.year,
      month: requested.month,
      day: requested.day || undefined,
    }) as CachedRead<JsonObject>;
    if (monthPromise.cached !== undefined) {
      monthQuery.seed({ data: monthPromise.cached, year: requested.year, month: requested.month });
    }
    const data = await monthPromise;
    return { data, year: requested.year, month: requested.month };
  });
  if (!result) return false;
  landingApplied.value = true;
  view.value.year = result.year;
  view.value.month = result.month;
  if (!view.value.day) view.value.day = Number(result.data.day) || 0;
  preloadAdjacentMonths(result.year, result.month);
  for (const item of items.value.slice(0, 2)) warm(item.id);
  return true;
}

function selectDay(day: number): void {
  if (view.value.day === day) return;
  view.value.day = day;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let slideTimer: number | undefined;
let snapTimer: number | undefined;
let monthSliding = false;

function cardWidth(): number {
  const card = calendarHost.value;
  return card?.getBoundingClientRect().width || card?.clientWidth || swipeHost.value?.clientWidth || 320;
}

function paintOffset(offset: number, transition: string): void {
  const width = cardWidth();
  const card = calendarHost.value;
  if (card) {
    card.style.transition = transition;
    card.style.transform = `translate3d(${offset}px, 0, 0)`;
  }
  const previous = previousPreview.value;
  if (previous) {
    previous.style.transition = transition;
    previous.style.transform = `translate3d(${offset - width}px, 0, 0)`;
  }
  const next = nextPreview.value;
  if (next) {
    next.style.transition = transition;
    next.style.transform = `translate3d(${offset + width}px, 0, 0)`;
  }
}

function resetSlideStyles(): void {
  for (const node of [calendarHost.value, previousPreview.value, nextPreview.value]) {
    if (!node) continue;
    node.style.transition = 'none';
    node.style.transform = '';
  }
  dragging.value = false;
  if (calendarHost.value) calendarHost.value.dataset.drag = 'false';
}

function snapBackSlide(): void {
  paintOffset(0, 'transform var(--motion-normal) var(--ease-out)');
  if (snapTimer !== undefined) window.clearTimeout(snapTimer);
  snapTimer = window.setTimeout(
    () => {
      snapTimer = undefined;
      resetSlideStyles();
    },
    prefersReducedMotion() ? 0 : 260,
  );
}

function applyMonth(delta: number): void {
  const next = addMonths(view.value.year, view.value.month, delta);
  monthQuery.cancel();
  landingApplied.value = true;
  view.value.year = next.year;
  view.value.month = next.month;
  view.value.day = 0;
  resetSlideStyles();
  void load();
}

function slideMonth(direction: number): void {
  if (monthSliding) return;
  if (prefersReducedMotion()) {
    applyMonth(direction);
    return;
  }
  monthSliding = true;
  monthQuery.cancel();
  landingApplied.value = true;
  if (snapTimer !== undefined) {
    window.clearTimeout(snapTimer);
    snapTimer = undefined;
  }
  const offset = direction > 0 ? -cardWidth() : cardWidth();
  paintOffset(offset, 'transform var(--motion-normal) var(--ease-out)');
  const card = calendarHost.value;
  let finished = false;
  const finish = (event?: TransitionEvent): void => {
    if (event && (event.target !== card || event.propertyName !== 'transform')) return;
    if (finished) return;
    finished = true;
    if (slideTimer !== undefined) window.clearTimeout(slideTimer);
    monthSliding = false;
    applyMonth(direction);
  };
  if (card) card.addEventListener('transitionend', finish, { once: true });
  slideTimer = window.setTimeout(() => finish(), 420);
}

function shiftMonth(delta: number): void {
  if (monthSliding) return;
  slideMonth(delta);
}

function enableSwipe(): void {
  const host = swipeHost.value;
  const card = calendarHost.value;
  if (!host || !card) return;

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let axis = '';
  let lastX = 0;
  let lastTime = 0;
  let velocityX = 0;

  const clear = (): void => {
    pointerId = null;
    axis = '';
    deltaX = 0;
    velocityX = 0;
  };

  const snapBack = (): void => {
    card.dataset.drag = 'false';
    dragging.value = false;
    snapBackSlide();
    clear();
  };

  host.addEventListener('pointerdown', (event) => {
    if (pointerId !== null || event.pointerType === 'mouse') return;
    if (monthSliding) return;
    if (snapTimer !== undefined) {
      window.clearTimeout(snapTimer);
      snapTimer = undefined;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastTime = performance.now();
    deltaX = 0;
    velocityX = 0;
    axis = '';
  });

  host.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === '') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x') {
        suppressPull();
        card.dataset.drag = 'true';
        dragging.value = true;
      }
    }
    if (axis !== 'x') return;
    const now = performance.now();
    const elapsed = Math.max(1, now - lastTime);
    velocityX = (event.clientX - lastX) / elapsed;
    lastX = event.clientX;
    lastTime = now;
    deltaX = dx;
    const width = cardWidth();
    const bounded = Math.max(-width, Math.min(width, dx));
    paintOffset(bounded, 'none');
    event.preventDefault();
  });

  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    card.dataset.drag = 'false';
    const width = cardWidth();
    const outcome = resolveCalendarSwipe({ deltaX, velocityX, width });
    if (outcome.commit) {
      clear();
      slideMonth(outcome.direction);
      return;
    }
    snapBack();
  };

  host.addEventListener('pointerup', finish);
  host.addEventListener('pointercancel', (event) => {
    if (event.pointerId === pointerId) snapBack();
  });
  host.addEventListener('pointerleave', (event) => {
    if (event.pointerId === pointerId) snapBack();
  });
}

function warm(id: unknown): void {
  if (id === undefined || id === null) return;
  void api.exhibitions.get(String(id)).catch(() => undefined);
}

function announce(): void {
  const info = bootstrap.announcement;
  if (info.enabled !== true || !info.text) return;
  const key = `announcement:${String(info.text)}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // 隐私模式下忽略存储失败，仍然提示一次
  }
  announcement.value = String(info.text);
  toast(announcement.value);
}

usePullRefresh(
  () => load().then(() => undefined),
  computed(() => loading.value && hasContent.value),
);

onMounted(() => {
  enableSwipe();
  announce();
  void load();
});
onBeforeUnmount(() => {
  if (slideTimer !== undefined) window.clearTimeout(slideTimer);
  if (snapTimer !== undefined) window.clearTimeout(snapTimer);
});
</script>

<template>
  <div v-if="announcement" class="notice" data-tone="accent" role="status">
    <strong>{{ t('auth.login.announcement') }}</strong>
    <span>{{ announcement }}</span>
  </div>

  <div class="calendar-toolbar">
    <strong class="calendar-month-heading">{{ monthLabel(view.year, view.month) }}</strong>
    <div class="calendar-nav">
      <button
        class="icon-button"
        data-variant="outlined"
        type="button"
        :aria-label="t('home.previousMonth')"
        :title="t('home.previousMonth')"
        @click="shiftMonth(-1)"
      >
        <AppIcon name="chevronLeft" />
      </button>
      <button
        class="icon-button"
        data-variant="outlined"
        type="button"
        :aria-label="t('home.nextMonth')"
        :title="t('home.nextMonth')"
        @click="shiftMonth(1)"
      >
        <AppIcon name="chevronRight" />
      </button>
      <button
        class="icon-button"
        data-variant="outlined"
        type="button"
        :aria-label="t('search.title')"
        :title="t('search.title')"
        @click="router.push('/search')"
      >
        <AppIcon name="search" />
      </button>
    </div>
  </div>

  <div ref="swipeHost" class="calendar-swipe" :data-dragging="dragging ? 'true' : undefined">
    <div ref="previousPreview" class="calendar calendar-preview" data-side="prev" aria-hidden="true" inert>
      <CalendarMonthPanel :year="previousMonth.year" :month="previousMonth.month" />
    </div>

    <div ref="calendarHost" class="calendar" :data-busy="loading && hasContent ? 'true' : undefined">
      <SkeletonBlock v-if="loading && !hasContent" :rows="1" />
      <StateBlock
        v-else-if="error && !hasContent"
        tone="error"
        :title="t('home.exhibitionLoadFailed')"
        :description="error"
        :action-label="t('common.retry')"
        @action="load"
      />
      <CalendarMonthPanel
        v-else
        :year="view.year"
        :month="view.month"
        :data="monthData"
        :selected-day="view.day"
        interactive
        @select="selectDay"
      />
    </div>

    <div ref="nextPreview" class="calendar calendar-preview" data-side="next" aria-hidden="true" inert>
      <CalendarMonthPanel :year="nextMonth.year" :month="nextMonth.month" />
    </div>
  </div>

  <div class="day-agenda-head">
    <span class="section-label">{{
      view.day > 0 ? t('home.dayEventsOn', { month: view.month, day: view.day }) : t('home.dayEvents')
    }}</span>
    <span class="pill">{{ selectedMeta }}</span>
  </div>

  <div v-if="error && hasContent" class="notice" data-tone="accent">
    <span>{{ error }}</span>
  </div>

  <SkeletonBlock v-if="loading && !hasContent" :rows="2" />
  <StateBlock
    v-else-if="!loading && !error && items.length === 0 && meetings.length === 0"
    icon="calendar"
    :title="t('home.emptyDay')"
    :description="t('home.emptyDayHint')"
    :action-label="t('admin.exhibitions.search')"
    @action="router.push('/search')"
  />
  <TransitionGroup
    v-else
    name="reveal"
    tag="div"
    class="list reveal"
    data-gap="sm"
    :css="revealReady"
    :data-busy="loading && hasContent ? 'true' : undefined"
  >
    <button
      v-for="item in items"
      :key="String(item.id)"
      class="row-card home-event-card"
      type="button"
      data-pressable="true"
      :aria-label="t('exhibition.list.viewAria', { title: String(item.title ?? '') })"
      @pointerdown="warm(item.id)"
      @click="router.push(`/detail/${item.id}`)"
    >
      <MediaBox :src="coverOf(item.imageUri)" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
      <span class="row-copy">
        <span class="home-card-head">
          <strong class="row-title truncate">{{ item.title }}</strong>
          <StatusTag
            :text="modeLabel(String(item.statusCode || ''))"
            :tone="statusTone(String(item.statusCode || ''))"
          />
        </span>
        <span class="meta-inline row-meta">
          <span v-if="item.time">{{ item.time }}</span>
          <span v-if="item.venue" class="truncate">{{ item.venue }}</span>
        </span>
        <span v-if="item.category" class="home-category-line">
          <span class="home-category-chip">{{ item.category }}</span>
        </span>
      </span>
    </button>
    <button
      v-for="meeting in meetings"
      :key="String(meeting.id)"
      class="row-card"
      type="button"
      data-pressable="true"
      :aria-label="t('home.meetingAria', { title: String(meeting.title ?? '') })"
      @click="router.push(paths.meetingDetail(String(meeting.id)))"
    >
      <span class="avatar" aria-hidden="true">{{ String(meeting.title || meetingInitial).slice(0, 1) }}</span>
      <span class="row-copy">
        <span class="name-line">
          <strong class="row-title truncate">{{ meeting.title }}</strong>
          <RoleTag :role-code="String(meeting.titleRole || '')" />
        </span>
        <span class="row-meta">{{ meetingLine(meeting) }}</span>
      </span>
      <StatusTag
        :text="registrationStatusLabel(String(meeting.statusCode || ''))"
        :tone="statusTone(String(meeting.statusCode || ''))"
      />
    </button>
  </TransitionGroup>
</template>

<style>
.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
}

.calendar-month-heading {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
}

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.calendar {
  position: relative;
  z-index: 1;
  padding: 10px 8px 8px;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
  background: var(--surface-card);
  will-change: transform;
}

.calendar-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  will-change: transform;
}

.calendar-preview[data-side='prev'] {
  transform: translate3d(-100%, 0, 0);
}

.calendar-preview[data-side='next'] {
  transform: translate3d(100%, 0, 0);
}

.day-agenda-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
}

.home-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  min-width: 0;
}

.home-card-head > .row-title {
  flex: 1 1 auto;
  min-width: 0;
}

.home-category-line {
  display: flex;
  align-items: center;
  margin-top: 2px;
}

.home-category-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-chip);
  background: var(--f3);
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 500;
}
</style>
