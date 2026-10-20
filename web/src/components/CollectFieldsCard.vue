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
        <div class="collect-head">
          <span class="collect-ordinal">{{ itemLabel(index) }}</span>
          <SegControl
            class="collect-type"
            :model-value="item.type"
            :items="TYPE_ITEMS"
            :label="COPY.type"
            :disabled="disabled"
            @update:model-value="(value) => changeFieldType(item, value)"
          />
          <button
            class="icon-button collect-remove"
            type="button"
            :disabled="disabled"
            :aria-label="t('registration.fields.removeField')"
            @click="removeField(index)"
          >
            <AppIcon name="trash" size="icon icon-sm" />
          </button>
        </div>
        <input
          v-model="item.title"
          class="input collect-title"
          type="text"
          :placeholder="COPY.placeholder"
          :maxlength="titleMax"
          :disabled="disabled"
          :aria-label="t('registration.fields.fieldTitle')"
        />
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
          <button class="text-action collect-add-option" type="button" :disabled="disabled" @click="addOption(item)">
            {{ t('registration.fields.addOption') }}
          </button>
        </div>
        <div class="collect-foot">
          <label class="tick" :data-on="item.required ? 'true' : 'false'">
            <input v-model="item.required" type="checkbox" :disabled="disabled" />
            <span>{{ item.required ? t('registration.fields.required') : t('registration.fields.optional') }}</span>
          </label>
        </div>
      </div>
    </div>
    <button class="collect-add" type="button" :disabled="disabled" @click="addField">
      <AppIcon name="plus" size="icon icon-sm" />
      <span>{{ t('registration.fields.addField') }}</span>
    </button>
  </div>
</template>

<style scoped>
/* 收集项仍是同一张卡里用横线分隔的几段（不改成嵌套子卡片）。
   段内自上而下：序号 + 类型 + 删除、标题输入、类型提示、选项、必填。 */
.collect-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.collect-item {
  display: grid;
  gap: var(--s2);
  min-width: 0;
  padding-block: var(--s3);
}

.collect-item:first-child {
  padding-top: 0;
}

.collect-item + .collect-item {
  border-top: var(--hairline) solid var(--stroke);
}

.collect-head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

.collect-ordinal {
  flex: none;
  color: var(--ink-3);
  font-size: var(--fs-tag);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

/* 类型分段压进标题行：按钮按剩余宽度均分，窄屏也不换行。 */
.collect-type {
  flex: 1 1 auto;
  min-width: 0;
}

.collect-type :deep(button) {
  min-width: 0;
  padding-inline: var(--s2);
}

.collect-remove {
  flex: none;
  color: var(--ink-3);
  margin-inline-end: calc(var(--s2) * -1);
}

.collect-remove:disabled {
  color: var(--f2);
  cursor: not-allowed;
}

.collect-title {
  font-size: var(--fs-body);
}

.collect-note {
  color: var(--ink-3);
  font-size: var(--fs-meta);
  line-height: 1.35;
}

.collect-options {
  display: grid;
  gap: var(--s1);
  min-width: 0;
}

/* 选项行：序号 + 输入 + 删除。输入吃剩余宽度（tokens 里已有 .option-row .input）。 */
.option-row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}

.option-index {
  flex: none;
  width: 1.5em;
  color: var(--ink-3);
  font-size: var(--fs-tag);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.option-remove {
  flex: none;
  color: var(--ink-3);
  margin-inline-end: calc(var(--s3) * -1);
}

.option-remove:disabled {
  color: var(--f2);
  cursor: not-allowed;
}

.collect-add-option {
  align-self: flex-start;
  padding-inline-start: calc(1.5em + var(--s2));
}

.collect-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  min-width: 0;
}

/* 必填开关：小方框，选中时落成主题色。 */
.tick {
  min-height: var(--touch);
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  color: var(--ink-2);
  font-size: var(--fs-label);
  font-weight: 600;
}

.tick[data-on='true'] {
  color: var(--accent-ink);
}

.tick input {
  flex: none;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}

.tick input:disabled {
  opacity: 0.5;
}

/* 新增收集项：虚线整行按钮，是这张卡的收尾。 */
.collect-add {
  width: 100%;
  min-height: var(--touch);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
  padding: var(--s3);
  border: var(--hairline) dashed var(--stroke);
  border-radius: var(--r-input);
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-meta);
  font-weight: 600;
}

.collect-add:disabled {
  color: var(--f2);
  cursor: not-allowed;
}
</style>
