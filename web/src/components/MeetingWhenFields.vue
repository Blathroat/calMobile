<script setup lang="ts">
/**
 * 私人会议的日期和时间，和编辑展会同一行：左边日期，右边时间。
 *
 * 日期必填，不能早于今天，走应用内的单个日期抽屉；时间选填，走时 / 分滚轮，
 * 得到 HH:MM，留空表示不填。props / emit 契约与原来一致，页面不用改。
 */
import { formatChineseDate, formatChineseTime } from '@/services/format';
import { openSingleDate, openTime } from '@/services/pickers';
import AppIcon from '@/components/AppIcon.vue';
import { t } from '@/i18n';

const props = defineProps<{
  date: string;
  time: string;
  dateLabel: string;
  timeLabel: string;
  timeHint: string;
  dateError?: string;
}>();

const emit = defineEmits<{
  'update:date': [value: string];
  'update:time': [value: string];
}>();

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 日期：单个日期抽屉，点一天即选中；min 挡住今天以前。 */
function pickDate(): void {
  openSingleDate({
    value: props.date,
    min: today(),
    onChange: (value) => emit('update:date', value),
  });
}

/** 时间：滚轮选时 / 分，确认后回填 HH:MM；「清除」把时间留空。 */
function pickTime(): void {
  openTime({
    value: props.time,
    fallback: '09:00',
    onConfirm: (value) => emit('update:time', value),
    onClear: () => emit('update:time', ''),
  });
}
</script>

<template>
  <div class="grid-cols-2">
    <div class="field" :data-invalid="dateError ? 'true' : 'false'">
      <span id="meeting-date-label" class="field-label"
        >{{ dateLabel }}<span class="required" aria-hidden="true"> *</span></span
      >
      <button
        id="meeting-date"
        class="input input-line meeting-when-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-labelledby="meeting-date-label"
        @click="pickDate"
      >
        <span class="meeting-when-value" :data-empty="props.date ? 'false' : 'true'">{{
          formatChineseDate(props.date) || t('picker.selectDate')
        }}</span>
        <AppIcon name="chevronDown" size="icon icon-sm" />
      </button>
      <p v-if="dateError" class="field-error" role="alert">{{ dateError }}</p>
    </div>
    <div class="field">
      <span id="meeting-time-label" class="field-label">{{ timeLabel }}</span>
      <button
        id="meeting-time"
        class="input input-line meeting-when-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-labelledby="meeting-time-label"
        @click="pickTime"
      >
        <span class="meeting-when-value" :data-empty="props.time ? 'false' : 'true'">{{
          formatChineseTime(props.time) || t('picker.selectTime')
        }}</span>
        <AppIcon name="chevronDown" size="icon icon-sm" />
      </button>
      <p class="field-hint">{{ timeHint }}</p>
    </div>
  </div>
</template>

<style>
/* 日期 / 时间触发按钮：借用 .input 的下划线外观，文字靠左、chevron 靠右。 */
.meeting-when-trigger {
  justify-content: space-between;
  gap: var(--s2);
  text-align: start;
}

.meeting-when-trigger svg {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
}

.meeting-when-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 还没选：按占位文字的层级弱化一档。 */
.meeting-when-value[data-empty='true'] {
  color: var(--ink-3);
}
</style>
