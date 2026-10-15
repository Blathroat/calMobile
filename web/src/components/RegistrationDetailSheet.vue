<script setup lang="ts">
/**
 * 「查看报名」抽屉里的报名详情（共享底部面板的自定义内容）。
 *
 * 之前详情是把状态、时间和每条收集项拼成一段文字（`message: lines.join('\n')`）：
 * 收集项一多就被挤成一坨，标签和值抢同一行、换行位置也失控。改成结构化面板后：
 *
 * - 顶部一段回答「现在是什么状态、什么时候报的」，状态用 `StatusTag` 而不是文字；
 * - 收集项按「标签 / 内容」两行分组，长内容自然换行，不与标签抢行；
 * - 终态（已参加这类不能再调整的状态）的原因单独一行说明，不混进收集项里。
 *
 * 面板只负责内容：关闭与「调整状态」仍由 `ReviewPage` 通过 `actions` 控制。
 */
import StatusTag from './StatusTag.vue';
import AppIcon from './AppIcon.vue';
import type { StatusTone } from '@/services/status';
import { t } from '@/i18n';

const COPY = {
  status: t('registration.detail.status'),
  time: t('registration.detail.registeredAt'),
  answers: t('registration.detail.submittedInfo'),
  summary: t('registration.detail.summary'),
};

withDefaults(defineProps<{
  status: string;
  /** 与列表里同一个状态色调，抽屉和列表不会对同一条报名给出两种颜色。 */
  statusTone?: StatusTone;
  registrationTime?: string;
  summary?: string;
  answers: { label: string; value: string }[];
  /** 终态说明：没有可调整的动作时由调用方传进来。 */
  hint?: string;
}>(), {
  statusTone: 'muted',
  registrationTime: '',
  summary: '',
  hint: '',
});
</script>

<template>
  <div class="stack" data-gap="sm">
    <div class="stack" data-gap="sm">
      <span class="section-label">{{ COPY.status }}</span>
      <div class="row" data-between="true">
        <StatusTag :text="status" :tone="statusTone" />
        <span class="row" data-gap="sm">
          <span class="dim" aria-hidden="true"><AppIcon name="calendar" size="icon icon-sm" /></span>
          <span class="row-meta">{{ registrationTime || '—' }}</span>
        </span>
      </div>
    </div>

    <div class="stack" data-gap="sm">
      <span class="section-label">{{ COPY.answers }}</span>
      <div v-if="answers.length > 0" class="detail-list">
        <div v-for="answer in answers" :key="answer.label" class="detail-item">
          <span class="detail-label">{{ answer.label }}</span>
          <span class="detail-value">{{ answer.value }}</span>
        </div>
      </div>
      <p v-else class="row-meta">{{ t('registration.detail.noCollectedInfo') }}</p>
    </div>

    <div v-if="summary" class="stack" data-gap="sm">
      <span class="section-label">{{ COPY.summary }}</span>
      <p class="detail-value">{{ summary }}</p>
    </div>

    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>
