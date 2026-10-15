<script setup lang="ts">
/**
 * 私人会议的日期和时间，和编辑展会同一行：左边日期，右边时间。
 *
 * 日期必填，不能早于今天。时间选填，用时间选择得到 HH:MM；留空表示不填。
 */
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

function onDate(event: Event): void {
  emit('update:date', (event.target as HTMLInputElement).value);
}

function onTime(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  emit('update:time', value.length > 5 ? value.slice(0, 5) : value);
}
</script>

<template>
  <div class="grid-cols-2">
    <div class="field" :data-invalid="dateError ? 'true' : 'false'">
      <label for="meeting-date">{{ dateLabel }}<span class="required" aria-hidden="true"> *</span></label>
      <input
        id="meeting-date"
        class="input"
        type="date"
        :min="today()"
        :value="props.date"
        @input="onDate"
      />
      <p v-if="dateError" class="field-error" role="alert">{{ dateError }}</p>
    </div>
    <div class="field">
      <label for="meeting-time">{{ timeLabel }}</label>
      <input
        id="meeting-time"
        class="input"
        type="time"
        step="60"
        :value="props.time"
        @input="onTime"
      />
      <p class="field-hint">{{ timeHint }}</p>
    </div>
  </div>
</template>
