<script setup lang="ts">
/**
 * 屏幕 11 · 展会编辑（新建 / 编辑）
 *
 * 展商后台卡片上的「报名方式」「编辑简介」收进本页：「报名方式」在「报名设置」卡里，
 * 简介与「参与方式」并进「活动信息」卡（封面、纯文本简介、Markdown 编辑入口）。
 * 日期与时间都走应用内抽屉：
 * 开展 / 闭展、报名开始 / 截止各是一组日期范围，开展时间是两个时 / 分滚轮。
 * 「删除展会」放在页面内容最下方。新建与编辑共用同一页：
 * 路由带 `:id` 就是编辑（先取详情），不带就是新建（空表单），保存成功后换成编辑地址。
 * 管理员在编辑页最下方还多一张「展会归属」卡：按用户邮箱把这场展会交给另一个账号。
 *
 * 内存稿与未保存提示：去「使用Markdown编辑简介」的二级页时把整张表单 stash 成内存稿，
 * 回来时按 id 恢复（编辑已有展会也一样，二级页保存简介后其他未保存字段不会丢）；
 * 离开本页（去二级页除外）前用「已保存基线」判断有没有未保存修改，有就弹「保存 / 不保存 / 取消」。
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
import { openDateRange, openTime } from '@/services/pickers';
import { formatDateWithWeekday } from '@/services/format';
import { PATTERNS, allowedFormats, check, limit, validateAll } from '@/services/validate';
import { EXHIBITION_STATUS, REGISTRATION_MODES, exhibitionStatusLabel } from '@/services/status';
import { canManageExhibition } from '@/services/exhibition-scope';
import { device } from '@/services/device-services';
import { publishImportedMedia } from '@/services/publish-media';
import { useExhibitionOwnerTransfer } from '@/composables/useExhibitionOwnerTransfer';
import CollectFieldsCard, { type CollectField } from '@/components/CollectFieldsCard.vue';
import { firstCollectFieldError } from '@/services/collect-fields';
import {
  emptyExhibitionFormModel,
  exhibitionContentFromDraft,
  exhibitionContentFromServer,
  submittedExhibitionData,
  type ExhibitionFormContent,
  type ExhibitionFormModel,
} from '@/services/exhibition-form-model';
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
import UploadProgressMask from '@/components/upload-progress-mask.vue';
import type { ExhibitionDetail, JsonObject } from '@/api/types';
import { t } from '@/i18n';

const MODES = REGISTRATION_MODES.map((value) => ({ value, label: exhibitionStatusLabel(value) }));
/** 分类下拉的占位项：清单由管理员维护，这里只提示「还没选」。 */
const categoryPlaceholder = t('exhibition.form.chooseCategory');

const route = useRoute();
const router = useRouter();
const bootstrap = useBootstrapStore();
/** 单个展会最长持续天数（管理-设置 → 展商相关）；0 表示不限。 */
const maxExhibitionDays = computed(() => Math.max(0, Math.trunc(Number(bootstrap.exhibitor.maxExhibitionDays) || 0)));
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

const form = reactive<ExhibitionFormModel>(emptyExhibitionFormModel());
const fields = ref<CollectField[]>([]);

// ── 未保存修改：已保存基线 ───────────────────────────────────────

/**
 * 「已保存」基线：最近一次取数成功或保存成功时的提交字段快照（JSON 字符串）。
 * 当前快照与它不一致，就说明表单里有未保存的修改（路由守卫据此弹抽屉）。
 * 空串表示编辑页首屏数据还没回来，此时不提示。
 */
const baseline = ref('');

/** 当前表单内容的快照。 */
function currentSnapshot(): string {
  return JSON.stringify(submittedExhibitionData(form, fields.value));
}

/** 记下新的「已保存」基线：首屏取数、保存、报名方式即时保存之后调用。 */
function markSaved(content?: ExhibitionFormContent): void {
  const target = content ?? { model: form, fields: fields.value };
  baseline.value = JSON.stringify(submittedExhibitionData(target.model, target.fields));
}

/** 有没有未保存的修改。 */
function isDirty(): boolean {
  return baseline.value !== '' && currentSnapshot() !== baseline.value;
}

// ── 开展时间：两个时间滚轮 ───────────────────────────────────────

/**
 * 数据仍只有 `form.time` 一个字段（`HH:MM-HH:MM`），界面上拆成开始 / 结束两个滚轮：
 * 两个都填了才拼成区间；只填一个或都不填时提交空串（时间选填），
 * 提交的接口字段名与校验规则都不变。
 */
const timeStart = ref('');
const timeEnd = ref('');
/** 拆分写回时防止两个 watch 互相触发。 */
let composingTime = false;

/** 把 `9:00` 补成 `09:00`：历史数据可能没补零，拼区间前统一成两位小时。 */
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

/** `form.time` 是唯一数据源：取数或回填草稿后，把两个时间滚轮同步过来。 */
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

// ── 日期 / 时间抽屉 ──────────────────────────────────────────────

/** 开展与闭展共用一组日期范围：点任意一侧都从同一段区间开始选，选完一起回填。 */
function openExhibitionDateRange(): void {
  openDateRange({
    start: form.date,
    end: form.endDate,
    startLabel: t('exhibition.form.openDateShort'),
    endLabel: t('exhibition.form.endDateShort'),
    onChange: ({ start, end }) => {
      form.date = start;
      // 第二次点的是同一天也照原样回填：两个框都显示这一天，展示侧只显示一天。
      form.endDate = end;
    },
  });
}

/** 报名开始 / 截止同样是一组日期范围；两项都可留空，清空即表示不设报名窗口。 */
function openRegistrationDateRange(): void {
  openDateRange({
    start: form.registrationStart,
    end: form.registrationEnd,
    startLabel: t('exhibition.form.registrationStartShort'),
    endLabel: t('exhibition.form.registrationEndShort'),
    onChange: ({ start, end }) => {
      form.registrationStart = start;
      form.registrationEnd = end;
    },
  });
}

/** 开展时间的两端各开一个滚轮；留空仍表示不填。 */
function openStartTime(): void {
  openTime({
    value: timeStart.value,
    fallback: '09:00',
    onConfirm: (value) => {
      timeStart.value = value;
    },
    onClear: () => {
      timeStart.value = '';
    },
  });
}

function openEndTime(): void {
  openTime({
    value: timeEnd.value,
    fallback: '17:00',
    onConfirm: (value) => {
      timeEnd.value = value;
    },
    onClear: () => {
      timeEnd.value = '';
    },
  });
}

/** 触发按钮上的日期文案：与详情页一致，用「11月17日（周二）」这种简短写法。 */
const dateText = computed(() => formatDateWithWeekday(form.date));
const endDateText = computed(() => formatDateWithWeekday(form.endDate));
const registrationStartText = computed(() => formatDateWithWeekday(form.registrationStart));
const registrationEndText = computed(() => formatDateWithWeekday(form.registrationEnd));
/** 发布检查里的展期：闭展为空或与开展同一天都是单日展会，不补多余的分隔符。 */
const dateRangeText = computed(() =>
  endDateText.value && endDateText.value !== dateText.value
    ? `${dateText.value} – ${endDateText.value}`
    : dateText.value,
);
/** 报名窗口：只填了一端时只显示那一端，两端都空时整行不渲染。 */
const registrationWindowText = computed(() => {
  if (!registrationStartText.value && !registrationEndText.value) return '';
  return `${registrationStartText.value || '—'}${registrationEndText.value ? ` – ${registrationEndText.value}` : ''}`;
});
/** 发布检查里的收集项数量：标题为空的行不会进 payload，计数要与提交同口径。 */
const submittedFieldCount = computed(() => fields.value.filter((field) => field.title.trim() !== '').length);

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
const createStep = ref(1);

// ── 封面 / 报名方式的可变展示 ────────────────────────────────────

/** 允许的图片后缀：管理员在「管理-设置」里配置，缺省时给一句常见格式。 */
const formatHint = computed(() => {
  const list = allowedFormats('image');
  return list.length > 0 ? list.map((item) => `.${item}`).join('/') : t('exhibition.form.commonImageFormats');
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
      'endDate',
      () =>
        check(form.endDate, {
          label: t('exhibition.form.endDate'),
          pattern: PATTERNS.date,
          custom: () => {
            if (form.endDate && form.date && form.endDate < form.date) return t('exhibition.form.endBeforeStart');
            if (maxExhibitionDays.value > 0 && form.date && form.endDate) {
              const start = Date.parse(`${form.date}T00:00:00Z`);
              const end = Date.parse(`${form.endDate}T00:00:00Z`);
              const days = Math.round((end - start) / 86_400_000) + 1;
              if (Number.isFinite(days) && days > maxExhibitionDays.value) {
                return t('exhibition.form.durationTooLong', { max: maxExhibitionDays.value });
              }
            }
            return '';
          },
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
      'registrationNotice',
      () =>
        check(form.registrationNotice, {
          label: t('exhibition.form.noticeLabel'),
          max: 2000,
        }),
    ],
    [
      'category',
      () =>
        form.category.trim()
          ? check(form.category, {
              label: t('admin.limits.category'),
              max: limit('category', 20),
              pattern: PATTERNS.category,
              patternMessage: t('exhibition.form.categoryCharacters'),
            })
          : t('exhibition.form.categoryRequired'),
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

/**
 * 新建展会的三步：基本信息 → 报名配置 → 发布检查。
 * 每一步只校验这一步能看到的字段（「参与方式」在第一步的活动信息卡里，跟着第一步校验），
 * 通过才前进；失败的字段在原位标红并给一次轻提示。编辑已有展会不走这里。
 */
const createSteps = [1, 2, 3];
const CREATE_STEP_FIELDS: Record<number, string[]> = {
  1: ['title', 'venue', 'date', 'endDate', 'time', 'category', 'registrationNotice'],
  2: ['registrationEnd', 'registrationStart'],
};

function validateCreateStep(step: number): boolean {
  const names = CREATE_STEP_FIELDS[step] ?? [];
  const checks = fieldChecks().filter(([name]) => names.includes(name));
  const result = validateAll(checks.map(([, run]) => run));
  invalidField.value = '';
  if (!result.ok) {
    invalidField.value = checks[result.index]?.[0] ?? '';
    formError.value = result.message;
    toast(result.message, 'error');
    return false;
  }
  if (step === 2) {
    const fieldMessage = firstCollectFieldError(fields.value, {
      title: limit('fieldTitle', 30),
      radio: limit('radioOption', 60),
      check: limit('checkOption', 60),
    });
    if (fieldMessage) {
      formError.value = fieldMessage;
      invalidField.value = 'fields';
      toast(fieldMessage, 'error');
      return false;
    }
  }
  formError.value = '';
  return true;
}

/** 继续：只校验当前这一步，通过后进下一步。 */
function advanceCreateStep(): void {
  if (!validateCreateStep(createStep.value)) return;
  createStep.value = Math.min(createSteps.length, createStep.value + 1);
}

/** 返回上一步：切步骤时清掉上一步留下的错误，值与其他编辑状态都还在。 */
function retreatCreateStep(): void {
  if (createStep.value <= 1) return;
  createStep.value -= 1;
  invalidField.value = '';
  formError.value = '';
}

/**
 * 发布前把三步再校一遍（中途可能返回改过前面的字段）：失败就退回那一步，
 * 红框与说明才看得见。编辑页仍用整表校验，不受这条影响。
 */
function validateCreateSteps(): boolean {
  for (const step of [1, 2]) {
    if (validateCreateStep(step)) continue;
    createStep.value = step;
    return false;
  }
  return true;
}

/** 校验失败的字段属于哪一步：报名窗口与收集项在第二步，其余都在第一步。 */
function createStepForField(name: string): number {
  return name === 'fields' || name === 'registrationEnd' || name === 'registrationStart' ? 2 : 1;
}

/** 该字段是否处于「校验未通过」：红框 + 说明，不再依赖全局错误条。 */
function isInvalid(name: string): boolean {
  return invalidField.value === name;
}

// ── 取数 ─────────────────────────────────────────────────────────

/** 把一份内容落到响应式表单上（首屏取数与内存稿回填共用）。 */
function fillContent(content: ExhibitionFormContent): void {
  Object.assign(form, content.model);
  fields.value = content.fields;
}

function currentDraft(): ExhibitionDraft {
  return {
    id: createdId.value || exhibitionId.value,
    title: form.title,
    venue: form.venue,
    date: form.date,
    endDate: form.endDate,
    time: form.time,
    status: form.status,
    category: form.category,
    description: form.description,
    imageUri: form.imageUri,
    registrationStart: form.registrationStart,
    registrationEnd: form.registrationEnd,
    qrEnabled: form.qrEnabled,
    allowCancel: form.allowCancel,
    registrationNotice: form.registrationNotice,
    fields: fields.value,
  };
}

/** 新建展会没有要取的数据；编辑页取数既填表单，也拍下「已保存」基线。 */
async function load(): Promise<void> {
  if (isCreate.value) return;
  const data = await detail.run(() => api.exhibitions.get(exhibitionId.value));
  if (!data || data.found === false) return;
  if (!canManageExhibition(session.user, data.exhibition)) {
    toast(t('server.permission.exhibitionNotYours'), 'error');
    // 归属不对要退回展商后台：这次离开不是用户放弃编辑，不再弹未保存提示。
    allowLeave = true;
    await router.replace('/exhibitor');
    return;
  }
  const content = exhibitionContentFromServer(data.exhibition ?? {}, data);
  // 归属人昵称直接取详情里的展商名；改归属成功后就地更新，不为了这一行重载整张表单
  // （重载会把「已保存」基线按服务器内容重拍，未保存的修改就丢了）。
  setCurrentOwner(String(data.exhibition?.exhibitor ?? ''));
  // 有内存稿时表单已经被它填好（未保存的修改比服务器新），这里只补基线，不能再盖回去。
  markSaved(content);
  if (built.value) return;
  built.value = true;
  fillContent(content);
}

/** 当前表单的内存稿：新建稿 id 为空串，编辑稿 id 是这场展会。 */
function currentDraftId(): string {
  return createdId.value || exhibitionId.value;
}

/** 内存稿只属于这张表单：id 对不上（别的展会 / 上一次没清干净的稿）就不采用。 */
function matchingDraft(): ExhibitionDraft | null {
  const draft = readExhibitionDraft();
  return draft && (draft.id ?? '') === currentDraftId() ? draft : null;
}

// 首屏：新建表单本来就是空的，空表单即「已保存」基线；从简介编辑器返回时把内存稿填回来，
// 草稿算未保存修改，不能当基线。编辑页先用内存稿恢复整张表单，「已保存」基线等详情回来再拍。
const restoredDraft = matchingDraft();
if (isCreate.value) {
  built.value = true;
  markSaved();
  if (restoredDraft) fillContent(exhibitionContentFromDraft(restoredDraft));
} else if (restoredDraft) {
  built.value = true;
  fillContent(exhibitionContentFromDraft(restoredDraft));
}

onMounted(() => {
  // 还没有基线就取数：新建页不用取，编辑页取回来当基线。
  if (baseline.value === '') void load();
});

// ── 未保存修改：路由守卫与三选一提示 ────────────────────────────

/** 一次性放行：保存成功 / 不保存 / 删除成功 / 权限退回时由页面自己发起导航，守卫不能再拦。 */
let allowLeave = false;

/** 受限、加载失败、不存在这几种状态整页是提示块，没有可保存的表单，不拦。 */
function shouldWarnUnsaved(): boolean {
  return built.value && !limited.value && !loadFailed.value && !notFound.value && isDirty();
}

/** 放行一次导航：先置标记再跳转，守卫看到标记就直接通过。 */
function leaveTo(target: string): void {
  allowLeave = true;
  void router.replace(target);
}

/** 弹「保存 / 不保存 / 取消」：目标路由就是被取消掉的这次导航。 */
function askUnsaved(target: string): void {
  openSheet({
    title: t('exhibition.form.unsavedTitle'),
    message: t('exhibition.form.unsavedMessage'),
    // 三颗按钮横向一行：文案都很短，并排一屏放得下，也让选择动作更顺手。
    layout: 'row',
    actions: [
      {
        label: t('common.save'),
        variant: 'primary',
        onClick: async (close) => {
          close();
          // 校验与错误提示沿用保存按钮那一套：失败就留在本页，抽屉不弹第二次。
          if (await persist()) {
            leaveTo(target);
            return;
          }
          // 新建流程里把出错字段所在的那一步亮出来，否则红框会被收在看不见的那一步。
          // 接口失败没有具体字段（invalidField 为空），停在第 3 步原位显示错误即可。
          if (isCreate.value && invalidField.value) createStep.value = createStepForField(invalidField.value);
        },
      },
      {
        label: t('exhibition.form.unsavedDiscard'),
        variant: 'danger',
        onClick: (close) => {
          close();
          clearExhibitionDraft();
          leaveTo(target);
        },
      },
      {
        label: t('common.cancel'),
        onClick: (close) => close(),
      },
    ],
  });
}

/**
 * 离开表单页的守卫。
 *
 * - 去 Markdown 简介编辑器是同一份草稿流程，不算离开：不清草稿、不弹提示；
 * - 真的离开且表单有未保存修改时，先取消这次导航，弹抽屉让用户选；
 * - 其余情况（没有改动 / 受限 / 加载失败 / 不存在 / 页面自己发起的跳转）放行并清掉内存稿。
 *
 * 浏览器返回与顶部返回键走的都是路由导航，因此同样会被这里拦下。
 */
onBeforeRouteLeave((to) => {
  if (to.path === '/rich-editor') return;
  if (allowLeave) {
    allowLeave = false;
    return;
  }
  if (!shouldWarnUnsaved()) {
    clearExhibitionDraft();
    return;
  }
  askUnsaved(to.fullPath);
  return false;
});

// ── 封面 ─────────────────────────────────────────────────────────

/** 上传中（含系统选择器停留期间）：按钮禁用，避免同时开两份上传。 */
const coverBusy = ref(false);
/** 封面位置上的进度遮罩；null 表示没有上传在跑（遮罩随之卸载）。 */
const coverProgress = ref<number | null>(null);
/**
 * 上传期间先占住封面槽位的本机副本。
 *
 * 遮罩是「由下至上变亮」：已经上传的那一段透出的必须是用户刚选的那张图，
 * 而不是上一次的封面或占位图。服务器返回地址后（或失败 / 取消时）立刻清空，
 * 槽位回到 `form.imageUri`。
 */
const coverPreview = ref('');

/**
 * 封面先在设备上选择，再上传到服务器，表单里只留服务器地址。
 * 上传期间在封面位置盖进度遮罩：字节发完只到 99%，服务器确认后落 100 并停留约 150ms
 * （由遮罩的 settled 通知卸载），成功换成新图，失败 / 取消立即复位。
 */
async function pickCover(): Promise<void> {
  if (coverBusy.value) return;
  coverBusy.value = true;
  try {
    const stored = await device.importMedia('image');
    if (!stored?.url) {
      toast(t('admin.media.unreadableImage'), 'error');
      return;
    }
    coverPreview.value = stored.url;
    coverProgress.value = 0;
    form.imageUri = await publishImportedMedia('image', stored, (percent) => {
      coverProgress.value = Math.min(99, Math.max(0, percent));
    });
    coverProgress.value = 100;
    toast(stored.compressed ? t('exhibition.form.coverCompressed') : t('exhibition.form.coverUploaded'), 'success');
  } catch (reason) {
    // 失败 / 取消都先撤掉遮罩，不让它停在半路；取消是用户自己的操作，不提示错误。
    coverProgress.value = null;
    if (isCancelled(reason)) return;
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    // 本机副本由 publishImportedMedia 在上传结束时删掉 / 收回，这里只把槽位交还给表单地址。
    coverPreview.value = '';
    coverBusy.value = false;
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
    // 这一下提交的是整份 payload：当前内容（包括刚切换的报名方式）已经落库，就是新基线。
    markSaved();
    toast(t('exhibition.form.modeUpdated'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  }
}

/**
 * 进 Markdown 编辑器。两种情况都先把当前表单（含纯文本简介）存成内存稿：
 * 编辑已有展会时二级页从这份稿起稿，textarea 里刚写、还没保存的正文不会丢。
 */
function editDescription(): void {
  const id = createdId.value || exhibitionId.value;
  stashExhibitionDraft(currentDraft());
  if (!id) {
    void router.push('/rich-editor?draft=1');
    return;
  }
  void router.push(`/rich-editor?id=${encodeURIComponent(id)}&draft=1`);
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
        if (ok) {
          // 展会已经删掉：这次离开不是放弃编辑，不弹未保存提示。
          clearExhibitionDraft();
          allowLeave = true;
          await router.replace('/exhibitor');
        }
      } catch (reason) {
        toast(reason instanceof Error ? reason.message : String(reason), 'error');
      }
    },
  });
}

// ── 展会归属（仅管理员） ────────────────────────────────────────

/**
 * 归属卡只在「编辑已有展会 + 管理员」时出现：
 * 新建还没有展会、展商也不能把别人的展会转走。改的是 `exhibitions.exhibitor_id`。
 */
const showOwnerCard = computed(() => !isCreate.value && session.user.can?.admin === true);
const { ownerName, ownerEmail, ownerError, ownerBusy, ownerLabel, setCurrentOwner, askTransferOwner } =
  useExhibitionOwnerTransfer(currentDraftId);

// ── 保存 ─────────────────────────────────────────────────────────

/** 组装保存用的 payload，「保存」与「报名方式」即时写库共用同一份结构。 */
function buildPayload(): JsonObject {
  return {
    id: createdId.value || exhibitionId.value,
    ...submittedExhibitionData(form, fields.value),
    day: Number(form.date.slice(8, 10)) || 0,
  };
}

/**
 * 校验并保存整份表单；成功返回 true 并把基线推到当前内容，失败留在本页（原位报错 + 轻提示）。
 *
 * 保存按钮、未保存提示里的「保存」与「报名方式」即时保存共用同一套校验与错误提示。
 * 保存中再次触发直接返回 false，既防重复提交，也避免抽屉里连点两次跳两次。
 */
async function persist(): Promise<boolean> {
  if (saving.value) return false;
  if (failFirst()) return false;
  saving.value = true;
  try {
    const saved = await api.exhibitions.save(buildPayload());
    if (saved?.ok !== true) {
      formError.value = String(saved?.error || t('exhibition.form.saveFailed'));
      toast(formError.value, 'error');
      return false;
    }
    const exhibition = (saved.exhibition ?? {}) as JsonObject;
    createdId.value = String(exhibition.id ?? createdId.value);
    form.description = String(exhibition.description ?? form.description);
    form.imageUri = String(exhibition.imageUri ?? form.imageUri);
    toast(isCreate.value ? t('exhibition.form.created') : t('exhibition.form.saved'), 'success');
    clearExhibitionDraft();
    // 服务器可能归一化了简介 / 封面地址：基线按落库后的内容拍，不拿提交前的值。
    markSaved();
    return true;
  } catch (reason) {
    formError.value = reason instanceof Error ? reason.message : String(reason);
    toast(formError.value, 'error');
    return false;
  } finally {
    saving.value = false;
  }
}

/**
 * 页脚主按钮：新建时第三步是「发布展会」，先在页面里逐步再校一遍（出错就退回那一步），
 * 再走与编辑页共用的保存；成功后仍换成编辑地址，删除按钮随之后出现。
 */
async function submit(): Promise<void> {
  if (isCreate.value && !validateCreateSteps()) return;
  if (!(await persist())) return;
  // 新建成功后换成编辑地址：再点保存就是更新，删除按钮也出现。
  if (isCreate.value) await router.replace(`/exhibition-form/${encodeURIComponent(createdId.value)}`);
  else await router.replace('/exhibitor');
}

function isCancelled(reason: unknown): boolean {
  return Boolean(reason && typeof reason === 'object' && (reason as { code?: unknown }).code === 'cancelled');
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

  <!-- 有内存稿时表单已经画出来了：补基线的那次取数不再闪骨架屏。 -->
  <SkeletonBlock v-else-if="!built && detail.loading.value && !detail.data.value" :rows="4" />

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
    <!-- 新建展会走三步：进度条说明走到哪了，标题与说明告诉这一步要填什么。
         编辑已有展会不显示这两块，仍是一张张分组卡片。 -->
    <div
      v-if="isCreate"
      class="create-progress"
      role="group"
      :aria-label="t('exhibition.form.stepProgress', { current: createStep })"
    >
      <span
        v-for="step in createSteps"
        :key="step"
        :data-current="step === createStep ? 'true' : 'false'"
        :data-complete="step < createStep ? 'true' : 'false'"
        :aria-current="step === createStep ? 'step' : undefined"
      >
        {{ t(`exhibition.form.step${step}`) }}
      </span>
    </div>

    <div v-if="isCreate" class="stack create-heading" data-gap="sm">
      <h2>{{ t(`exhibition.form.step${createStep}`) }}</h2>
      <p class="field-hint">{{ t(`exhibition.form.stepHint${createStep}`) }}</p>
    </div>

    <div v-if="!isCreate || createStep < 3" class="form">
      <div v-show="!isCreate || createStep === 1" class="field" :data-invalid="isInvalid('title') ? 'true' : 'false'">
        <label for="form-title"
          >{{ t('admin.limits.exhibitionName') }}<span class="required" aria-hidden="true"> *</span></label
        >
        <input
          id="form-title"
          v-model="form.title"
          class="input input-line"
          type="text"
          :placeholder="t('exhibition.form.titlePlaceholder')"
          :maxlength="limit('exhibitionTitle', 60)"
        />
      </div>
      <div v-show="!isCreate || createStep === 1" class="field" :data-invalid="isInvalid('venue') ? 'true' : 'false'">
        <label for="form-venue"
          >{{ t('admin.exhibitions.venue') }}<span class="required" aria-hidden="true"> *</span></label
        >
        <input
          id="form-venue"
          v-model="form.venue"
          class="input input-line"
          type="text"
          :placeholder="t('exhibition.form.venuePlaceholder')"
          :maxlength="limit('exhibitionVenue', 60)"
        />
      </div>

      <!-- 开展 / 闭展是一组日期范围：点任意一侧都打开同一个范围抽屉，选完一起回填。
           闭展可以留空（单日展会），两次点同一天时闭展也回填这一天；「清除」把两个日期一起清掉。 -->
      <div v-show="!isCreate || createStep === 1" class="form-pair">
        <div class="field" :data-invalid="isInvalid('date') ? 'true' : 'false'">
          <span id="form-date-label" class="field-label"
            >{{ t('exhibition.form.openDate') }}<span class="required" aria-hidden="true"> *</span></span
          >
          <button
            id="form-date"
            class="input input-line picker-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-labelledby="form-date-label"
            @click="openExhibitionDateRange"
          >
            <span class="picker-trigger-value" :data-empty="form.date ? 'false' : 'true'">{{
              dateText || t('picker.selectDate')
            }}</span>
            <AppIcon name="calendar" size="icon icon-sm" />
          </button>
          <p v-if="isInvalid('date')" class="field-error" role="alert">{{ formError }}</p>
        </div>
        <div class="field" :data-invalid="isInvalid('endDate') ? 'true' : 'false'">
          <span id="form-end-date-label" class="field-label">{{ t('exhibition.form.endDate') }}</span>
          <button
            id="form-end-date"
            class="input input-line picker-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-labelledby="form-end-date-label"
            @click="openExhibitionDateRange"
          >
            <span class="picker-trigger-value" :data-empty="form.endDate ? 'false' : 'true'">{{
              endDateText || t('picker.selectDate')
            }}</span>
            <AppIcon name="calendar" size="icon icon-sm" />
          </button>
          <p v-if="isInvalid('endDate')" class="field-error" role="alert">{{ formError }}</p>
          <p v-if="maxExhibitionDays > 0" class="field-hint">
            {{ t('exhibition.form.durationHint', { max: maxExhibitionDays }) }}
          </p>
        </div>
      </div>

      <!-- 开展时间：两个时间滚轮，中间一横把起止分开，值仍写回 form.time。 -->
      <div v-show="!isCreate || createStep === 1" class="field" :data-invalid="isInvalid('time') ? 'true' : 'false'">
        <span id="form-time-label" class="field-label">{{ t('exhibition.form.openTime') }}</span>
        <div class="time-range">
          <button
            id="form-time"
            class="input input-line picker-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-labelledby="form-time-label"
            @click="openStartTime"
          >
            <span class="picker-trigger-value" :data-empty="timeStart ? 'false' : 'true'">{{
              timeStart || t('exhibition.form.timeStart')
            }}</span>
          </button>
          <span class="time-sep" aria-hidden="true">–</span>
          <button
            id="form-time-end"
            class="input input-line picker-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-labelledby="form-time-label"
            @click="openEndTime"
          >
            <span class="picker-trigger-value" :data-empty="timeEnd ? 'false' : 'true'">{{
              timeEnd || t('exhibition.form.timeEnd')
            }}</span>
          </button>
        </div>
        <p v-if="isInvalid('time')" class="field-error" role="alert">{{ formError }}</p>
        <p class="field-hint">{{ t('exhibition.form.openTimeHint') }}</p>
      </div>

      <!-- 报名开始 / 截止也是一组日期范围；两项都可留空，清空即不设报名窗口。 -->
      <div v-show="!isCreate || createStep === 2" class="form-pair">
        <div class="field" :data-invalid="isInvalid('registrationStart') ? 'true' : 'false'">
          <span id="form-reg-start-label" class="field-label">{{ t('exhibition.form.registrationOpens') }}</span>
          <button
            id="form-reg-start"
            class="input input-line picker-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-labelledby="form-reg-start-label"
            @click="openRegistrationDateRange"
          >
            <span class="picker-trigger-value" :data-empty="form.registrationStart ? 'false' : 'true'">{{
              registrationStartText || t('picker.selectDate')
            }}</span>
            <AppIcon name="calendar" size="icon icon-sm" />
          </button>
          <p v-if="isInvalid('registrationStart')" class="field-error" role="alert">{{ formError }}</p>
        </div>
        <div class="field" :data-invalid="isInvalid('registrationEnd') ? 'true' : 'false'">
          <span id="form-reg-end-label" class="field-label">{{ t('exhibition.form.registrationCloses') }}</span>
          <button
            id="form-reg-end"
            class="input input-line picker-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-labelledby="form-reg-end-label"
            @click="openRegistrationDateRange"
          >
            <span class="picker-trigger-value" :data-empty="form.registrationEnd ? 'false' : 'true'">{{
              registrationEndText || t('picker.selectDate')
            }}</span>
            <AppIcon name="calendar" size="icon icon-sm" />
          </button>
          <p v-if="isInvalid('registrationEnd')" class="field-error" role="alert">{{ formError }}</p>
        </div>
      </div>

      <!-- 分类是管理员在「管理后台-设置」里维护的清单：一行可点的字段，点开抽屉选值 -->
      <div
        v-show="!isCreate || createStep === 1"
        class="field"
        :data-invalid="isInvalid('category') ? 'true' : 'false'"
      >
        <span id="form-category-label" class="field-label"
          >{{ t('admin.limits.category') }}<span class="required" aria-hidden="true"> *</span></span
        >
        <button
          id="form-category"
          class="input input-line category-trigger"
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

    <!-- 活动信息：竖版封面在上，纯文本简介、Markdown 编辑入口与参与方式依次跟在下面。
         简介与 RichEditorPage 共用 form.description：点 Markdown 入口时先把当前表单存成内存稿
         （新建与编辑都一样），二级页以它为起稿、保存后把最新正文写回同一份稿，返回时整张表单
         按它恢复，所以两边始终是同一份正文，其他未保存字段也不会在往返中丢。 -->
    <div v-show="!isCreate || createStep === 1" class="card cover-card">
      <span class="section-label">{{ t('exhibition.form.coverAndDescription') }}</span>
      <div class="cover-row">
        <!-- 封面槽位始终在：上传期间遮罩盖在它上面，失败 / 取消随进度清空一起撤掉。 -->
        <div class="cover-frame ph-img">
          <!-- 上传期间显示本机副本：遮罩下半截透出的是用户刚选的图，不是占位图。 -->
          <img
            v-if="coverPreview || form.imageUri"
            :src="coverPreview || form.imageUri"
            :alt="t('exhibition.form.cover')"
          />
          <UploadProgressMask v-if="coverProgress !== null" :progress="coverProgress" @settled="coverProgress = null" />
        </div>
        <div class="cover-side">
          <button
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="coverBusy"
            :data-loading="coverBusy ? 'true' : 'false'"
            @click="pickCover"
          >
            {{ form.imageUri ? t('admin.media.changeCover') : t('admin.media.uploadCover') }}
          </button>
          <button
            v-if="form.imageUri"
            class="cta ghost"
            data-size="small"
            type="button"
            :disabled="coverBusy"
            @click="removeCover"
          >
            {{ t('admin.media.removeCover') }}
          </button>
          <p class="field-hint">{{ t('exhibition.form.coverRatioHint') }}</p>
          <p class="field-hint">{{ formatHint }}</p>
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="form-description">{{ t('exhibition.form.descriptionLabel') }}</label>
        <textarea
          id="form-description"
          v-model="form.description"
          class="textarea"
          rows="6"
          :placeholder="t('exhibition.form.descriptionPlaceholder')"
        />
        <div class="row">
          <button class="cta ghost" data-size="small" type="button" @click="editDescription">
            {{ t('exhibition.form.editDescription') }}
          </button>
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="form-registration-notice">{{ t('exhibition.form.noticeTitle') }}</label>
        <textarea
          id="form-registration-notice"
          v-model="form.registrationNotice"
          class="textarea"
          rows="6"
          maxlength="2000"
          :placeholder="t('exhibition.form.noticePlaceholder')"
          :aria-describedby="'form-registration-notice-hint'"
        />
        <p id="form-registration-notice-hint" class="field-hint">{{ t('exhibition.form.noticeHint') }}</p>
        <p v-if="isInvalid('registrationNotice')" class="field-error" role="alert">{{ formError }}</p>
      </div>
    </div>

    <!-- 报名设置：报名方式、报名二维码与通过后撤销，三块之间只留白，不再画分隔线。 -->
    <div v-show="!isCreate || createStep === 2" class="card registration-settings-groups">
      <span class="section-label">{{ t('exhibition.form.registrationSettings') }}</span>
      <div class="field">
        <span class="field-label">{{ t('exhibition.form.registrationMode') }}</span>
        <SegControl
          :model-value="form.status"
          :items="MODES"
          :label="t('exhibition.form.registrationMode')"
          @update:model-value="changeMode"
        />
        <!-- 只有「需审核」需要展商回到报名管理逐条处理，说明只在这一档出现。 -->
        <p v-if="form.status === EXHIBITION_STATUS.REVIEW_REQUIRED" id="form-review-mode-hint" class="field-hint">
          {{ t('exhibition.form.reviewModeHint') }}
        </p>
      </div>
      <div class="stack" data-gap="sm">
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
      </div>
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
      v-show="!isCreate || createStep === 2"
      :fields="fields"
      :label="t('exhibition.form.collectFields')"
      :title-max="limit('fieldTitle', 30)"
      :radio-max="limit('radioOption', 60)"
      :check-max="limit('checkOption', 60)"
    />

    <!-- 展会归属：只有管理员、且是已有展会时出现。按邮箱把展会交给另一个账号，
         放在「危险操作」之前，删除仍是页面内容最下方的一颗。 -->
    <div v-if="showOwnerCard" class="card owner-card">
      <span class="section-label">{{ t('exhibition.form.ownerSection') }}</span>
      <p class="row-meta">{{ t('exhibition.form.ownerCurrent', { name: ownerLabel }) }}</p>
      <div class="field" :data-invalid="ownerError ? 'true' : 'false'">
        <label for="form-owner-email">{{ t('exhibition.form.ownerEmailLabel') }}</label>
        <input
          id="form-owner-email"
          v-model="ownerEmail"
          class="input input-line"
          type="email"
          inputmode="email"
          autocomplete="off"
          :maxlength="120"
          :placeholder="t('exhibition.form.ownerEmailPlaceholder')"
          :disabled="ownerBusy"
          @keyup.enter="askTransferOwner"
        />
        <p v-if="ownerError" class="field-error" role="alert">{{ ownerError }}</p>
      </div>
      <div class="row">
        <button
          class="cta ghost"
          data-size="small"
          type="button"
          :disabled="ownerBusy"
          :data-loading="ownerBusy ? 'true' : 'false'"
          @click="askTransferOwner"
        >
          {{ t('exhibition.form.ownerSubmit') }}
        </button>
      </div>
      <p class="field-hint">{{ t('exhibition.form.ownerHint') }}</p>
    </div>

    <!-- 删除放在内容最下，保存仍固定在页脚。新建还没有展会，整块不渲染。 -->
    <div v-if="!isCreate" class="card danger-zone">
      <span class="section-label">{{ t('exhibition.form.dangerZone') }}</span>
      <button class="cta danger" type="button" @click="askDelete">
        {{ t('exhibition.form.deleteExhibition') }}
      </button>
    </div>

    <!-- 发布检查：把要发布的展会与报名配置摊在同一张卡里，核对完再点页脚的「发布展会」。
         这里只读；要改就点「返回」上一步。 -->
    <div v-if="isCreate && createStep === 3" class="card create-review">
      <span class="section-label">{{ t('exhibition.form.publishCheck') }}</span>
      <div class="create-review-row">
        <span>{{ t('admin.limits.exhibitionName') }}</span>
        <strong>{{ form.title }}</strong>
      </div>
      <div class="create-review-row">
        <span>{{ t('admin.exhibitions.venue') }}</span>
        <strong>{{ form.venue }}</strong>
      </div>
      <div class="create-review-row">
        <span>{{ t('exhibition.form.openDate') }}</span>
        <strong>{{ dateRangeText }}</strong>
      </div>
      <div v-if="form.time" class="create-review-row">
        <span>{{ t('exhibition.form.openTime') }}</span>
        <strong>{{ form.time }}</strong>
      </div>
      <div v-if="form.category" class="create-review-row">
        <span>{{ t('admin.limits.category') }}</span>
        <strong>{{ form.category }}</strong>
      </div>
      <div class="create-review-row">
        <span>{{ t('exhibition.form.registrationMode') }}</span>
        <strong>{{ exhibitionStatusLabel(form.status) }}</strong>
      </div>
      <div v-if="registrationWindowText" class="create-review-row">
        <span>{{ t('exhibition.form.registrationOpens') }}</span>
        <strong>{{ registrationWindowText }}</strong>
      </div>
      <div class="create-review-row">
        <span>{{ t('exhibition.form.collectFields') }}</span>
        <strong>{{ t('registration.fields.countItems', { count: submittedFieldCount }) }}</strong>
      </div>
      <p class="field-hint">{{ t('exhibition.form.publishCheckHint') }}</p>
      <!-- 接口失败（没有具体字段）时也要在第三步看见原因；字段错误会退回那一步显示。 -->
      <p v-if="formError && !invalidField" class="field-error" role="alert">{{ formError }}</p>
    </div>
  </template>

  <!-- 底部固定保存区：保存后可在详情页确认展示效果 -->
  <Teleport v-if="built && !limited && !loadFailed && !notFound" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <template v-if="isCreate">
          <div v-if="createStep > 1" class="grid-cols-2">
            <button class="cta ghost" type="button" @click="retreatCreateStep">{{ t('common.back') }}</button>
            <button v-if="createStep === 2" class="cta" type="button" @click="advanceCreateStep">
              {{ t('common.continue') }}
            </button>
            <button
              v-else
              class="cta"
              type="button"
              :disabled="saving"
              :data-loading="saving ? 'true' : 'false'"
              @click="submit"
            >
              {{ t('exhibition.form.publishExhibition') }}
            </button>
          </div>
          <button v-else class="cta" type="button" @click="advanceCreateStep">{{ t('common.continue') }}</button>
        </template>
        <button
          v-else
          class="cta"
          type="button"
          :disabled="saving"
          :data-loading="saving ? 'true' : 'false'"
          @click="submit"
        >
          {{ t('exhibition.form.saveExhibition') }}
        </button>
        <p v-if="!isCreate" class="field-hint text-center">{{ t('exhibition.form.confirmOnDetail') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 只写本页自己的类名：卡片内距由外壳与 .card 给，这里不再补左右 padding。
   表单列宽跟容器走：隐式 auto 轨道会被子项的 max-content 撑宽，320 宽时会横向溢出。 */
.form {
  grid-template-columns: minmax(0, 1fr);
}

.create-progress {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s2);
}

.create-progress > span {
  min-width: 0;
  padding-block: var(--s2);
  border-bottom: 2px solid var(--stroke);
  color: var(--ink-3);
  font-size: var(--fs-meta);
  text-align: center;
}

.create-progress > span[data-current='true'],
.create-progress > span[data-complete='true'] {
  border-color: var(--accent-ink);
  color: var(--accent-ink);
  font-weight: 700;
}

.create-heading h2 {
  margin: 0;
  font-size: var(--fs-h1);
}

.create-review {
  gap: var(--s3);
}

.create-review-row {
  display: grid;
  grid-template-columns: minmax(5.5em, 0.65fr) minmax(0, 1.35fr);
  gap: var(--s3);
  align-items: start;
  font-size: var(--fs-body);
}

.create-review-row > span {
  color: var(--ink-2);
}

.create-review-row > strong {
  overflow-wrap: anywhere;
  text-align: end;
}

/* 日期 / 时间字段成组排：宽屏两列、窄屏自动落成一行，触发按钮不会截字。 */
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

/* 分类 / 日期 / 时间触发按钮：借用 .input 的外观（下划线随底座走），
   只补布局：文字靠左、图标靠右，值过长时截断。 */
.category-trigger,
.picker-trigger {
  justify-content: space-between;
  gap: var(--s2);
  text-align: start;
}

.category-trigger svg,
.picker-trigger svg {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
}

.category-value,
.picker-trigger-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 还没选：按占位文字的层级弱化一档。 */
.category-value[data-empty='true'],
.picker-trigger-value[data-empty='true'] {
  color: var(--ink-3);
}

/* 封面卡把简介并进来后，封面与简介之间多留一档；报名设置里各组之间只靠留白分区；
   归属卡是一段操作，说明与输入之间同样松一档。 */
.cover-card,
.registration-settings-groups,
.owner-card {
  gap: var(--s3);
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
