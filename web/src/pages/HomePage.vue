<script setup lang="ts">
/**
 * 屏幕 02 · 首页（月视图 + 当天展会列表）
 *
 * 日历卡片支持左右滑动切换月份：拖动时卡片跟手位移，松手超过阈值则滑出并载入相邻月份。
 * 行数按月份实际需要取 5 或 6 行（放得下就 5 行），行高只有一档，所以同一行里的日期不会跳。
 *
 * 点日期**不发请求**：`exhibitions.month` 一次返回整月展会和本人的私人会议，选中哪一天纯属本地状态，
 * 因此既不重新取数，也不重建日历 DOM（重建会让卡片闪一下、圆点动画重放）。
 *
 * 有展会的日期把数字加粗。圆点标和当前用户有关的日期：已通过或已参加的报名、
 * 待审核或已通过的私人会议（申请人与主办人都算）、自己开办的展会。
 * 已拒绝和已撤销的会议不打点，也不出现在当天列表。访客只有加粗，没有圆点。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import HintNote from '@/components/HintNote.vue';
import CalendarMonthPanel from '@/components/CalendarMonthPanel.vue';
import PwaInstallSheet from '@/components/PwaInstallSheet.vue';
import { useHint } from '@/composables/useHint';
import { useAsync } from '@/composables/useAsync';
import { useRevealReady } from '@/composables/useReveal';
import { suppressPull, usePullRefresh } from '@/services/pull-refresh';
import { resolveCalendarSwipe } from '@/services/calendar-swipe';
import { dismissIosInstallHint, iosInstallHintDismissed, isIosInstallOffer } from '@/services/pwa';
import { openSheet, sheet } from '@/services/sheet';
import type { CachedRead } from '@/services/query-cache';
import { coverOf } from '@/services/cover';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import { addMonths, formatChineseTime, joinText, monthLabel } from '@/services/format';
import { agreementConsentPending } from '@/services/agreement-prompt';
import type { JsonObject } from '@/api/types';
import { exhibitionModeCode, modeLabel, registrationStatusLabel, statusTone } from '@/services/status';
import { t } from '@/i18n';

const WEEK_LABELS = [
  t('home.weekdayMon'),
  t('home.weekdayTue'),
  t('home.weekdayWed'),
  t('home.weekdayThu'),
  t('home.weekdayFri'),
  t('home.weekdaySat'),
  t('home.weekdaySun'),
];

const router = useRouter();
const bootstrap = useBootstrapStore();
/** 日历滑动提示：与账号绑定的一次性提示，真滑过一次就不再显示。 */
const { visible: hintVisible, dismiss: dismissHint } = useHint('home-calendar-swipe');

const view = ref({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  // 0 表示「未指定」：落到当月第一个有展会的日期。
  day: 0,
});
/** 落点月份只采用一次：之后切月份、点日期都以用户为准。 */
const landingApplied = ref(false);

const monthQuery = useAsync<{ data: JsonObject; year: number; month: number }>();
const monthData = computed(() => monthQuery.data.value?.data);
const error = computed(() => monthQuery.error.value?.message ?? '');
const loading = monthQuery.loading;
const hasContent = computed(() => monthData.value !== undefined);
const revealReady = useRevealReady();

const calendarHost = ref<HTMLElement>();
const swipeHost = ref<HTMLElement>();
/** 左右相邻月份的预览：拖动时从两侧露出，不让空白占着半个屏幕。 */
const previousPreview = ref<HTMLElement>();
const nextPreview = ref<HTMLElement>();
/** 拖动中（只用于视觉状态，不参与业务判断）。 */
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
    // 展会按「开展～闭展」覆盖的每一天出现在当天列表里；旧接口没有 days 时退回开展当天。
    if (key === 'exhibitions' && Array.isArray(item.days)) return (item.days as unknown[]).includes(day);
    return Number(item.day) === day;
  });
}

function meetingLine(meeting: JsonObject): string {
  const time = formatChineseTime(meeting.meetingTime);
  return time ? t('registration.list.privateMeetingAt', { time }) : t('registration.list.privateMeeting');
}

/** 会议行的头像取名称首字，没有名称时用这里的兜底字。 */
const meetingInitial = t('home.meetingInitial');

const selectedMeta = computed(() => {
  const count = items.value.length + meetings.value.length;
  return count > 0 ? t('home.selectedCount', { count }) : t('home.noSchedule');
});

/** 启动公告：只在开关打开且本机未读过时显示一次。 */
const announcement = ref('');

/** 加载当前 `view` 对应的月份；已有内容时保留旧内容，只标记忙碌。 */
async function load(): Promise<boolean> {
  const requested = { ...view.value };
  const applyLanding = !landingApplied.value;
  const result = await monthQuery.run(async (signal) => {
    // 落点月份由后端下发（示例数据集中在 2026 年 6–8 月），首屏必须等它落定。
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
    // 启动未完成就离开首页时，上面的 throwIfAborted 已经返回，不会发这次请求。
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
  // 只有还没选中日期时才采用后端给的落点，避免刷新覆盖用户的选择。
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
/** 回弹动画的兜底计时器：新一次拖动开始时要取消，免得它把正在拖的卡片复位。 */
let snapTimer: number | undefined;
/** iOS 安装引导的延迟计时器：离开首页时必须清掉，否则会在别的页面上弹。 */
let installHintTimer: number | undefined;
/** 只约一次安装提示：`bootstrap.booted` 可能在挂载前就已经是 true。 */
let installHintScheduled = false;
let monthSliding = false;

/** 当前日历卡片的宽度；布局没算出来时退回常见窄屏宽度。 */
function cardWidth(): number {
  const card = calendarHost.value;
  return card?.getBoundingClientRect().width || card?.clientWidth || swipeHost.value?.clientWidth || 320;
}

/**
 * 把「当前月卡片 + 左右相邻月预览」一起平移 `offset`（px）。
 *
 * 卡片在 `offset`；上/下月预览分别在 `offset - width` / `offset + width`。
 * 拖到一半松手前，下一月的日期网格已经跟着露出来了，不会看到空白。
 */
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

/** 清掉内联的 transition / transform：回到 CSS 静态位置（预览在两侧、当前月在中间）。 */
function resetSlideStyles(): void {
  for (const node of [calendarHost.value, previousPreview.value, nextPreview.value]) {
    if (!node) continue;
    node.style.transition = 'none';
    node.style.transform = '';
  }
  dragging.value = false;
  if (calendarHost.value) calendarHost.value.dataset.drag = 'false';
}

/** 松手但没到切月阈值：三块一起回原位。 */
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

/** 直接落月：减少动效、或动画兜底时用，不播预览层。 */
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

/**
 * 切月滑动：卡片和两侧预览一起滑一格。
 *
 * 下一月：卡片到 -width、下一月预览到 0；上一月：卡片到 +width、上一月预览到 0。
 * 动画结束才换 `view` 并用真实数据重画；预览层不带展会高亮，落月后立刻补齐。
 */
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
  // transition 不触发（页面在后台等）时的兜底，避免卡片停在屏外。
  slideTimer = window.setTimeout(() => finish(), 420);
}

/** 箭头按钮切月：与滑动共用同一段预览动画。 */
function shiftMonth(delta: number): void {
  if (monthSliding) return;
  slideMonth(delta);
}

/**
 * 左右滑动切换月份。
 *
 * 拖动 1:1 跟手，当前月与左右相邻月预览一起平移；松手时按「超过卡片宽度 1/4」
 * 或「快速甩动」判定切月，切月直接接续手指位置滑到位，再换月。
 */
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
    // 回弹动画还没结束时再次按下：取消兜底复位，交给这次拖动继续跟手。
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
      // 纵向手势交给页面滚动，横向才由日历接管。
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x') {
        // 日历接管横滑：把外壳的下拉手势本次作废，斜划时不会再闪出下拉指示圈。
        // 纵向手势不会走到这里，仍照旧能下拉刷新。
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
    // 1:1 跟手，最多跟到卡片宽度；超出后停住，不把整张卡拖出屏幕。
    const width = cardWidth();
    const bounded = Math.max(-width, Math.min(width, dx));
    // 卡片和两侧预览一起走：露出来的位置始终是相邻月份的日历，而不是空白。
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
      void dismissHint();
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

/** 手指按下就预取详情，点进去时不再等首屏。 */
function warm(id: unknown): void {
  if (id === undefined || id === null) return;
  void api.exhibitions.get(String(id)).catch(() => undefined);
}

/** 启动公告：仅在开关打开且未读时提示一次。 */
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

/**
 * iOS 安装引导：只在 Safari 且没有原生壳、用户还没关过时提示一次。
 *
 * 延到首屏之后（600ms）再弹，别跟启动公告、首屏取数在同一帧抢注意力；
 * 页面在这段时间里被换掉时由 `onBeforeUnmount` 清掉定时器，不会在别的页面上弹出来。
 * 关掉就算看过（`dismissIosInstallHint`），设置页里的入口仍然可以再打开说明。
 */
function scheduleInstallHint(): void {
  // 等启动数据到齐再约：协议更新确认要在同一批数据落定后弹，先弹安装引导会把它挡掉。
  // 只约一次；`bootstrap.booted` 从 false 变 true 时触发。
  if (installHintScheduled) return;
  installHintScheduled = true;
  installHintTimer = window.setTimeout(() => {
    installHintTimer = undefined;
    if (!isIosInstallOffer() || iosInstallHintDismissed()) return;
    // 用户协议更新必须由用户做出选择，安装提示不能抢在它前面。
    if (agreementConsentPending()) return;
    // 别的面板已经开着（例如协议更新确认）时让用户先处理，不在它上面再盖一层。
    if (sheet.current) return;
    openSheet({
      title: t('pwa.install.title'),
      component: PwaInstallSheet,
      props: { mode: 'app' },
      onClose: dismissIosInstallHint,
    });
  }, 600);
}

watch(
  () => bootstrap.booted,
  (booted) => {
    if (booted) scheduleInstallHint();
  },
  { immediate: true },
);

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
  if (installHintTimer !== undefined) window.clearTimeout(installHintTimer);
});
</script>

<template>
  <header class="row" data-between="true">
    <div class="stack" data-gap="sm">
      <span class="eyebrow">{{ bootstrap.brand.en }}</span>
      <h2>{{ bootstrap.brand.zh }}</h2>
    </div>
  </header>

  <div v-if="announcement" class="notice" data-tone="accent" role="status">
    <strong>{{ t('auth.login.announcement') }}</strong>
    <span>{{ announcement }}</span>
  </div>

  <div class="row" data-between="true">
    <strong>{{ monthLabel(view.year, view.month) }}</strong>
    <!-- 上/下月只留两颗箭头，不带圆框；命中区仍是 44px 的 .icon-button。 -->
    <div class="row month-shift">
      <button
        class="icon-button"
        type="button"
        :aria-label="t('home.previousMonth')"
        :title="t('home.previousMonth')"
        @click="shiftMonth(-1)"
      >
        <AppIcon name="chevronLeft" />
      </button>
      <button
        class="icon-button"
        type="button"
        :aria-label="t('home.nextMonth')"
        :title="t('home.nextMonth')"
        @click="shiftMonth(1)"
      >
        <AppIcon name="chevronRight" />
      </button>
    </div>
  </div>

  <div ref="swipeHost" class="calendar-swipe" :data-dragging="dragging ? 'true' : undefined">
    <!-- 相邻月份预览：拖动时与当前月一起平移。预览只排日期（不带展会高亮），
         落月后由真实数据重画；aria-hidden + inert 保证不会抢焦点或读屏。 -->
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

  <!-- 一次性提示：真滑动切过一次月份（或点「知道了」）就不再显示 -->
  <HintNote v-if="hintVisible" :text="t('home.swipeMonthHint')" @dismiss="dismissHint" />

  <div class="row" data-between="true">
    <strong>{{
      view.day > 0 ? t('home.dayEventsOn', { month: view.month, day: view.day }) : t('home.dayEvents')
    }}</strong>
    <span class="dim">{{ selectedMeta }}</span>
  </div>

  <div v-if="error && hasContent" class="notice" data-tone="accent">
    <span>{{ error }}</span>
  </div>

  <SkeletonBlock v-if="loading && !hasContent" :rows="2" />
  <StateBlock
    v-else-if="!loading && !error && items.length === 0 && meetings.length === 0"
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
      class="row-card"
      type="button"
      data-pressable="true"
      :aria-label="t('exhibition.list.viewAria', { title: String(item.title ?? '') })"
      @pointerdown="warm(item.id)"
      @click="router.push(`/detail/${item.id}`)"
    >
      <MediaBox :src="coverOf(item.imageUri)" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
      <span class="row-copy">
        <span class="row" data-gap="md">
          <strong class="row-title truncate">{{ item.title }}</strong>
          <StatusTag :text="modeLabel(exhibitionModeCode(item))" :tone="statusTone(exhibitionModeCode(item))" />
        </span>
        <span class="row-meta">{{ joinText([item.time, item.venue]) }}</span>
        <!-- 分类行最前面是展商名称：分类新建时必填，历史数据可能为空，空值不占位。 -->
        <span v-if="item.exhibitor || item.category" class="row-meta truncate">{{
          joinText([item.exhibitor, item.category])
        }}</span>
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
/* 月份切换只剩两颗箭头：去掉圆框后把间距收一档，箭头看起来仍是一组。 */
.month-shift {
  gap: var(--s1);
}

.calendar {
  position: relative;
  z-index: 1;
  padding: var(--s2);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-panel);
  /* 纸面底色：日期数字压在浅灰填充上对比度只有 4.4:1，换白卡后灰显日期也够读。 */
  background: var(--screen);
  will-change: transform;
}

/* 相邻月份预览：绝对定位铺满滑动区，随时和当前月一起平移。
   默认停在左右两侧（拖动开始前不可见），当前月留在正常文档流里决定卡片高度。 */
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
</style>
