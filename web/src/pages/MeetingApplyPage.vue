<script setup lang="ts">
/**
 * 私人会议申请。
 *
 * 应用里从展商主页进入，报名站从分享链接 `/m/:exhibitorId` 进入。两边都要先登录。
 * 展商未开放、或账号受限 / 封禁时不给表单，只显示「展商暂不接受会议预约」。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { toast } from '@/services/toast';
import { answerDocument } from '@domain/answer-document';
import { limit } from '@/services/validate';
import RadioChoices from '@/components/RadioChoices.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import MeetingWhenFields from '@/components/MeetingWhenFields.vue';
import RoleTag from '@/components/RoleTag.vue';
import type { JsonObject } from '@/api/types';
import { paths } from '@/app/surface';
import { t } from '@/i18n';

interface FieldDef {
  title: string;
  type: string;
  required?: boolean;
  options?: unknown;
}

const route = useRoute();
const router = useRouter();
const query = useAsync<JsonObject>();

const meetingDate = ref('');
const meetingTime = ref('');
const answers = reactive<Record<string, string | string[]>>({});
const fieldErrors = reactive<Record<string, string>>({});
const dateError = ref('');
const error = ref('');
const busy = ref(false);
const success = ref(false);
let redirectTimer: number | undefined;

const form = computed(() => query.data.value);
const open = computed(() => form.value?.open === true);
const fields = computed<FieldDef[]>(() => (Array.isArray(form.value?.fields) ? (form.value.fields as FieldDef[]) : []));
const textFillMax = computed(() => limit('textFill', 200));
const answerMax = computed(() => limit('answer', 200));
const closedMessage = computed(() => String(form.value?.message || t('meeting.apply.notAccepting')));
const notice = computed(() => String(form.value?.notice || '').trim());

const COPY = {
  date: t('meeting.apply.date'),
  time: t('meeting.apply.time'),
  timeHint: t('meeting.apply.optionalTime'),
  submit: t('meeting.apply.submit'),
  success: t('meeting.apply.submitted'),
  pendingHint: t('meeting.apply.myActivitiesHint'),
};

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function load(): void {
  const exhibitorId = String(route.params.exhibitorId ?? '');
  void query.run(() => api.meetings.form(exhibitorId));
}

onMounted(load);
onBeforeUnmount(() => {
  if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
});

function splitOptions(options: unknown): string[] {
  const list = Array.isArray(options) ? options.map((item) => String(item).trim()).filter(Boolean) : [];
  return list.length > 0 ? list : [t('registration.form.unsetOption')];
}

function fieldId(field: FieldDef): string {
  return `meet-${field.title.replace(/\s+/g, '-')}`;
}

function textValue(field: FieldDef): string {
  const value = answers[field.title];
  return typeof value === 'string' ? value : '';
}

function multiValue(field: FieldDef): string[] {
  const value = answers[field.title];
  return Array.isArray(value) ? value : [];
}

function onTextInput(field: FieldDef, event: Event): void {
  answers[field.title] = (event.target as HTMLInputElement).value;
  delete fieldErrors[field.title];
}

function onRadioChange(field: FieldDef, option: string): void {
  answers[field.title] = option;
  delete fieldErrors[field.title];
}

function onMultiChange(field: FieldDef, option: string, event: Event): void {
  const list = multiValue(field).filter((item) => item !== option);
  if ((event.target as HTMLInputElement).checked) list.push(option);
  answers[field.title] = list;
  delete fieldErrors[field.title];
}

async function submit(): Promise<void> {
  if (busy.value || success.value || !open.value) return;
  error.value = '';
  dateError.value = '';
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
  if (!meetingDate.value) {
    dateError.value = t('meeting.apply.chooseDate');
    return;
  }
  if (meetingDate.value < today()) {
    dateError.value = t('meeting.apply.dateTooEarly');
    return;
  }
  if (meetingTime.value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meetingTime.value)) {
    error.value = t('meeting.apply.timeFormat');
    return;
  }
  const document = answerDocument({
    fields: fields.value,
    source: { values: answers },
    limits: { textFill: textFillMax.value, answer: answerMax.value },
  });
  for (const problem of document.problems) {
    if (problem.title) fieldErrors[problem.title] = problem.message;
    else error.value = problem.message;
  }
  if (document.problems.length > 0) return;
  busy.value = true;
  try {
    const result = await api.meetings.submit({
      exhibitorId: String(form.value?.exhibitorId || route.params.exhibitorId || ''),
      meetingDate: meetingDate.value,
      meetingTime: meetingTime.value,
      answers: document.text,
    });
    if (result?.ok === false) {
      error.value = String(result.error || t('registration.form.submitFailed'));
      return;
    }
    success.value = true;
    toast(COPY.success, 'success');
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
  <SkeletonBlock v-if="query.loading.value && !form" :rows="3" />
  <StateBlock
    v-else-if="query.error.value && !form"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <StateBlock
    v-else-if="form?.found === false"
    tone="error"
    icon="user"
    :title="t('meeting.apply.noPublicProfile')"
    :description="String(form?.error || '用户不存在或已删除')"
    :action-label="t('exhibition.detail.backHome')"
    @action="router.push(paths.home)"
  />
  <template v-else-if="form">
    <div class="card">
      <span class="name-line">
        <strong class="row-title">{{ form.exhibitorName }}</strong>
        <RoleTag :role-code="String(form.roleCode || '')" />
      </span>
      <p v-if="open && notice" class="row-meta">{{ notice }}</p>
      <p v-else-if="!open" class="row-meta">{{ closedMessage }}</p>
    </div>

    <button v-if="!open" class="cta" type="button" disabled>{{ closedMessage }}</button>

    <form v-else id="meeting-apply-form" class="stack" data-gap="md" @submit.prevent="submit">
      <MeetingWhenFields
        v-model:date="meetingDate"
        v-model:time="meetingTime"
        :date-label="COPY.date"
        :time-label="COPY.time"
        :time-hint="COPY.timeHint"
        :date-error="dateError"
      />

      <template v-for="field in fields" :key="field.title">
        <fieldset
          v-if="field.type === '单选'"
          class="choice-group"
          :data-invalid="fieldErrors[field.title] ? 'true' : undefined"
        >
          <legend>{{ field.title }}<span v-if="field.required" class="required" aria-hidden="true"> *</span></legend>
          <RadioChoices
            :name="fieldId(field)"
            :options="splitOptions(field.options)"
            :selected="textValue(field)"
            @select="onRadioChange(field, $event)"
          />
          <p v-if="fieldErrors[field.title]" class="field-error" role="alert">{{ fieldErrors[field.title] }}</p>
        </fieldset>
        <fieldset
          v-else-if="field.type === '多选'"
          class="choice-group"
          :data-invalid="fieldErrors[field.title] ? 'true' : undefined"
        >
          <legend>{{ field.title }}<span v-if="field.required" class="required" aria-hidden="true"> *</span></legend>
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
                :checked="multiValue(field).includes(option)"
                @change="onMultiChange(field, option, $event)"
              />
              <span class="check-copy">{{ option }}</span>
            </label>
          </div>
          <p v-if="fieldErrors[field.title]" class="field-error" role="alert">{{ fieldErrors[field.title] }}</p>
        </fieldset>
        <div v-else class="field" :data-invalid="fieldErrors[field.title] ? 'true' : undefined">
          <label :for="fieldId(field)"
            >{{ field.title }}<span v-if="field.required" class="required" aria-hidden="true"> *</span></label
          >
          <input
            :id="fieldId(field)"
            class="input"
            type="text"
            :maxlength="textFillMax"
            :value="textValue(field)"
            @input="onTextInput(field, $event)"
          />
          <p v-if="fieldErrors[field.title]" class="field-error" role="alert">{{ fieldErrors[field.title] }}</p>
        </div>
      </template>
    </form>
  </template>

  <Teleport v-if="open" defer to="#app-foot">
    <div class="page-foot">
      <div class="stack" data-gap="sm">
        <StateBlock v-if="success" tone="success" :title="COPY.success" :description="COPY.pendingHint" />
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        <button
          class="cta"
          type="submit"
          form="meeting-apply-form"
          :disabled="busy || success"
          :data-loading="busy ? 'true' : 'false'"
        >
          {{ COPY.submit }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
