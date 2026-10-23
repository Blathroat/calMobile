<script setup lang="ts">
/**
 * 屏幕 04 · 报名信息
 *
 * 表单按展商配置的收集项动态生成：文本、单选、多选三种类型。必填、选项和长度由回答文稿判断，
 * 上限数字仍取 bootstrap。校验失败落在字段原位，提交按钮固定在页脚，成功后短暂停留再进「我的活动」。
 *
 * 从报名详情带 `?registrationId=` 进来是「修改报名」：按收集项标题回填已有答案，
 * 提交仍是一次新的报名写入（与旧实现一致）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { isJoinSurface, paths } from '@/app/surface';
import { useAsync } from '@/composables/useAsync';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { answerDocument } from '@domain/answer-document';
import { limit } from '@/services/validate';
import { EXHIBITION_STATUS, FIELD_TYPE, modeLabel, statusTone } from '@/services/status';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import StatusTag from '@/components/StatusTag.vue';
import { formatDateWithWeekday } from '@/services/format';
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
    let existing: Registration | null = null;
    if (detail?.found && registrationId.value) {
      const record = await api.registrations.get(registrationId.value);
      existing = record?.found ? (record.registration ?? null) : null;
    }
    if (detail?.found && isJoinSurface && detail.exhibition?.description) await loadMarkdownParser();
    if (detail?.found && !built) {
      built = true;
      seed(detail.fields ?? [], existing);
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
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];

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
  const visitorName = String(profile.nickname || profile.username || t('registration.form.fallbackName'));
  // 回传的是角色 code（协议值），不是展示文案：文案按 code 在展示处查表。
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
      visitorType,
      answers: document.text,
    });
    if (!result?.ok) {
      error.value = String(result?.error || t('registration.form.submitFailed'));
      return;
    }
    approved.value = result.autoApproved === true || item.statusCode === EXHIBITION_STATUS.REVIEW_OPTIONAL;
    success.value = true;
    toast(approved.value ? t('registration.form.submittedAndApproved') : t('registration.form.submitted'), 'success');
    // 提交成功后的短暂停留：定时器随页面一起取消，用户已经返回时不再被拉回列表。
    redirectTimer = window.setTimeout(() => {
      redirectTimer = undefined;
      void router.replace(paths.registrations);
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
          <span class="row-meta">{{ formatDateWithWeekday(exhibition.date) }} {{ exhibition.time }}</span>
          <span class="row-meta truncate">{{ exhibition.venue }}</span>
        </span>
        <StatusTag
          :text="modeLabel(String(exhibition.statusCode || ''))"
          :tone="statusTone(String(exhibition.statusCode || ''))"
        />
      </div>

      <div v-if="joinDescription" class="rich-content" v-html="joinDescription" />

      <form id="registration-form" class="form" novalidate @submit.prevent="submit">
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
              {{ field.title }}<span v-if="field.required" class="required" aria-hidden="true"> *</span>
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
          :description="approved ? t('registration.form.autoApprovedHint') : t('registration.form.pendingHint')"
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
  width: 44px;
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
</style>
