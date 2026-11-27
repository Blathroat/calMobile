<script lang="ts">
/**
 * 本次页面访问是否已经弹过 PWA 安装引导。
 *
 * 模块级标记：SPA 内在底部导航切走再切回首页会重新挂载页面，但模块不重建，所以同一次访问
 * 只提示一次，不会来回盖抽屉；整页刷新 / 重新打开应用会重建模块，于是「每次访问提示一次」
 * 成立。关闭抽屉不写任何本机存储，这个标记也只活到本次页面关闭。
 */
let installHintOfferedThisVisit = false;

/** 测试用：重置「本次访问已提示」标记，等同于刷新页面后模块重建。 */
export function resetInstallHintVisitForTests(): void {
  installHintOfferedThisVisit = false;
}
</script>

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
import { useSessionStore } from '@/stores/session';
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
import { shouldOfferPwaInstall } from '@/services/pwa';
import { openSheet, sheet } from '@/services/sheet';
import type { CachedRead } from '@/services/query-cache';
import { coverOf } from '@/services/cover';
import StatusTag from '@/components/StatusTag.vue';
import RoleTag from '@/components/RoleTag.vue';
import { addMonths, formatChineseTime, formatDateWithWeekday, joinText, monthLabel } from '@/services/format';
import { agreementConsentPending } from '@/services/agreement-prompt';
import type { JsonObject } from '@/api/types';
import { exhibitionModeCode, modeLabel, registrationStatusLabel, statusTone } from '@/services/status';
import { homeDefaultDay } from '@/services/calendar-default';
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
const session = useSessionStore();
/** 日历滑动提示：与账号绑定的一次性提示，真滑过一次就不再显示。 */
const { visible: hintVisible, dismiss: dismissHint } = useHint('home-calendar-swipe');

/** 首屏落在当前自然月；之后切月份、点日期都以用户为准。 */
const view = ref({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  // 0 表示「还没选」：取到当月数据后按默认规则补上，见 `homeDefaultDay`。
  day: 0,
});

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

/** 当天列表的标题：选中某一天时报出日期，还没落定时只说「当日活动」。 */
const dayTitle = computed(() =>
  view.value.day > 0 ? t('home.dayEventsOn', { month: view.value.month, day: view.value.day }) : t('home.dayEvents'),
);

/** 选中日既没有展会也没有私人会议：换成空状态，并在原位给出可以点的邻近日期。 */
const dayEmpty = computed(
  () => !loading.value && !error.value && items.value.length === 0 && meetings.value.length === 0,
);

/** 某个月数据里的一类日期（eventDays 加粗 / markedDays 圆点），过滤掉脏值。 */
function numericDaysIn(data: JsonObject | undefined, key: 'eventDays' | 'markedDays'): number[] {
  const raw = data?.[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => Number(value)).filter((day) => Number.isInteger(day) && day > 0);
}

const exhibitionDays = computed(() => new Set(numericDaysIn(monthData.value, 'eventDays')));
const activityDays = computed(() => new Set(numericDaysIn(monthData.value, 'markedDays')));

interface DayJump {
  day: number;
  label: string;
  aria: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本月第几天 → ISO 日期：日期格式化统一按后端下发的 YYYY-MM-DD 口径来。 */
function isoOf(day: number): string {
  return view.value.year + '-' + pad2(view.value.month) + '-' + pad2(day);
}

/** 建议日期后面那句标记：有展会优先，只有本人活动时才写「有我的活动」。 */
function jumpMark(day: number): string {
  const hasExhibition = exhibitionDays.value.has(day);
  const hasActivity = activityDays.value.has(day);
  if (hasExhibition && hasActivity) return joinText([t('home.hasExhibition'), t('home.hasMyActivity')], ' · ');
  if (hasExhibition) return t('home.hasExhibition');
  return hasActivity ? t('home.hasMyActivity') : '';
}

/**
 * 空白日期的下一步：本月里离选中日最近的、有展会或本人活动的日期。
 *
 * 月视图一次取整月、点日期不发请求，所以这里只用已有的 eventDays / markedDays
 * 摆出几颗「几月几日 · 有展会」的按钮，点一下就地切换，不用用户自己猜哪几天有活动。
 */
const dayJumps = computed<DayJump[]>(() => {
  const ordered = [...new Set<number>([...exhibitionDays.value, ...activityDays.value])].sort((a, b) => a - b);
  const current = view.value.day;
  const candidates = ordered.filter((day) => day !== current);
  if (candidates.length === 0) return [];
  const before = candidates.filter((day) => day < current);
  const after = candidates.filter((day) => day > current);
  const picked: number[] = [];
  if (before.length > 0) picked.push(before[before.length - 1]!);
  if (after.length > 0) picked.push(after[0]!);
  // 只有一侧有日期时再补一颗，避免空白日的下一步只有唯一去处。
  if (picked.length < 2) {
    const extra =
      candidates.find((day) => !picked.includes(day) && day > current) ??
      candidates.find((day) => !picked.includes(day));
    if (extra !== undefined) picked.push(extra);
  }
  return picked
    .sort((a, b) => a - b)
    .map((day) => ({
      day,
      // 按钮文字只留「几月几日（周几）」：两颗并排才放得下，
      // 「有展会 / 有我的活动」放进读屏名称（按钮本来就出现在空白日期的下一步里）。
      label: formatDateWithWeekday(isoOf(day)),
      aria: t('home.dayAria', { month: view.value.month, day, marks: jumpMark(day), selected: '' }),
    }));
});

/** 启动公告：只在开关打开且本机未读过时显示一次。 */
const announcement = ref('');

/** 加载当前 `view` 对应的月份；已有内容时保留旧内容，只标记忙碌。 */
async function load(): Promise<boolean> {
  const requested = { ...view.value };
  const result = await monthQuery.run(async (signal) => {
    // 会话恢复后再取：本人活动的圆点要按登录身份算。
    await bootApp();
    signal.throwIfAborted();
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
  view.value.year = result.year;
  view.value.month = result.month;
  // 还没选过日期时按默认规则补上：本月今天之后第一个有活动的日期，没有就今天。
  // 已选过的日期不覆盖，刷新也不会把用户的选择冲掉。
  if (!view.value.day) {
    view.value.day = homeDefaultDay({
      year: result.year,
      month: result.month,
      // 后端给的 day 本来就是「该月第一个有展会的日期」，老接口没有 eventDays 时靠它兜底。
      activeDays: [
        ...numericDaysIn(result.data, 'eventDays'),
        ...numericDaysIn(result.data, 'markedDays'),
        Number(result.data.day) || 0,
      ],
      today: new Date(),
    });
  }
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
/** PWA 安装引导的延迟计时器：离开首页时必须清掉，否则会在别的页面上弹。 */
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
 * PWA 安装引导：每次进入首页，启动数据落定后提示一次。
 *
 * 条件只看「不是独立 PWA、也没有原生桥」（见 `shouldOfferPwaInstall()`）：浏览器里每次访问
 * 都提示，关掉不记任何状态；装到主屏幕或从原生 App 打开后条件自然为假。设置页里的入口
 * 仍可随时打开同一份说明。
 *
 * **同一次访问只提示一次**：模块级 `installHintOfferedThisVisit` 在打开抽屉时置位，
 * 底部导航切走再切回首页（页面重新挂载）不会反复弹；整页刷新后模块重建，才会再次提示。
 *
 * 延到首屏之后（600ms）再弹，别跟启动公告、首屏取数在同一帧抢注意力；
 * 页面在这段时间里被换掉时由 `onBeforeUnmount` 清掉定时器，不会在别的页面上弹出来。
 */
function scheduleInstallHint(): void {
  // 本次访问已经提示过（例如从别的页面切回首页）：不再排定时器。
  if (installHintOfferedThisVisit) return;
  // 等启动数据到齐再约：协议更新确认要在同一批数据落定后弹，先弹安装引导会把它挡掉。
  // 每次挂载只约一次；`bootstrap.booted` 从 false 变 true 时触发。
  if (installHintScheduled) return;
  installHintScheduled = true;
  installHintTimer = window.setTimeout(() => {
    installHintTimer = undefined;
    // 定时器等待期间可能已经从别的页面切回来并提示过；同一次访问不再弹第二次。
    if (installHintOfferedThisVisit) return;
    if (!shouldOfferPwaInstall()) return;
    // 用户协议更新必须由用户做出选择，安装提示不能抢在它前面。
    if (agreementConsentPending()) return;
    // 别的面板已经开着（例如协议更新确认）时让用户先处理，不在它上面再盖一层。
    if (sheet.current) return;
    installHintOfferedThisVisit = true;
    openSheet({
      title: t('pwa.install.title'),
      component: PwaInstallSheet,
      props: { mode: 'app' },
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
  <!-- 品牌行收成一行：首屏优先留给日历与当天活动，名字与拉丁标记各占一侧。 -->
  <header class="row" data-between="true">
    <h2 class="home-brand truncate">{{ bootstrap.brand.zh }}</h2>
    <span class="eyebrow">{{ bootstrap.brand.en }}</span>
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
    <h2 class="home-day-title">{{ dayTitle }}</h2>
    <span class="pill">{{ selectedMeta }}</span>
  </div>

  <div v-if="error && hasContent" class="notice" data-tone="accent">
    <span>{{ error }}</span>
  </div>

  <SkeletonBlock v-if="loading && !hasContent" :rows="2" />
  <!-- 空白日期：先给出本月最近、确实有活动的日期按钮，点一下就地切换；
       搜索要登录，访客只看到日期按钮，不会被带去登录页。
       外面包一层是为了在短屏上收起状态块的大图标（见下方样式）。 -->
  <div v-else-if="dayEmpty" class="home-empty-day">
    <StateBlock :title="t('home.emptyDay')" :description="t('home.emptyDayHint')">
      <div v-if="dayJumps.length > 0" class="home-day-jumps grid-cols-2">
        <button
          v-for="jump in dayJumps"
          :key="jump.day"
          class="cta ghost"
          type="button"
          data-size="small"
          :aria-label="jump.aria"
          @click="selectDay(jump.day)"
        >
          {{ jump.label }}
        </button>
      </div>
      <button v-if="session.loggedIn" class="cta ghost" type="button" data-size="small" @click="router.push('/search')">
        {{ t('admin.exhibitions.search') }}
      </button>
    </StateBlock>
  </div>
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
/* 品牌行收成一行后让中文名先占满、拉丁标记贴右侧；名字过长时省略，不把标记挤出行外。 */
.home-brand {
  flex: 1 1 auto;
  min-width: 0;
}

/* 当天列表标题：与右侧「几场」的小签同一行，窄屏时标题自己换行。 */
.home-day-title {
  flex: 1 1 auto;
  min-width: 0;
}

/* 空白日期：360×800 的短屏上也要同时看到说明与两颗日期按钮，
   所以只在这一块收起空状态的大图标（状态块本身仍复用 StateBlock）。 */
.home-empty-day .state-icon {
  display: none;
}

/* 空白日期的下一步：本月最近的两个有活动的日期并排一行，点一下就切换。
   并排是为了让两个入口都落在首屏内，窄屏时按钮文字仍是一行日期。 */
.home-day-jumps {
  width: 100%;
}

/* 月份切换只剩两颗箭头：去掉圆框后把间距收一档，箭头看起来仍是一组。 */
.month-shift {
  gap: var(--s1);
}

.calendar {
  position: relative;
  z-index: 1;
  padding: var(--s2);
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-card);
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
