<script setup lang="ts">
/**
 * 屏幕 11 · 展会编辑（新建 / 编辑）
 *
 * 展商后台卡片上的「报名方式」「编辑简介」收进本页的「报名与简介设置」栏。
 * 「删除展会」放在页面内容最下方。新建与编辑共用同一页：
 * 路由带 `:id` 就是编辑（先取详情），不带就是新建（空表单），保存成功后换成编辑地址。
 *
 * 表单只填一次（`built` 闸）：首屏取数回来才落模型，之后的渲染不再覆盖用户输入。
 * 校验规则与上限统一走 `@/services/validate`，错误就地显示在 `.field-error` 并标 `data-invalid`。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { confirmSheet, openSheet } from '@/services/sheet';
import { PATTERNS, allowedFormats, check, limit, validateAll } from '@/services/validate';
import { EXHIBITION_STATUS, FIELD_TYPE, REGISTRATION_MODES, exhibitionStatusLabel } from '@/services/status';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import { loadMarkdownParser, markdownToHtml, plainText } from '@/services/markdown';
import CollectFieldsCard, { type CollectField } from '@/components/CollectFieldsCard.vue';
import { firstCollectFieldError } from '@/services/collect-fields';
import {
  clearExhibitionDraft,
  readExhibitionDraft,
  stashExhibitionDraft,
  type ExhibitionDraft,
} from '@/services/exhibition-draft';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import SegControl from '@/components/SegControl.vue';
import AppIcon from '@/components/AppIcon.vue';
import type { ExhibitionDetail, JsonObject } from '@/api/types';
import { t } from '@/i18n';

const MODES = REGISTRATION_MODES.map((value) => ({ value, label: exhibitionStatusLabel(value) }));
/** 分类下拉的占位项：清单由管理员维护，这里只提示「还没选」。 */
const categoryPlaceholder = t('exhibition.form.chooseCategory');

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
const session = useSessionStore();

const exhibitionId = computed(() => String(route.params.id ?? ''));
const isCreate = computed(() => exhibitionId.value === '');
const limited = computed(() => session.user.can?.limited === true);

/**
 * 分类下拉的选项：管理员配置的清单。
 * 老数据的分类可能已经不在清单里，仍把它作为一个选项带上，
 * 否则一进编辑页就会把展会分类悄悄改成空值。
 */
const categoryOptions = computed<string[]>(() => {
  const list = (Array.isArray(bootstrap.categories) ? bootstrap.categories : []).map((item) => String(item));
  const current = form.category.trim();
  return current && !list.includes(current) ? [current, ...list] : list;
});

const detail = useAsync<ExhibitionDetail>();
const saving = ref(false);
/** 新建保存成功后换成编辑地址，删除按钮据此出现。简介在新建时就能编辑。 */
const createdId = ref('');
const notFound = computed(
  () => !isCreate.value && detail.data.value !== undefined && detail.data.value.found === false,
);
const loadFailed = computed(() => detail.error.value !== undefined && detail.data.value === undefined);

const form = reactive({
  title: '',
  venue: '',
  date: '',
  time: '09:00-17:00',
  status: EXHIBITION_STATUS.REVIEW_REQUIRED as string,
  category: '',
  description: '',
  imageUri: '',
  registrationStart: '',
  registrationEnd: '',
  qrEnabled: false,
  allowCancel: true,
});
const fields = ref<CollectField[]>([]);

// ── 开展时间：两个系统时间选择框 ─────────────────────────────────

/**
 * 数据仍只有 `form.time` 一个字段（`HH:MM-HH:MM`），界面上拆成开始 / 结束两个
 * `type="time"`。两个都填了才拼成区间；只填一个时留空，仍按原有「时间选填」规则校验，
 * 提交的接口字段名与校验规则都不变。
 */
const timeStart = ref('');
const timeEnd = ref('');
/** 拆分写回时防止两个 watch 互相触发。 */
let composingTime = false;

/** 把 `9:00` 补成 `09:00`：历史数据可能没补零，type="time" 只认两位小时。 */
function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match?.[1] ?? '';
  const minute = match?.[2] ?? '';
  return hour && minute ? `${hour.padStart(2, '0')}:${minute}` : '';
}

/** 拆分历史值：认 `HH:MM-HH:MM` 与 `H:MM - H:MM` 两种写法，其它当作没填。 */
function splitTime(value: string): [string, string] {
  const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(value).trim());
  return [normalizeTime(match?.[1] ?? ''), normalizeTime(match?.[2] ?? '')];
}

function composeTime(): string {
  return timeStart.value && timeEnd.value ? `${timeStart.value}-${timeEnd.value}` : '';
}

watch([timeStart, timeEnd], () => {
  composingTime = true;
  const next = composeTime();
  if (form.time !== next) form.time = next;
  composingTime = false;
});

/** `form.time` 是唯一数据源：取数或回填草稿后，把两个时间框同步过来。 */
watch(
  () => form.time,
  (value) => {
    if (composingTime) return;
    const [start, end] = splitTime(value);
    timeStart.value = start;
    timeEnd.value = end;
  },
  { immediate: true, flush: 'sync' },
);

// ── 分类抽屉 ─────────────────────────────────────────────────────

/**
 * 分类是管理员维护的固定清单，不用系统下拉框：点击字段行打开底部抽屉，
 * 选项整行可点、当前值带对勾，点一下即选中并收起。
 */
function openCategorySheet(): void {
  openSheet({
    title: t('admin.limits.category'),
    layout: 'list',
    actions: [
      {
        label: categoryPlaceholder,
        checked: form.category.trim() === '',
        onClick: (close) => {
          form.category = '';
          close();
        },
      },
      ...categoryOptions.value.map((item) => ({
        label: item,
        checked: form.category === item,
        onClick: (close: () => void) => {
          form.category = item;
          close();
        },
      })),
    ],
  });
}
/** 表单只填一次：编辑页的数据到了才落模型，之后渲染不再覆盖用户输入。 */
const built = ref(false);
const formError = ref('');
const invalidField = ref('');

// ── 封面 / 报名方式 / 简介的可变展示 ──────────────────────────────

/** 允许的图片后缀：管理员在「管理-设置」里配置，缺省时给一句常见格式。 */
const formatHint = computed(() => {
  const list = allowedFormats('image');
  return list.length > 0 ? list.map((item) => `.${item}`).join('/') : t('exhibition.form.commonImageFormats');
});

/** 简介预览：Markdown 先渲染再抽纯文本，摘要与详情页看到的一致。 */
const descriptionSummary = computed(() => {
  if (!form.description) return t('exhibition.form.emptyDescription');
  return plainText(markdownToHtml(form.description), 70) || t('exhibition.form.markdownDescriptionSet');
});

const qrHint = computed(() => (form.qrEnabled ? t('exhibition.form.checkInQrOn') : t('exhibition.form.checkInQrOff')));
const allowCancelLabel = t('exhibition.form.allowCancel');
const allowCancelHint = t('exhibition.form.approvedCancelLocked');

// ── 校验 ─────────────────────────────────────────────────────────

/**
 * 逐字段的校验顺序：保存前一格一格地报错，与旧实现的 `validateAll(validators)` 等价。
 * 规则与上限来自 `@/services/validate`，这里只声明每一格用什么规则。
 */
function fieldChecks(): Array<[string, () => string]> {
  return [
    [
      'title',
      () =>
        check(form.title, {
          label: t('admin.limits.exhibitionName'),
          required: true,
          max: limit('exhibitionTitle', 60),
        }),
    ],
    [
      'venue',
      () =>
        check(form.venue, {
          label: t('admin.limits.exhibitionVenue'),
          required: true,
          max: limit('exhibitionVenue', 60),
        }),
    ],
    [
      'date',
      () =>
        check(form.date, {
          label: t('exhibition.form.openDate'),
          required: true,
          pattern: PATTERNS.date,
          patternMessage: t('exhibition.form.openDateRequired'),
        }),
    ],
    [
      'time',
      () =>
        check(form.time, {
          label: t('exhibition.form.openTime'),
          max: 20,
          pattern: PATTERNS.timeRange,
          patternMessage: t('exhibition.form.openTimeFormat'),
        }),
    ],
    [
      'registrationEnd',
      () =>
        check(form.registrationEnd, {
          label: t('exhibition.form.registrationEndDate'),
          custom: () =>
            form.registrationStart && form.registrationEnd && form.registrationEnd < form.registrationStart
              ? t('exhibition.form.registrationEndBeforeStart')
              : '',
        }),
    ],
    [
      'category',
      () =>
        check(form.category, {
          label: t('admin.limits.category'),
          max: limit('category', 20),
          pattern: PATTERNS.category,
          patternMessage: t('exhibition.form.categoryCharacters'),
        }),
    ],
    [
      'registrationStart',
      () =>
        check(form.registrationStart, {
          label: t('exhibition.form.registrationStartDate'),
          custom: () =>
            form.registrationStart && form.date && form.registrationStart > form.date
              ? t('exhibition.form.registrationStartTooLate')
              : '',
        }),
    ],
  ];
}

/** 保存前校验：第一条错误显示在原位（字段红框 + 统一说明），并给一次轻提示。 */
function failFirst(): boolean {
  invalidField.value = '';
  const checks = fieldChecks();
  const result = validateAll(checks.map(([, run]) => run));
  if (!result.ok) {
    invalidField.value = checks[result.index]?.[0] ?? '';
    formError.value = result.message;
    toast(result.message, 'error');
    return true;
  }
  const fieldMessage = firstCollectFieldError(fields.value, {
    title: limit('fieldTitle', 30),
    radio: limit('radioOption', 60),
    check: limit('checkOption', 60),
  });
  if (fieldMessage) {
    formError.value = fieldMessage;
    invalidField.value = 'fields';
    toast(formError.value, 'error');
    return true;
  }
  formError.value = '';
  return false;
}

/** 该字段是否处于「校验未通过」：红框 + 说明，不再依赖全局错误条。 */
function isInvalid(name: string): boolean {
  return invalidField.value === name;
}

// ── 取数 ─────────────────────────────────────────────────────────

function fillFrom(item: JsonObject, data: ExhibitionDetail): void {
  form.title = String(item.title ?? '');
  form.venue = String(item.venue ?? '');
  form.date = String(item.date ?? '');
  form.time = String(item.time ?? '');
  const status = String(item.statusCode ?? '');
  form.status = MODES.some((mode) => mode.value === status) ? status : EXHIBITION_STATUS.REVIEW_REQUIRED;
  form.category = String(item.category ?? '');
  form.description = String(item.description ?? '');
  form.imageUri = String(item.imageUri ?? '');
  form.registrationStart = String(item.registrationStart ?? '');
  form.registrationEnd = String(item.registrationEnd ?? '');
  form.qrEnabled = item.qrEnabled === true;
  form.allowCancel = item.allowCancel !== false;
  fields.value = (data.fields ?? []).map((field) => ({
    title: String(field.title ?? ''),
    type: String(field.type ?? FIELD_TYPE.TEXT),
    required: field.required === true,
    // 选项在模型里统一为数组，界面上按条目增删。
    options: normalizeOptions(field.options),
  }));
}

function applyDraft(draft: ExhibitionDraft): void {
  form.title = draft.title;
  form.venue = draft.venue;
  form.date = draft.date;
  form.time = draft.time;
  form.status = MODES.some((mode) => mode.value === draft.status) ? draft.status : EXHIBITION_STATUS.REVIEW_REQUIRED;
  form.category = draft.category;
  form.description = draft.description;
  form.imageUri = draft.imageUri;
  form.registrationStart = draft.registrationStart;
  form.registrationEnd = draft.registrationEnd;
  form.qrEnabled = draft.qrEnabled;
  form.allowCancel = draft.allowCancel;
  fields.value = draft.fields.map((field) => ({
    title: field.title,
    type: field.type,
    required: field.required,
    options: [...field.options],
  }));
}

function currentDraft(): ExhibitionDraft {
  return {
    title: form.title,
    venue: form.venue,
    date: form.date,
    time: form.time,
    status: form.status,
    category: form.category,
    description: form.description,
    imageUri: form.imageUri,
    registrationStart: form.registrationStart,
    registrationEnd: form.registrationEnd,
    qrEnabled: form.qrEnabled,
    allowCancel: form.allowCancel,
    fields: fields.value,
  };
}

/** 新建展会没有要取的数据。从简介页返回时把内存里的稿填回来。 */
async function load(): Promise<void> {
  if (isCreate.value) {
    built.value = true;
    return;
  }
  const data = await detail.run(async () => {
    const result = await api.exhibitions.get(exhibitionId.value);
    if (result.exhibition?.description) await loadMarkdownParser();
    return result;
  });
  if (!data || data.found === false) return;
  if (built.value) return;
  built.value = true;
  fillFrom(data.exhibition ?? {}, data);
}

if (isCreate.value) {
  const draft = readExhibitionDraft();
  if (draft) applyDraft(draft);
  built.value = true;
}

onMounted(() => {
  if (!built.value) void load();
});

/** 离开新建页时丢掉内存稿。去简介编辑器除外，否则返回后填不回表单。 */
onBeforeRouteLeave((to) => {
  if (!isCreate.value || to.path === '/rich-editor') return;
  clearExhibitionDraft();
});

// ── 封面 ─────────────────────────────────────────────────────────

/** 封面先在设备上选择，再上传到服务器，表单里只留服务器地址。 */
async function pickCover(): Promise<void> {
  try {
    const stored = await device.importMedia('image');
    if (!stored?.url) {
      toast(t('admin.media.unreadableImage'), 'error');
      return;
    }
    form.imageUri = await publishImportedMedia('image', stored);
    toast(stored.compressed ? t('exhibition.form.coverCompressed') : t('exhibition.form.coverUploaded'), 'success');
  } catch (reason) {
    // 用户在系统选择器点了取消：按稳定错误码判断，不匹配文案。
    if (isCancelled(reason)) return;
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function removeCover(): void {
  form.imageUri = '';
}

// ── 报名方式 / 简介 / 二维码 / 删除 ──────────────────────────────

/**
 * 切换报名方式。
 *
 * 三个选项直接摆在页面里（分段控件），不再弹抽屉：选项本身就是全部信息，
 * 多一层面板只会让「改一个开关」变成两次点击。已保存的展会立即写库，
 * 新建时随保存一起提交。
 */
async function changeMode(value: string): Promise<void> {
  if (value === form.status) return;
  form.status = value;
  if (!isCreate.value) await saveStatusOnly();
}

/** 只提交报名方式（状态），保存后停留在当前页，不打断展商的编辑。 */
async function saveStatusOnly(): Promise<void> {
  try {
    const saved = await api.exhibitions.save(buildPayload());
    if (saved?.ok !== true) {
      toast(String(saved?.error || t('exhibition.form.modeSaveFailed')), 'error');
      return;
    }
    toast(t('exhibition.form.modeUpdated'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

function editDescription(): void {
  const id = createdId.value || exhibitionId.value;
  if (!id) {
    stashExhibitionDraft(currentDraft());
    void router.push('/rich-editor?draft=1');
    return;
  }
  void router.push(`/rich-editor?id=${encodeURIComponent(id)}`);
}

function askDelete(): void {
  confirmSheet({
    title: t('exhibition.form.deleteExhibition'),
    message: t('exhibition.form.deleteConfirm', {
      title: form.title || t('exhibition.form.thisExhibition'),
    }),
    confirmLabel: t('common.delete'),
    tone: 'danger',
    onConfirm: async () => {
      try {
        // 写接口统一返回 { ok, error }，只判断响应本身会把失败当成成功。
        const result = await api.exhibitions.remove(exhibitionId.value);
        const ok = result?.ok === true;
        toast(
          String(ok ? t('exhibition.form.deleted') : result?.error || t('exhibition.form.deleteFailed')),
          ok ? 'success' : 'error',
        );
        if (ok) await router.replace('/exhibitor');
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

// ── 保存 ─────────────────────────────────────────────────────────

/** 组装保存用的 payload，「保存」与「报名方式」即时写库共用同一份结构。 */
function buildPayload(): JsonObject {
  return {
    id: createdId.value || exhibitionId.value,
    title: form.title.trim(),
    venue: form.venue.trim(),
    date: form.date,
    day: Number(form.date.slice(8, 10)) || 0,
    time: form.time.trim(),
    status: form.status,
    category: form.category.trim(),
    description: form.description,
    descriptionFormat: 'md',
    imageUri: form.imageUri,
    registrationStart: form.registrationStart,
    registrationEnd: form.registrationEnd,
    qrEnabled: form.qrEnabled,
    allowCancel: form.allowCancel,
    // 空选项不下发，避免保存出无意义的选项条目。
    fields: fields.value
      .filter((item) => item.title.trim() !== '')
      .map((item) => ({
        title: item.title.trim(),
        type: item.type,
        required: item.required,
        options: item.type === FIELD_TYPE.TEXT ? [] : item.options.map((option) => option.trim()).filter(Boolean),
      })),
  };
}

async function submit(): Promise<void> {
  if (saving.value) return;
  if (failFirst()) return;
  saving.value = true;
  try {
    const saved = await api.exhibitions.save(buildPayload());
    if (saved?.ok !== true) {
      formError.value = String(saved?.error || t('exhibition.form.saveFailed'));
      toast(formError.value, 'error');
      return;
    }
    const exhibition = (saved.exhibition ?? {}) as JsonObject;
    createdId.value = String(exhibition.id ?? createdId.value);
    form.description = String(exhibition.description ?? form.description);
    form.imageUri = String(exhibition.imageUri ?? form.imageUri);
    toast(isCreate.value ? t('exhibition.form.created') : t('exhibition.form.saved'), 'success');
    clearExhibitionDraft();
    // 新建成功后换成编辑地址：再点保存就是更新，删除按钮也出现。
    if (isCreate.value) await router.replace(`/exhibition-form/${encodeURIComponent(createdId.value)}`);
    else await router.replace('/exhibitor');
  } catch (reason) {
    formError.value = reason instanceof Error ? reason.message : String(reason);
    toast(formError.value, 'error');
  } finally {
    saving.value = false;
  }
}

function isCancelled(reason: unknown): boolean {
  return Boolean(reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled');
}

/** 选项来源兼容字符串（逗号分隔）与数组，模型内统一为数组。 */
function normalizeOptions(options: unknown): string[] {
  if (Array.isArray(options)) return options.map((item) => String(item));
  return String(options || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
</script>

<template>
  <!-- 受限账号：后端对展会写操作一律 403，深链也绕不过去，整页顶掉不给填了存不下的表单 -->
  <StateBlock
    v-if="limited"
    icon="briefcase"
    tone="error"
    :title="isCreate ? t('exhibition.form.publishBlocked') : t('exhibition.form.editBlocked')"
    :description="t('exhibition.form.restrictedAccount')"
    :action-label="t('exhibition.form.backToExhibitor')"
    @action="router.replace('/exhibitor')"
  />

  <SkeletonBlock v-else-if="detail.loading.value && !detail.data.value" :rows="4" />

  <StateBlock
    v-else-if="loadFailed"
    tone="error"
    :title="t('common.loadFailed')"
    :description="detail.error.value?.message"
    :action-label="t('common.retry')"
    @action="load"
  />

  <StateBlock
    v-else-if="notFound"
    tone="error"
    :title="t('exhibition.detail.notFound')"
    :description="String(detail.data.value?.error || t('exhibition.form.loadInfoFailed'))"
    :action-label="t('exhibition.form.backToExhibitor')"
    @action="router.replace('/exhibitor')"
  />

  <template v-else-if="built">
    <div class="form">
      <div class="field" :data-invalid="isInvalid('title') ? 'true' : 'false'">
        <label for="form-title"
          >{{ t('admin.limits.exhibitionName') }}<span class="required" aria-hidden="true"> *</span></label
        >
        <input
          id="form-title"
          v-model="form.title"
          class="input"
          type="text"
          :placeholder="t('exhibition.form.titlePlaceholder')"
          :maxlength="limit('exhibitionTitle', 60)"
        />
      </div>
      <div class="field" :data-invalid="isInvalid('venue') ? 'true' : 'false'">
        <label for="form-venue"
          >{{ t('admin.exhibitions.venue') }}<span class="required" aria-hidden="true"> *</span></label
        >
        <input
          id="form-venue"
          v-model="form.venue"
          class="input"
          type="text"
          :placeholder="t('exhibition.form.venuePlaceholder')"
          :maxlength="limit('exhibitionVenue', 60)"
        />
      </div>

      <!-- 开展日期｜开展时间：宽屏两列、窄屏自动落成一行，避免原生日期控件截字。
           开展时间内部是两个系统时间选择框，中间一横把起止分开，值仍写回 form.time。 -->
      <div class="form-pair">
        <div class="field" :data-invalid="isInvalid('date') ? 'true' : 'false'">
          <label for="form-date"
            >{{ t('exhibition.form.openDate') }}<span class="required" aria-hidden="true"> *</span></label
          >
          <input id="form-date" v-model="form.date" class="input" type="date" />
          <p v-if="isInvalid('date')" class="field-error" role="alert">{{ formError }}</p>
        </div>
        <div class="field" :data-invalid="isInvalid('time') ? 'true' : 'false'">
          <label for="form-time">{{ t('exhibition.form.openTime') }}</label>
          <div class="time-range">
            <input
              id="form-time"
              v-model="timeStart"
              class="input"
              type="time"
              step="60"
              :aria-label="t('exhibition.form.openTime')"
            />
            <span class="time-sep" aria-hidden="true">–</span>
            <input
              id="form-time-end"
              v-model="timeEnd"
              class="input"
              type="time"
              step="60"
              :aria-label="t('exhibition.form.openTime')"
            />
          </div>
          <p v-if="isInvalid('time')" class="field-error" role="alert">{{ formError }}</p>
        </div>
      </div>

      <div class="grid-cols-2">
        <div class="field" :data-invalid="isInvalid('registrationStart') ? 'true' : 'false'">
          <label for="form-reg-start">{{ t('exhibition.form.registrationOpens') }}</label>
          <input id="form-reg-start" v-model="form.registrationStart" class="input" type="date" />
          <p v-if="isInvalid('registrationStart')" class="field-error" role="alert">{{ formError }}</p>
        </div>
        <div class="field" :data-invalid="isInvalid('registrationEnd') ? 'true' : 'false'">
          <label for="form-reg-end">{{ t('exhibition.form.registrationCloses') }}</label>
          <input id="form-reg-end" v-model="form.registrationEnd" class="input" type="date" />
          <p v-if="isInvalid('registrationEnd')" class="field-error" role="alert">{{ formError }}</p>
        </div>
      </div>

      <!-- 分类是管理员在「管理后台-设置」里维护的清单：一行可点的字段，点开抽屉选值 -->
      <div class="field" :data-invalid="isInvalid('category') ? 'true' : 'false'">
        <span id="form-category-label" class="field-label">{{ t('admin.limits.category') }}</span>
        <button
          id="form-category"
          class="input category-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-labelledby="form-category-label"
          @click="openCategorySheet"
        >
          <span class="category-value" :data-empty="form.category ? 'false' : 'true'">{{
            form.category || categoryPlaceholder
          }}</span>
          <AppIcon name="chevronDown" size="icon icon-sm" />
        </button>
        <p v-if="isInvalid('category')" class="field-error" role="alert">{{ formError }}</p>
      </div>

      <p v-if="formError && !invalidField" class="field-error" role="alert">{{ formError }}</p>
      <p v-if="isInvalid('fields')" class="field-error" role="alert">{{ formError }}</p>
    </div>

    <!-- 封面：1080×1920 竖版，左侧预览、右侧上传 / 更换 / 移除与格式说明 -->
    <div class="card">
      <span class="section-label">{{ t('exhibition.form.cover') }}</span>
      <div class="cover-row">
        <div v-if="form.imageUri" class="cover-frame ph-img">
          <img :src="form.imageUri" :alt="t('exhibition.form.cover')" />
        </div>
        <div v-else class="cover-frame ph-img" aria-hidden="true" />
        <div class="cover-side">
          <button class="cta ghost" data-size="small" type="button" @click="pickCover">
            {{ form.imageUri ? t('admin.media.changeCover') : t('admin.media.uploadCover') }}
          </button>
          <button v-if="form.imageUri" class="cta ghost" data-size="small" type="button" @click="removeCover">
            {{ t('admin.media.removeCover') }}
          </button>
          <p class="field-hint">1080 × 1920</p>
          <p class="field-hint">{{ formatHint }}</p>
        </div>
      </div>
    </div>

    <!-- 报名与简介设置：报名方式是三个互斥分段按钮，简介收在这一栏 -->
    <div class="card">
      <span class="section-label">{{ t('exhibition.form.registrationSettings') }}</span>
      <div class="field">
        <span class="field-label">{{ t('exhibition.form.registrationMode') }}</span>
        <SegControl
          :model-value="form.status"
          :items="MODES"
          :label="t('exhibition.form.registrationMode')"
          @update:model-value="changeMode"
        />
      </div>
      <hr class="divider" />
      <div class="stack" data-gap="sm">
        <!-- 不再重复「展会简介」小标题：这一栏的「报名与简介设置」已经说明了用途，
             按钮本身就是入口，左边留标题只会让这一行更挤。 -->
        <div class="row">
          <button class="cta ghost" data-size="small" type="button" @click="editDescription">
            {{ t('exhibition.form.editDescription') }}
          </button>
        </div>
        <p class="row-meta clamp-2">{{ descriptionSummary }}</p>
      </div>
      <hr class="divider" />
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ t('exhibition.form.enableCheckInQr') }}</strong>
          <span class="row-meta">{{ t('exhibition.form.checkInQrExplainer') }}</span>
        </span>
        <label class="switch" for="form-qr-enabled">
          <input id="form-qr-enabled" v-model="form.qrEnabled" type="checkbox" />
          <span />
        </label>
      </div>
      <p class="field-hint">{{ qrHint }}</p>
      <hr class="divider" />
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ allowCancelLabel }}</strong>
          <span class="row-meta">{{ allowCancelHint }}</span>
        </span>
        <label class="switch" for="form-allow-cancel">
          <input id="form-allow-cancel" v-model="form.allowCancel" type="checkbox" />
          <span />
        </label>
      </div>
    </div>

    <!-- 报名收集项：与私人会议设置共用同一张卡，样式保持一致 -->
    <CollectFieldsCard
      :fields="fields"
      :label="t('exhibition.form.collectFields')"
      :title-max="limit('fieldTitle', 30)"
      :radio-max="limit('radioOption', 60)"
      :check-max="limit('checkOption', 60)"
    />

    <!-- 删除放在内容最下，保存仍固定在页脚。新建还没有展会，按钮不可点。 -->
    <div class="card danger-zone">
      <span class="section-label">{{ t('exhibition.form.dangerZone') }}</span>
      <button class="cta danger" type="button" :disabled="isCreate" @click="askDelete">
        {{ isCreate ? t('exhibition.form.deleteAfterSave') : t('exhibition.form.deleteExhibition') }}
      </button>
    </div>
  </template>

  <!-- 底部固定保存区：保存后可在详情页确认展示效果 -->
  <Teleport v-if="built && !limited && !loadFailed && !notFound" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <button class="cta" type="button" :disabled="saving" :data-loading="saving ? 'true' : 'false'" @click="submit">
          {{ isCreate ? t('exhibition.form.createExhibition') : t('exhibition.form.saveExhibition') }}
        </button>
        <p class="field-hint text-center">{{ t('exhibition.form.confirmOnDetail') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 只作用于本页自己的类名：卡片内距由外壳与 .card 给，这里不再补左右 padding。 */
.clamp-2 {
  -webkit-line-clamp: 2;
}

/* 表单列宽跟容器走：隐式 auto 轨道会被子项的 max-content 撑宽，320 宽时会横向溢出。 */
.form {
  grid-template-columns: minmax(0, 1fr);
}

/* 开展日期｜开展时间：宽屏两列、窄屏自动落成一行（原生日期控件窄于一列会截字）。 */
.form-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--s4);
}

/* 开展时间：开始 – 结束两个系统时间选择框，共用一条基线。 */
.time-range {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

.time-range .input {
  flex: 1 1 0;
  min-width: 0;
}

.time-sep {
  flex: none;
  color: var(--ink-3);
  font-size: var(--fs-meta);
}

/* 分类字段：借用 .input 的外观（下划线随底座走），只补布局：文字靠左、chevron 靠右。 */
.category-trigger {
  justify-content: space-between;
  gap: var(--s2);
  text-align: start;
}

.category-trigger svg {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
}

.category-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 还没选：按占位文字的层级弱化一档。 */
.category-value[data-empty='true'] {
  color: var(--ink-3);
}

/* 封面：左 96×170 竖版预览，右边竖排两颗次按钮与两行格式说明；窄屏上下堆叠。 */
.cover-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--s4);
}

.cover-frame {
  flex: 0 0 96px;
  width: 96px;
  aspect-ratio: 1080 / 1920;
  border-radius: var(--r-card);
}

.cover-side {
  flex: 1 1 150px;
  min-width: 0;
  display: grid;
  gap: var(--s2);
  align-content: start;
}

.cover-side .cta {
  width: 100%;
}

.cover-side .field-hint {
  margin: 0;
}

/* 危险区：卡片不变，只有标题与小色条换成砖红，不整框染色。 */
.danger-zone .section-label,
.danger-zone .section-label::before {
  color: var(--danger-ink);
}

.danger-zone .section-label::before {
  background: var(--danger-ink);
}
</style>
