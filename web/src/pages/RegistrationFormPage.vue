<script setup lang="ts">
/**
 * 屏幕 04 · 报名信息
 *
 * 表单按展商配置的收集项动态生成：文本、单选、多选三种类型。必填、选项和长度由回答文稿判断，
 * 上限数字仍取 bootstrap。校验失败落在字段原位，提交按钮固定在页脚，成功后短暂停留再进「我的活动」。
 *
 * 从报名详情带 `?registrationId=` 进来是「修改报名」：按收集项标题回填已有答案，
 * 提交仍是一次新的报名写入（与旧实现一致）。
 *
 * 报名站分享链接（`isJoinSurface`）且未登录时是**匿名报名**：应用内与已登录的报名站用户
 * 仍走原来的流程。匿名报名的姓名优先取展商配置的收集项：收集项里有标题命中服务端下发的
 * 同义词表（`bootstrap.registration.nameFieldTitles`，缺省「姓名 / 昵称 / 称呼 / 圈名」）的文本项时，
 * 不另画姓名输入框，直接用它的答案当姓名（答案照旧随收集项一起提交）；没有命中时才在收集项
 * 上方补一项必填「昵称」。提交不需要登录；成功后拿到的查询凭据只在响应里出现一次，
 * 页面直接把他送到带凭据的状态页，不冒充「我的活动」。
 *
 * 多天展会（闭展日期晚于开展）在姓名之后、收集项之前多一行「参加时间」：两个日期触发按钮
 * 打开同一个范围抽屉，可选范围限制在展会期间。默认整段展期，用户可改窄或清除；单日展会
 * 不显示也不提交这两个字段。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { isJoinSurface, paths } from '@/app/surface';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { openDateRange } from '@/services/pickers';
import { answerDocument } from '@domain/answer-document';
import { check, limit } from '@/services/validate';
import { EXHIBITION_STATUS, FIELD_TYPE, modeLabel, statusTone } from '@/services/status';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import AppIcon from '@/components/AppIcon.vue';
import { formatDateWithWeekday, joinText } from '@/services/format';
import { coverOf } from '@/services/cover';
import { loadMarkdownParser, markdownToHtml, sanitizeHtml } from '@/services/markdown';
import MediaBox from '@/components/MediaBox.vue';
import RadioChoices from '@/components/RadioChoices.vue';
import type { ExhibitionDetail, Registration } from '@/api/types';
import { t } from '@/i18n';

/** 收集项：`title` 既是答案行的键，也是本页的字段主键（后端按标题解析答案）。 */
interface FieldDef {
  title: string;
  type?: string;
  required?: boolean;
  options?: unknown;
}

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

const query = useAsync<ExhibitionDetail>();
const exhibition = computed(() => query.data.value?.exhibition);
/** 报名站才展示封面和简介。App 的报名表单保持原来的摘要卡片。 */
const joinDescription = computed(() => {
  if (!isJoinSurface) return '';
  const item = exhibition.value;
  if (!item) return '';
  const raw = String(item.description ?? '');
  if (!raw) return '';
  if (item.descriptionFormat === 'html') {
    return /<[a-z][\s\S]*>/i.test(raw) ? sanitizeHtml(raw) : '';
  }
  return markdownToHtml(raw);
});
const fields = computed<FieldDef[]>(() =>
  Array.isArray(query.data.value?.fields) ? (query.data.value?.fields as FieldDef[]) : [],
);
const exhibitionId = computed(() => String(route.params.id ?? ''));
const registrationId = computed(() => String(route.query.registrationId ?? ''));

/**
 * 受限账号不能报名：后端 `POST /registrations` 直接 403。
 * 详情页的「立即报名」已经置灰，但深链走得过去，这里整页换成说明，
 * **不渲染可填写的表单**——否则用户填完一整页答案才在提交时吃 403。
 */
const registerLimited = computed(() => session.loggedIn === true && session.user.can?.register === false);

/**
 * 匿名报名：报名站分享链接 + 未登录。应用内永远不是匿名（应用里进这一屏必须已登录），
 * 报名站里已登录的用户也按账号报名，与原来的行为一致。
 */
const anonymous = computed(() => isJoinSurface && session.loggedIn === false);

/** 姓名同义词表的缺省值：服务端没下发（或启动数据还没到）时按这四个词匹配文本收集项。 */
const DEFAULT_NAME_TITLES = ['姓名', '昵称', '称呼', '圈名'];

/**
 * 姓名同义词：服务端在 `bootstrap.registration.nameFieldTitles` 下发，每项 trim 后参与比较。
 * 启动数据还没到、或老服务端不下发这一段时用缺省四词兜底；**服务端明确下发数组时以它为准**：
 * 空数组是管理页的「不合并」配置（仍显示单独的姓名输入），不能拿缺省值把配置盖掉。
 */
const nameTitles = computed<string[]>(() => {
  const raw = bootstrap.registration?.nameFieldTitles;
  if (!bootstrap.booted || !Array.isArray(raw)) return DEFAULT_NAME_TITLES;
  return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
});

/**
 * 用作姓名的收集项（匿名报名才生效）：类型是文本（缺省即文本）且标题命中同义词表的收集项。
 * 命中时不再额外渲染姓名输入框，直接把它的答案当 visitorName；收集项本身照旧渲染与校验。
 */
const nameField = computed<FieldDef | null>(() => {
  if (!anonymous.value) return null;
  const titles = nameTitles.value;
  const found = fields.value.find((field) => {
    const type = String(field.type ?? '').trim();
    const isText = type === '' || type === FIELD_TYPE.TEXT;
    return isText && titles.includes(String(field.title ?? '').trim());
  });
  return found ?? null;
});

/** 命中姓名同义词的文本项：匿名模式下由报名页兜底成必填，展商没勾必填也要显示星号。 */
function isNameSourceField(field: FieldDef): boolean {
  return nameField.value?.title === field.title;
}

/** 没有命中同义词收集项时的兜底姓名输入（标题是「昵称」）；上限与个人资料的昵称同一把尺子。 */
const guestName = ref('');
const guestNameMax = computed(() => limit('nickname', 20));
const nameError = ref('');

// ── 参加时间（多天展会才显示） ───────────────────────────────────

/** 展会是否跨多天：闭展日期存在且晚于开展日期才让报名人选择参加时间。 */
const multiDay = computed(() => {
  const item = exhibition.value;
  const start = String(item?.date ?? '');
  const end = String(item?.endDate ?? '');
  return Boolean(start && end && end > start);
});
/** 参加时间的起止（`YYYY-MM-DD`）；空串表示不指定，由服务端按整段处理。 */
const attendanceStart = ref('');
const attendanceEnd = ref('');
/** 参加时间只填一端时的行内错误（服务端会按「只传一半」拒绝）。 */
const attendanceError = ref('');
const attendanceStartText = computed(() => formatDateWithWeekday(attendanceStart.value));
const attendanceEndText = computed(() => formatDateWithWeekday(attendanceEnd.value));

/** 答案：文本与单选存字符串，多选存字符串数组。 */
const answers = reactive<Record<string, string | string[]>>({});
/** 行内校验错误，键是收集项标题。 */
const fieldErrors = reactive<Record<string, string>>({});
/** 提交级错误（接口失败、展会已关闭）与提交结果，显示在页脚按钮上方。 */
const error = ref('');
const success = ref(false);
const approved = ref(false);
const busy = ref(false);
/** 表单只按第一份数据生成：之后刷新不再回填，避免冲掉用户已经填好的答案。 */
let built = false;
let redirectTimer: number | undefined;

/** 字符上限由管理员在「管理-设置」里配置，缺省与后端一致。 */
const textFillMax = computed(() => limit('textFill', 200));
const answerMax = computed(() => limit('answer', 200));
const submitLabel = computed(() => {
  if (!success.value) return t('registration.form.submit');
  return approved.value ? t('registration.form.submittedApproved') : t('registration.form.submittedPending');
});
/** 提交成功后的说明：匿名报名没有「我的活动」，只能用保存的查询链接看状态。 */
const successHint = computed(() => {
  if (anonymous.value) {
    return approved.value ? t('registration.form.guestApprovedHint') : t('registration.form.guestPendingHint');
  }
  return approved.value ? t('registration.form.autoApprovedHint') : t('registration.form.pendingHint');
});

onMounted(() => {
  if (!registerLimited.value) void load();
});

// 离开本页时取消尚未触发的跳转，避免把已经返回的用户再拽到「我的活动」。
onBeforeUnmount(() => {
  if (redirectTimer !== undefined) {
    window.clearTimeout(redirectTimer);
    redirectTimer = undefined;
  }
});

async function load(): Promise<void> {
  await query.run(async () => {
    const detail = await api.exhibitions.get(exhibitionId.value);
    // 展会不存在时不再去取报名，保持「找不到展会」这一条提示。
    // 回填已有报名只在登录态下有意义：匿名报名没有「修改报名」这个入口。
    let existing: Registration | null = null;
    if (detail?.found && registrationId.value && session.loggedIn) {
      const record = await api.registrations.get(registrationId.value);
      existing = record?.found ? (record.registration ?? null) : null;
    }
    if (detail?.found && isJoinSurface && detail.exhibition?.description) await loadMarkdownParser();
    if (detail?.found && !built) {
      built = true;
      seed(detail.fields ?? [], existing);
      seedAttendance(detail.exhibition, existing);
    }
    return detail;
  });
}

/** 按收集项把已有答案回填到表单；没有已有报名时只给必填单选补上第一项。 */
function seed(list: unknown[], existing: Registration | null): void {
  const decoded = answerDocument({
    fields: list as FieldDef[],
    source: { text: existing?.answers ?? '' },
  }).values;
  for (const raw of list) {
    const field = raw as FieldDef;
    const title = String(field.title ?? '');
    if (!title) continue;
    const options = splitOptions(field.options);
    const stored = decoded[title];
    if (field.type === FIELD_TYPE.RADIO) {
      const value = typeof stored === 'string' ? stored : '';
      answers[title] = existing
        ? (options.find((option) => option === value) ?? '')
        : field.required === true
          ? (options[0] ?? '')
          : '';
      continue;
    }
    if (field.type === FIELD_TYPE.CHECKBOX) {
      const chosen = Array.isArray(stored) ? stored : [];
      answers[title] = options.filter((option) => chosen.includes(option));
      continue;
    }
    answers[title] = typeof stored === 'string' ? stored : '';
  }
}

/**
 * 参加时间的初始值：多天展会默认整个展会区间；修改报名时已有值非空则优先用它。
 * 与 `seed` 一起只在数据第一次到位时执行，之后的刷新不覆盖用户已经改过的选择。
 */
function seedAttendance(item: ExhibitionDetail['exhibition'], existing: Registration | null): void {
  const start = String(item?.date ?? '');
  const end = String(item?.endDate ?? '');
  if (!start || !end || end <= start) return;
  const storedStart = String(existing?.attendanceStart ?? '');
  const storedEnd = String(existing?.attendanceEnd ?? '');
  if (storedStart && storedEnd) {
    attendanceStart.value = storedStart;
    attendanceEnd.value = storedEnd;
    return;
  }
  attendanceStart.value = start;
  attendanceEnd.value = end;
}

/** 参加时间：点任意一端都打开同一个日期范围抽屉，可选范围限制在展会期间。 */
function openAttendanceRange(): void {
  const item = exhibition.value;
  if (!item) return;
  openDateRange({
    start: attendanceStart.value,
    end: attendanceEnd.value,
    startLabel: t('registration.form.attendanceStart'),
    endLabel: t('registration.form.attendanceEnd'),
    min: String(item.date ?? ''),
    max: String(item.endDate ?? ''),
    onChange: ({ start, end }) => {
      attendanceError.value = '';
      attendanceStart.value = start;
      // 两端原样写回：两次点选同一天时两个框都显示这一天，不把它折叠成「单日」。
      attendanceEnd.value = end;
    },
  });
}

/** 选项为空时给一个占位选项，不渲染空白的单选 / 多选。 */
function splitOptions(options: unknown): string[] {
  const list = Array.isArray(options)
    ? options.map((item) => String(item).trim()).filter(Boolean)
    : String(options ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  return list.length > 0 ? list : [t('registration.form.unsetOption')];
}

function fieldId(field: FieldDef): string {
  return `field-${field.title.replace(/\s+/g, '-')}`;
}

function textValue(field: FieldDef): string {
  const value = answers[field.title];
  return typeof value === 'string' ? value : '';
}

function multiValue(field: FieldDef): string[] {
  const value = answers[field.title];
  return Array.isArray(value) ? value : [];
}

function clearFieldError(title: string): void {
  if (fieldErrors[title] !== undefined) delete fieldErrors[title];
}

/** 匿名报名的姓名输入：清掉上一次的校验错误。 */
function onGuestNameInput(event: Event): void {
  guestName.value = (event.target as HTMLInputElement).value;
  if (nameError.value) nameError.value = '';
}

/**
 * 姓名校验失败时把焦点移回输入框。
 * 单独一个函数是为了避开 `submit()` 里 `const document` 对全局 document 的遮蔽。
 */
async function focusGuestName(): Promise<void> {
  await nextTick();
  document.getElementById('registration-guest-name')?.focus();
}

function onTextInput(field: FieldDef, event: Event): void {
  answers[field.title] = (event.target as HTMLInputElement).value;
  clearFieldError(field.title);
}

function onRadioChange(field: FieldDef, option: string): void {
  answers[field.title] = option;
  clearFieldError(field.title);
}

function onMultiChange(field: FieldDef, option: string, event: Event): void {
  const list = multiValue(field).filter((item) => item !== option);
  if ((event.target as HTMLInputElement).checked) list.push(option);
  answers[field.title] = list;
  clearFieldError(field.title);
}

/** 校验失败时把焦点移到第一个出错的字段（单选 / 多选落在第一项上）。 */
async function focusField(title: string): Promise<void> {
  await nextTick();
  const id = `field-${title.replace(/\s+/g, '-')}`;
  const node = document.getElementById(id) ?? document.getElementById(`${id}-0`);
  node?.focus();
}

async function submit(): Promise<void> {
  const item = exhibition.value;
  if (busy.value || success.value || !item) return;
  error.value = '';
  nameError.value = '';
  attendanceError.value = '';
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];

  // 匿名报名先把姓名拦下来：别让用户填完一整页收集项才在提交时吃后端的必填错误。
  if (anonymous.value) {
    const nameSource = nameField.value;
    if (nameSource) {
      // 命中同义词收集项：姓名就取它的答案。这个收集项本身可能没勾必填，由报名页兜底，
      // 错误落在这个收集项原位（与收集项自己的校验同一个出口）。
      const nameValue = textValue(nameSource).trim();
      if (nameValue === '') {
        fieldErrors[nameSource.title] = t('registration.form.nameRequired');
        await focusField(nameSource.title);
        return;
      }
      // 这个答案同时也是 visitorName，服务端按昵称上限校验：先按同一把尺子拦下，
      // 别等提交后才在页脚收到 400。
      const nameTooLong = check(nameValue, { label: t('registration.form.name'), max: guestNameMax.value });
      if (nameTooLong) {
        fieldErrors[nameSource.title] = nameTooLong;
        await focusField(nameSource.title);
        return;
      }
    } else {
      nameError.value = check(guestName.value, {
        label: t('registration.form.nickname'),
        required: true,
        max: guestNameMax.value,
      });
      if (nameError.value) {
        await focusGuestName();
        return;
      }
    }
  }

  // 参加时间只填了一端时不发请求：服务端会按「只传一半」拒绝，这里先在字段旁说明。
  if (multiDay.value && Boolean(attendanceStart.value) !== Boolean(attendanceEnd.value)) {
    attendanceError.value = t('registration.form.attendanceIncomplete');
    return;
  }

  const document = answerDocument({
    fields: fields.value,
    source: { values: answers },
    limits: { textFill: textFillMax.value, answer: answerMax.value },
  });
  let firstInvalid = '';
  for (const problem of document.problems) {
    if (!problem.title) {
      error.value = problem.message;
      continue;
    }
    fieldErrors[problem.title] = problem.message;
    if (!firstInvalid) firstInvalid = problem.title;
  }
  if (firstInvalid) {
    await focusField(firstInvalid);
    return;
  }
  if (item.openForRegistration === false) {
    error.value = t('registration.form.notAccepting');
    return;
  }
  if (error.value) return;

  const profile = session.user;
  // 匿名报名取姓名的顺序：命中同义词的收集项 → 兜底的「昵称」输入框。
  const guestNameText = nameField.value ? textValue(nameField.value).trim() : guestName.value.trim();
  const visitorName = anonymous.value
    ? guestNameText
    : String(profile.nickname || profile.username || t('registration.form.fallbackName'));
  // 回传的是角色 code（协议值），不是展示文案：文案按 code 在展示处查表。
  // 匿名报名没有账号可读身份，不传这一项，由服务端记成访客。
  const visitorType = String(profile.role || 'user');

  busy.value = true;
  try {
    const result = await api.registrations.submit({
      exhibitionId: item.id,
      title: item.title,
      venue: item.venue,
      time: item.time,
      day: item.day,
      visitorName,
      ...(anonymous.value ? {} : { visitorType }),
      // 单日展会不显示参加时间，也不提交这两个字段（空串表示不指定，服务端按整段处理）。
      ...(multiDay.value ? { attendanceStart: attendanceStart.value, attendanceEnd: attendanceEnd.value } : {}),
      answers: document.text,
    });
    if (!result?.ok) {
      error.value = String(result?.error || t('registration.form.submitFailed'));
      return;
    }
    approved.value = result.autoApproved === true || item.statusCode === EXHIBITION_STATUS.REVIEW_OPTIONAL;
    success.value = true;
    toast(approved.value ? t('registration.form.submittedAndApproved') : t('registration.form.submitted'), 'success');
    // 匿名报名：查询凭据只在这次的响应里出现一次，必须马上带进状态页链接里；
    // 拿不到凭据时留在本页说明，不再冒充「已可以在我的活动里查看」。
    const queryToken = anonymous.value ? String(result.queryToken || '') : '';
    if (anonymous.value && !queryToken) {
      error.value = t('registration.form.queryTokenMissing');
      return;
    }
    const target = anonymous.value
      ? `${paths.registrationStatus(item.id)}?token=${encodeURIComponent(queryToken)}`
      : paths.registrations;
    // 提交成功后的短暂停留：定时器随页面一起取消，用户已经返回时不再被拉回列表。
    redirectTimer = window.setTimeout(() => {
      redirectTimer = undefined;
      void router.replace(target);
    }, 900);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- 受限账号：说明原因并给出离开的入口，不渲染表单 -->
  <StateBlock
    v-if="registerLimited"
    icon="info"
    :title="t('exhibition.detail.registerRestricted')"
    :description="t('exhibition.form.restrictedAccount')"
    :action-label="isJoinSurface ? t('registration.list.title') : t('exhibition.form.backToExhibitor')"
    @action="router.push(paths.home)"
  />

  <template v-else>
    <SkeletonBlock v-if="query.loading.value && !query.data.value" :rows="3" />

    <StateBlock
      v-else-if="query.error.value && !query.data.value"
      tone="error"
      :title="t('common.loadFailed')"
      :description="query.error.value.message"
      :action-label="t('common.retry')"
      @action="load"
    />

    <StateBlock
      v-else-if="query.data.value?.found === false"
      tone="error"
      icon="info"
      :title="t('exhibition.detail.notFound')"
      :description="String(query.data.value?.error || t('registration.form.loadInfoFailed'))"
      :action-label="isJoinSurface ? '' : t('exhibition.detail.backHome')"
      @action="router.push(paths.home)"
    />

    <template v-else-if="exhibition">
      <!-- 展会小名片：44×78 缩略图 + 标题 + 日期时间地点 + 信号灯 -->
      <div class="row-card reg-exhibition">
        <MediaBox
          :src="coverOf(exhibition.imageUri)"
          class-name="thumb thumb-cover reg-thumb"
          :alt="String(exhibition.title || '')"
        />
        <span class="row-copy">
          <strong class="row-title truncate">{{ exhibition.title }}</strong>
          <span class="row-meta">{{ joinText([formatDateWithWeekday(exhibition.date), exhibition.time], ' ') }}</span>
          <span class="row-meta truncate">{{ exhibition.venue }}</span>
        </span>
        <StatusTag
          :text="modeLabel(String(exhibition.statusCode || ''))"
          :tone="statusTone(String(exhibition.statusCode || ''))"
        />
      </div>

      <div v-if="joinDescription" class="rich-content" v-html="joinDescription" />

      <form id="registration-form" class="form" novalidate @submit.prevent="submit">
        <!-- 匿名报名没有账号可读姓名。收集项里没有命中同义词的文本项时，收集项上方补一项必填「昵称」；
             命中时姓名来自那个收集项本身，这里不再多画一个输入框。 -->
        <div v-if="anonymous && !nameField" class="field" :data-invalid="nameError ? 'true' : undefined">
          <label class="reg-question" for="registration-guest-name">
            {{ t('registration.form.nickname') }}<span class="required" aria-hidden="true"> *</span>
          </label>
          <input
            id="registration-guest-name"
            class="input"
            type="text"
            autocomplete="name"
            :maxlength="guestNameMax"
            :value="guestName"
            @input="onGuestNameInput"
          />
          <p v-if="nameError" class="field-error" role="alert">{{ nameError }}</p>
        </div>

        <!-- 参加时间：多天展会才有。点任意一端打开同一个日期范围抽屉（范围限制在展会期间），
             默认整段展期，用户可改窄；「清除」后提交空串表示不指定，由服务端按整段处理。 -->
        <div v-if="multiDay" class="field reg-attendance" :data-invalid="attendanceError ? 'true' : undefined">
          <span id="registration-attendance-label" class="reg-question">{{ t('registration.form.attendance') }}</span>
          <div class="attendance-range">
            <button
              id="registration-attendance-start"
              class="input input-line picker-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-labelledby="registration-attendance-label"
              @click="openAttendanceRange"
            >
              <span class="picker-trigger-value" :data-empty="attendanceStart ? 'false' : 'true'">{{
                attendanceStartText || t('registration.form.attendanceStart')
              }}</span>
              <AppIcon name="calendar" size="icon icon-sm" />
            </button>
            <span class="attendance-sep" aria-hidden="true">–</span>
            <button
              id="registration-attendance-end"
              class="input input-line picker-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-labelledby="registration-attendance-label"
              @click="openAttendanceRange"
            >
              <span class="picker-trigger-value" :data-empty="attendanceEnd ? 'false' : 'true'">{{
                attendanceEndText || t('registration.form.attendanceEnd')
              }}</span>
              <AppIcon name="calendar" size="icon icon-sm" />
            </button>
          </div>
          <p v-if="attendanceError" class="field-error" role="alert">{{ attendanceError }}</p>
        </div>

        <template v-for="field in fields" :key="field.title">
          <!-- 单选：一组互斥选项 -->
          <fieldset
            v-if="field.type === FIELD_TYPE.RADIO"
            class="choice-group"
            :data-invalid="fieldErrors[field.title] ? 'true' : undefined"
          >
            <legend class="reg-question">
              {{ field.title }}<span v-if="field.required" class="required" aria-hidden="true"> *</span>
            </legend>
            <RadioChoices
              :name="fieldId(field)"
              :options="splitOptions(field.options)"
              :selected="textValue(field)"
              @select="onRadioChange(field, $event)"
            />
            <p v-if="fieldErrors[field.title]" class="field-error" role="alert">{{ fieldErrors[field.title] }}</p>
          </fieldset>

          <!-- 多选：可同时勾选多项 -->
          <fieldset
            v-else-if="field.type === FIELD_TYPE.CHECKBOX"
            class="choice-group"
            :data-invalid="fieldErrors[field.title] ? 'true' : undefined"
          >
            <legend class="reg-question">
              {{ field.title }}<span v-if="field.required" class="required" aria-hidden="true"> *</span>
            </legend>
            <div class="check-row">
              <label
                v-for="(option, index) in splitOptions(field.options)"
                :key="option"
                class="check-label"
                :for="`${fieldId(field)}-${index}`"
              >
                <input
                  :id="`${fieldId(field)}-${index}`"
                  type="checkbox"
                  :value="option"
                  :checked="multiValue(field).includes(option)"
                  @change="onMultiChange(field, option, $event)"
                />
                <span class="check-copy">{{ option }}</span>
              </label>
            </div>
            <p v-if="fieldErrors[field.title]" class="field-error" role="alert">{{ fieldErrors[field.title] }}</p>
          </fieldset>

          <!-- 文本：默认类型 -->
          <div v-else class="field" :data-invalid="fieldErrors[field.title] ? 'true' : undefined">
            <label class="reg-question" :for="fieldId(field)">
              {{ field.title
              }}<span v-if="field.required || isNameSourceField(field)" class="required" aria-hidden="true"> *</span>
            </label>
            <input
              :id="fieldId(field)"
              class="input"
              type="text"
              :placeholder="t('registration.form.fieldPlaceholder', { title: field.title })"
              :maxlength="textFillMax"
              :value="textValue(field)"
              @input="onTextInput(field, $event)"
            />
            <p v-if="fieldErrors[field.title]" class="field-error" role="alert">{{ fieldErrors[field.title] }}</p>
          </div>
        </template>
      </form>
    </template>
  </template>

  <!-- 底部固定提交区：按钮用 form 属性关联正文里的表单，回车与点击走同一条提交路径 -->
  <Teleport v-if="exhibition && query.data.value?.found !== false" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <StateBlock
          v-if="success"
          tone="success"
          :title="approved ? t('registration.form.approved') : t('registration.form.submitted')"
          :description="successHint"
        />
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        <button
          class="cta"
          type="submit"
          form="registration-form"
          :disabled="busy || success"
          :data-loading="busy ? 'true' : 'false'"
        >
          {{ submitLabel }}
        </button>
        <p class="field-hint text-center">{{ t('registration.form.confirmHint') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 展会小名片：与列表里的行卡片同一套读法，提交前再确认一次是哪一场。 */
.reg-exhibition {
  align-items: center;
}

/* 缩略图按 44×78 展示（比列表里的 36×64 大一档）。 */
.reg-thumb {
  /* 高度固定，宽度随海报比例变化，卡片高度不变。 */
  height: 78px;
}

/* 收集项是「问题」：比普通字段标签大一号、加重，输入框仍是 .input 下划线。 */
.reg-question {
  color: var(--ink);
  font-size: var(--fs-h3);
  font-weight: 700;
  line-height: var(--lh-tight);
}

/* 必填星号：强调色小字，紧跟在问题后面。 */
.reg-question .required {
  color: var(--accent-ink);
  font-size: var(--fs-label);
}

/* 参加时间：一行放下两个日期触发按钮，中间一短横把起止分开。
   触发按钮借用 .input.input-line 的外观（与编辑展会页一致），这里只补布局。 */
.attendance-range {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.attendance-range > .picker-trigger {
  flex: 1 1 0;
  min-width: 0;
  justify-content: space-between;
  gap: var(--s1);
  text-align: start;
}

.attendance-range .picker-trigger svg {
  flex: none;
  color: var(--ink-3);
}

.attendance-sep {
  flex: none;
  color: var(--ink-3);
  font-size: var(--fs-meta);
}

.picker-trigger-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 还没选：按占位文字的层级弱化一档。 */
.picker-trigger-value[data-empty='true'] {
  color: var(--ink-3);
}
</style>
