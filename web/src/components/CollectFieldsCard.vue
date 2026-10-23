<script setup lang="ts">
/**
 * 报名收集项编辑卡。
 *
 * 编辑展会和私人会议设置共用这一张卡。各项排在同一张卡里，用分隔线隔开，
 * 不再套子卡片。标题占一整行，类型用滑动分段切换。说明和选项更小更淡。
 * 单选和多选可以只有一个选项。必填在底行左边，删除在底行右边。
 * 字段数组由调用方持有，这里直接改同一份数据。
 */
import AppIcon from '@/components/AppIcon.vue';
import SegControl from '@/components/SegControl.vue';
import { FIELD_TYPE, fieldTypeLabel } from '@/services/status';
import { t } from '@/i18n';

export interface CollectField {
  title: string;
  type: string;
  required: boolean;
  options: string[];
}

const props = defineProps<{
  fields: CollectField[];
  /** 卡片标题，两边文案不同，结构相同。 */
  label: string;
  /** 卡片说明；为空时不渲染那段小字。 */
  hint?: string;
  titleMax: number;
  /** 单选选项字数上限。缺省与后端默认一致。 */
  radioMax?: number;
  /** 多选选项字数上限。缺省与后端默认一致。 */
  checkMax?: number;
  disabled?: boolean;
}>();

const FIELD_TYPES = [FIELD_TYPE.TEXT, FIELD_TYPE.RADIO, FIELD_TYPE.CHECKBOX] as const;
const TYPE_ITEMS = FIELD_TYPES.map((type) => ({ value: type, label: fieldTypeLabel(type) }));

const COPY = {
  title: t('exhibition.editor.heading'),
  type: t('registration.fields.fieldType'),
  remove: t('common.delete'),
  placeholder: t('registration.fields.questionPlaceholder'),
  empty: t('registration.fields.emptyHint'),
  textHint: t('registration.fields.textInputHint'),
  radioHint: t('registration.fields.singleChoiceHint'),
  checkHint: t('registration.fields.multiChoiceHint'),
};

function addField(): void {
  props.fields.push({ title: '', type: FIELD_TYPE.TEXT, required: false, options: [] });
}

function removeField(index: number): void {
  props.fields.splice(index, 1);
}

function changeFieldType(item: CollectField, type: string): void {
  item.type = type;
  // 切到单选 / 多选时留出一格。一个选项就够用，多的由编辑的人自己加。
  if (type !== FIELD_TYPE.TEXT && item.options.length === 0) item.options = [''];
}

function addOption(item: CollectField): void {
  item.options.push('');
}

function removeOption(item: CollectField, index: number): void {
  item.options.splice(index, 1);
}

function isChoice(item: CollectField): boolean {
  return item.type === FIELD_TYPE.RADIO || item.type === FIELD_TYPE.CHECKBOX;
}

function typeHint(item: CollectField): string {
  if (item.type === FIELD_TYPE.RADIO) return COPY.radioHint;
  if (item.type === FIELD_TYPE.CHECKBOX) return COPY.checkHint;
  return COPY.textHint;
}

function optionLabel(index: number): string {
  return t('registration.fields.optionLabel', { index: index + 1 });
}

function optionMax(item: CollectField): number {
  return item.type === FIELD_TYPE.CHECKBOX ? (props.checkMax ?? 60) : (props.radioMax ?? 60);
}

function itemLabel(index: number): string {
  return t('registration.fields.itemLabel', { index: index + 1 });
}
</script>

<template>
  <div class="card">
    <div class="row" data-between="true">
      <span class="section-label">{{ label }}</span>
      <span class="pill">{{ t('registration.fields.countItems', { count: fields.length }) }}</span>
    </div>
    <p v-if="hint" class="field-hint">{{ hint }}</p>
    <p v-if="fields.length === 0" class="field-hint">{{ COPY.empty }}</p>
    <div v-if="fields.length" class="collect-list">
      <div v-for="(item, index) in fields" :key="index" class="collect-item">
        <div class="collect-primary">
          <label class="notch">
            <span class="notch-label">{{ COPY.title }}</span>
            <input
              v-model="item.title"
              class="notch-input"
              type="text"
              :placeholder="COPY.placeholder"
              :maxlength="titleMax"
              :disabled="disabled"
              :aria-label="t('registration.fields.fieldTitle')"
            />
          </label>
          <SegControl
            :model-value="item.type"
            :items="TYPE_ITEMS"
            :label="COPY.type"
            :disabled="disabled"
            @update:model-value="(value) => changeFieldType(item, value)"
          />
        </div>
        <p class="collect-note">{{ typeHint(item) }}</p>
        <div
          v-if="isChoice(item)"
          class="collect-options"
          role="group"
          :aria-label="item.type === FIELD_TYPE.RADIO ? t('admin.limits.radioOption') : t('admin.limits.checkOption')"
        >
          <div v-for="(option, optionIndex) in item.options" :key="optionIndex" class="option-row">
            <span class="option-index">{{ optionIndex + 1 }}</span>
            <input
              v-model="item.options[optionIndex]"
              class="input option-input"
              type="text"
              :maxlength="optionMax(item)"
              :disabled="disabled"
              :aria-label="optionLabel(optionIndex)"
            />
            <button
              class="icon-button option-remove"
              type="button"
              :aria-label="t('registration.fields.removeOptionAria', { index: optionIndex + 1 })"
              :disabled="disabled"
              @click="removeOption(item, optionIndex)"
            >
              <AppIcon name="trash" size="icon icon-sm" />
            </button>
          </div>
          <button class="collect-quiet" type="button" :disabled="disabled" @click="addOption(item)">
            {{ t('registration.fields.addOption') }}
          </button>
        </div>
        <div class="collect-foot">
          <label class="tick" :data-on="item.required ? 'true' : 'false'">
            <input v-model="item.required" type="checkbox" :disabled="disabled" />
            <span>{{ item.required ? t('registration.fields.required') : t('registration.fields.optional') }}</span>
          </label>
          <span class="collect-ordinal">{{ itemLabel(index) }}</span>
          <button
            class="collect-quiet collect-remove"
            type="button"
            :disabled="disabled"
            :aria-label="t('registration.fields.removeField')"
            @click="removeField(index)"
          >
            {{ COPY.remove }}
          </button>
        </div>
      </div>
    </div>
    <button class="cta ghost" type="button" :disabled="disabled" @click="addField">
      {{ t('registration.fields.addField') }}
    </button>
  </div>
</template>

<style>
/* 收集项：同一张卡里按分隔线排列，选项行比标题更紧、更淡。 */
.collect-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* 分隔线贴着卡片左右边缘；内容仍与卡片标题对齐。 */
  margin-inline: calc(var(--s4) * -1);
  /* 第一项的浮动标题要伸出输入框上沿，留出这一截避免被裁切。 */
  padding-top: var(--s2);
}

.collect-item {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  min-width: 0;
  padding-inline: var(--s4);
  padding-bottom: var(--s2);
}

.collect-item + .collect-item {
  border-top: var(--hairline) solid var(--stroke);
  /* 浮动标题会向上探出半截，多留一截才看得出项与项的分隔。 */
  padding-top: var(--s6);
}

.collect-primary {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  min-width: 0;
}

.collect-note {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-tag);
  line-height: 1.35;
}

.collect-options {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}

.collect-options > .collect-quiet {
  padding-inline-start: calc(var(--fs-tag) * 1.5 + var(--s1));
}

.option-row {
  display: flex;
  align-items: center;
  gap: var(--s1);
  min-width: 0;
}

.option-index {
  flex: none;
  width: 1.5em;
  color: var(--ink-3);
  font-size: var(--fs-tag);
  font-weight: 700;
  text-align: center;
}

.option-input {
  min-height: var(--touch);
  padding-inline: var(--s2);
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-label);
}

.option-remove {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
}

.collect-quiet {
  min-height: var(--touch);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  padding: 0 var(--s2);
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 600;
}

.collect-quiet:disabled {
  color: var(--ink-3);
  cursor: not-allowed;
}

/* 字段标题只保留下划线（本页唯一改动的输入框）：去掉方框与浅底，
   聚焦时由 .notch-input 自己把主题色下划线画出来。 */
.notch {
  position: relative;
  display: block;
  min-width: 0;
  border: 0;
  border-bottom: var(--hairline) solid var(--stroke);
  border-radius: 0;
  background: transparent;
}

.notch-label {
  position: absolute;
  z-index: 1;
  top: 0;
  inset-inline-start: var(--s3);
  transform: translateY(-50%);
  padding: 0 var(--s1);
  background: var(--screen);
  color: var(--ink-2);
  font-size: var(--fs-meta);
  font-weight: 700;
  line-height: 1.2;
  pointer-events: none;
}

.notch-input {
  width: 100%;
  height: var(--ctrl);
  min-height: var(--ctrl);
  padding: 0 var(--s1);
  border: 0;
  border-radius: 0;
  background-color: transparent;
  /* 下划线是一层渐变：0% 宽时露出底边，聚焦时长满（与其它下划线输入框同一套动画）。 */
  background-image: linear-gradient(var(--accent), var(--accent));
  background-repeat: no-repeat;
  background-position: left bottom;
  background-size: 0% 2px;
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--ctrl);
  text-align: start;
  transition: background-size 320ms var(--ease);
}

.notch-input::placeholder {
  color: var(--ink-3);
}

.notch-input:focus-visible {
  outline: none;
}

.notch:focus-within {
  border-bottom-color: transparent;
}

.notch-input:focus,
.notch-input:focus-visible {
  background-size: 100% 2px;
}

.notch:focus-within .notch-label {
  background: var(--screen);
  color: var(--accent-ink);
}

.notch:has(:disabled) {
  opacity: 0.55;
}

.collect-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  min-width: 0;
}

.collect-ordinal {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: var(--fs-tag);
  line-height: 1.35;
  text-align: center;
  white-space: nowrap;
}

.collect-foot > .collect-quiet {
  flex: none;
  align-self: center;
}

.collect-remove {
  color: var(--danger-ink);
  font-weight: 700;
}

.tick {
  min-height: var(--touch);
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  flex: none;
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 700;
}

.tick[data-on='true'] {
  color: var(--accent-ink);
}

.tick input {
  appearance: none;
  width: 22px;
  height: 22px;
  margin: 0;
  flex: none;
  border: var(--hairline) solid var(--stroke);
  border-radius: var(--r-chip);
  background: var(--screen);
  display: grid;
  place-items: center;
}

.tick input:checked {
  border-color: var(--accent);
  background: var(--accent);
}

.tick input:checked::after {
  content: '';
  width: 5px;
  height: 9px;
  border: solid var(--on-dark);
  border-width: 0 2px 2px 0;
  transform: translateY(-1px) rotate(45deg);
}

.tick input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tick input:disabled {
  opacity: 0.5;
}
</style>
