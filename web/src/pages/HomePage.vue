<script setup lang="ts">
/**
 * 屏幕 02 · 首页（月视图 + 当天展会列表）
 * 线框：docs/newUI/index.html #screen-home、docs/newUI/remaining-ui.html #screen-home
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
import HintNote from '@/components/HintNote.vue';
import { useHint } from '@/composables/useHint';
import { useAsync } from '@/composables/useAsync';
import { coverOf } from '@/services/cover';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import { addMonths, calendarRowCount, daysInMonth, firstWeekdayOffset, formatChineseTime, monthLabel } from '@/services/format';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const WEEK_LABELS = [t('s_1hqqsf'), t('s_12482qz'), t('s_3fnyn8'), t('s_q67h2y'), t('s_14c4war'), t('s_1sgquew'), t('s_qsy6ow')];
const SWIPE_THRESHOLD = 46;

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

const calendarHost = ref<HTMLElement>();
const swipeHost = ref<HTMLElement>();
/** 切月时的进出场方向，交给 motion.css 的 `data-leave` / `data-enter`。 */
const leave = ref('');
const enter = ref('');

interface Cell {
  day: number;
  /** 这一格属于哪个月：补位格子是相邻月份的日期，读屏不能报成当月。 */
  month: number;
  muted: boolean;
  /** 这一天有展会：数字加粗。和圆点不是一回事。 */
  bold: boolean;
  /** 这一天有当前用户的活动：数字下方画圆点。 */
  hasEvent: boolean;
  disabled: boolean;
}

/**
 * 行数按月份实际需要取 5 或 6 行：放得下就只排 5 行，放不下才加第 6 行。
 *
 * 行高只有一档（`tokens.css` 的 `.cal-day`），所以同一行内的日期不会上下跳；
 * 不足整行时用相邻月份的日期补位（灰显不可点），与设计稿一致。
 */
const rows = computed(() => calendarRowCount(view.value.year, view.value.month));

/** 日历格子：上下月的补位灰显且不可点，只有本月的日期能选中。 */
const cells = computed<Cell[]>(() => {
  const { year, month } = view.value;
  const total = daysInMonth(year, month);
  const offset = firstWeekdayOffset(year, month);
  const previous = addMonths(year, month, -1);
  const previousTotal = daysInMonth(previous.year, previous.month);
  const boldDays = new Set(eventDays());
  const marked = new Set(markedDays());
  const list: Cell[] = [];
  for (let index = 0; index < offset; index += 1) {
    list.push({
      day: previousTotal - offset + index + 1,
      month: previous.month,
      muted: true,
      bold: false,
      hasEvent: false,
      disabled: true,
    });
  }
  for (let day = 1; day <= total; day += 1) {
    list.push({
      day,
      month,
      muted: false,
      bold: boldDays.has(day),
      hasEvent: marked.has(day),
      disabled: false,
    });
  }
  const trailing = (rows.value * 7) - offset - total;
  const next = addMonths(year, month, 1);
  for (let day = 1; day <= trailing; day += 1) {
    list.push({ day, month: next.month, muted: true, bold: false, hasEvent: false, disabled: true });
  }
  return list;
});

const items = computed<JsonObject[]>(() => dayRows('exhibitions'));
const meetings = computed<JsonObject[]>(() => dayRows('meetings'));

function dayRows(key: 'exhibitions' | 'meetings'): JsonObject[] {
  const day = view.value.day;
  if (day <= 0) return [];
  const all = Array.isArray(monthData.value?.[key]) ? monthData.value?.[key] as JsonObject[] : [];
  return all.filter((item) => Number(item.day) === day);
}

function meetingLine(meeting: JsonObject): string {
  const time = formatChineseTime(meeting.meetingTime);
  return time ? `${time} · ${t('s_zmypci')}` : t('s_zmypci');
}

const eventDays = (): number[] => (Array.isArray(monthData.value?.eventDays) ? monthData.value?.eventDays as number[] : []);
const markedDays = (): number[] => (Array.isArray(monthData.value?.markedDays) ? monthData.value?.markedDays as number[] : []);
const myActivityMark = t('s_1evxb6');

const selectedMeta = computed(() => {
  const count = items.value.length + meetings.value.length;
  return count > 0 ? `${count} 场` : t('s_xwhfsg');
});

/** 启动公告：只在开关打开且本机未读过时显示一次。 */
const announcement = ref('');

function dayLabel(cell: Cell): string {
  const suffix = `${cell.bold ? t('s_1hzbri3') : ''}${cell.hasEvent ? myActivityMark : ''}`;
  const selected = cell.day === view.value.day && !cell.muted ? t('s_19g8l4d') : '';
  // 用格子自己的月份：补位格子是上/下月的日期，报成当月会让读屏听到错的日期。
  return `${cell.month}月${cell.day}日${suffix}${selected}`;
}

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
    const data = await api.exhibitions.month({
      year: requested.year,
      month: requested.month,
      day: requested.day || undefined,
    }) as JsonObject;
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

let monthTimer: number | undefined;
let enterFrame: number | undefined;
let pendingMonth: { year: number; month: number } | undefined;

/** 切换月份：先让当前卡片滑出，再载入新月份并滑入，让「月份变了」在视觉上连续。 */
function shiftMonth(delta: number): void {
  const current = pendingMonth ?? view.value;
  const next = addMonths(current.year, current.month, delta);
  pendingMonth = next;
  window.clearTimeout(monthTimer);
  monthQuery.cancel();
  // 用户已经指定月份时，晚到的启动落点不再接管视图。
  landingApplied.value = true;
  const apply = (): void => {
    pendingMonth = undefined;
    view.value.year = next.year;
    view.value.month = next.month;
    // 交给新月份自己挑第一个有展会的日期。
    view.value.day = 0;
    enter.value = delta > 0 ? 'right' : 'left';
    void load().then((applied) => {
      if (!applied) return;
      enterFrame = requestAnimationFrame(() => { enter.value = ''; });
    });
  };
  if (prefersReducedMotion()) {
    apply();
    return;
  }
  leave.value = delta > 0 ? 'left' : 'right';
  monthTimer = window.setTimeout(() => {
    leave.value = '';
    apply();
  }, 140);
}

/**
 * 左右滑动切换月份。
 *
 * 手指刚按下就先预取该展会详情（与列表项的 pointerdown 同理），点进详情时数据已在缓存里。
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

  const reset = (animate: boolean): void => {
    card.style.transition = animate ? 'transform var(--motion-normal) var(--ease-out)' : 'none';
    card.style.transform = '';
    pointerId = null;
    axis = '';
    deltaX = 0;
  };

  host.addEventListener('pointerdown', (event) => {
    if (pointerId !== null || event.pointerType === 'mouse') return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    deltaX = 0;
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
        card.dataset.drag = 'true';
        card.style.transition = 'none';
      }
    }
    if (axis !== 'x') return;
    deltaX = dx;
    // 拖到边界外时阻尼，给出「到头了」的手感。
    const damped = Math.sign(deltaX) * Math.min(Math.abs(deltaX), 96);
    card.style.transform = `translate3d(${damped * 0.6}px, 0, 0)`;
    event.preventDefault();
  });

  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    const committed = axis === 'x' && Math.abs(deltaX) >= SWIPE_THRESHOLD;
    const direction = deltaX < 0 ? 1 : -1;
    card.dataset.drag = 'false';
    reset(!committed);
    if (committed) {
      shiftMonth(direction);
      // 真的滑动切过月份了：这条「可以左右滑动」的提示就算教完了
      void dismissHint();
    }
  };

  host.addEventListener('pointerup', finish);
  host.addEventListener('pointercancel', (event) => {
    if (event.pointerId === pointerId) {
      card.dataset.drag = 'false';
      reset(true);
    }
  });
  host.addEventListener('pointerleave', (event) => {
    if (event.pointerId === pointerId) {
      card.dataset.drag = 'false';
      reset(true);
    }
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

onMounted(() => {
  enableSwipe();
  announce();
  void load();
});
onBeforeUnmount(() => {
  window.clearTimeout(monthTimer);
  if (enterFrame !== undefined) cancelAnimationFrame(enterFrame);
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
    <strong>{{ t('s_153oaxf') }}</strong>
    <span>{{ announcement }}</span>
  </div>

  <div class="row" data-between="true">
    <strong>{{ monthLabel(view.year, view.month) }}</strong>
    <div class="row">
      <button
        class="icon-button"
        data-variant="outlined"
        type="button"
        :aria-label="t('s_e4jezx')"
        :title="t('s_e4jezx')"
        @click="shiftMonth(-1)"
      >
        <AppIcon name="chevronLeft" />
      </button>
      <button
        class="icon-button"
        data-variant="outlined"
        type="button"
        :aria-label="t('s_y6u3g')"
        :title="t('s_y6u3g')"
        @click="shiftMonth(1)"
      >
        <AppIcon name="chevronRight" />
      </button>
    </div>
  </div>

  <div ref="swipeHost" class="calendar-swipe">
    <div
      ref="calendarHost"
      class="calendar"
      :data-leave="leave || undefined"
      :data-enter="enter || undefined"
      :data-busy="loading && hasContent ? 'true' : undefined"
    >
      <SkeletonBlock v-if="loading && !hasContent" :rows="1" />
      <StateBlock
        v-else-if="error && !hasContent"
        tone="error"
        :title="t('s_1tbhtoh')"
        :description="error"
        :action-label="t('s_lswd2v')"
        @action="load"
      />
      <template v-else>
        <div class="week-row" aria-hidden="true">
          <span v-for="label in WEEK_LABELS" :key="label">{{ label }}</span>
        </div>
        <div class="calendar-grid" :data-rows="rows">
          <button
            v-for="(cell, index) in cells"
            :key="`${cell.muted ? 'p' : 'c'}-${cell.day}-${index}`"
            class="cal-day"
            type="button"
            :data-day="cell.day"
            :data-muted="cell.muted ? 'true' : 'false'"
            :data-bold="cell.bold ? 'true' : 'false'"
            :data-has-event="cell.hasEvent ? 'true' : 'false'"
            :aria-pressed="!cell.muted && cell.day === view.day ? 'true' : 'false'"
            :aria-label="dayLabel(cell)"
            :disabled="cell.disabled"
            @click="selectDay(cell.day)"
          >
            <span class="cal-day-num">{{ cell.day }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>

  <!-- 一次性提示：真滑动切过一次月份（或点「知道了」）就不再显示 -->
  <HintNote v-if="hintVisible" :text="t('s_15hmwa0')" @dismiss="dismissHint" />

  <div class="row" data-between="true">
    <strong>{{ view.day > 0 ? `${view.month} 月 ${view.day} 日的活动` : t('s_1e4opb2') }}</strong>
    <span class="dim">{{ selectedMeta }}</span>
  </div>

  <div v-if="error && hasContent" class="notice" data-tone="accent">
    <span>{{ error }}</span>
  </div>

  <div class="list" data-gap="sm">
    <SkeletonBlock v-if="loading && !hasContent" :rows="2" />
    <StateBlock
      v-else-if="!loading && !error && items.length === 0 && meetings.length === 0"
      :title="t('s_1vtk64c')"
      :description="t('s_1jbzuzw')"
      :action-label="t('s_50ih74')"
      @action="router.push('/search')"
    />
    <template v-else>
      <button
        v-for="item in items"
        :key="String(item.id)"
        class="row-card"
        type="button"
        data-pressable="true"
        :aria-label="`查看 ${item.title} 详情`"
        @pointerdown="warm(item.id)"
        @click="router.push(`/detail/${item.id}`)"
      >
        <MediaBox :src="coverOf(item.imageUri)" class-name="thumb thumb-cover" :alt="String(item.title || '')" />
        <span class="row-copy">
          <span class="row" data-gap="md">
            <strong class="row-title truncate">{{ item.title }}</strong>
            <StatusTag :text="String(item.modeLabel || item.status || '')" />
          </span>
          <span class="row-meta">{{ item.time }} · {{ item.venue }}</span>
          <span class="row-meta truncate">{{ item.category || '' }}</span>
        </span>
      </button>
      <button
        v-for="meeting in meetings"
        :key="String(meeting.id)"
        class="row-card"
        type="button"
        data-pressable="true"
        :aria-label="`查看与 ${meeting.title} 的会议详情`"
        @click="router.push(paths.meetingDetail(String(meeting.id)))"
      >
        <span class="avatar" aria-hidden="true">{{ String(meeting.title || '会').slice(0, 1) }}</span>
        <span class="row-copy">
          <span class="name-line">
            <strong class="row-title truncate">{{ meeting.title }}</strong>
            <RoleTag :role-code="String(meeting.titleRole || '')" />
          </span>
          <span class="row-meta">{{ meetingLine(meeting) }}</span>
        </span>
        <StatusTag :text="String(meeting.status || '')" />
      </button>
    </template>
  </div>
</template>
