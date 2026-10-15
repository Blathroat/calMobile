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
  hint: string;
  titleMax: number;
  /** 单选选项字数上限。缺省与后端默认一致。 */
  radioMax?: number;
  /** 多选选项字数上限。缺省与后端默认一致。 */
  checkMax?: number;
  disabled?: boolean;
}>();

const FIELD_TYPES = ['文本', '单选', '多选'] as const;
const TYPE_ITEMS = FIELD_TYPES.map((type) => ({ value: type, label: type }));

const COPY = {
  title: t('exhibition.editor.heading'),
  type: t('registration.fields.fieldType'),
  remove: t('common.delete'),
  option: t('registration.fields.option'),
  ordinal: t('registration.fields.ordinalPrefix'),
  unit: t('registration.fields.itemUnit'),
  placeholder: t('registration.fields.questionPlaceholder'),
  empty: t('registration.fields.emptyHint'),
  textHint: t('registration.fields.textInputHint'),
  radioHint: t('registration.fields.singleChoiceHint'),
  checkHint: t('registration.fields.multiChoiceHint'),
};

function addField(): void {
  props.fields.push({ title: '', type: '文本', required: false, options: [] });
}

function removeField(index: number): void {
  props.fields.splice(index, 1);
}

function changeFieldType(item: CollectField, type: string): void {
  item.type = type;
  // 切到单选 / 多选时留出一格。一个选项就够用，多的由编辑的人自己加。
  if (type !== '文本' && item.options.length === 0) item.options = [''];
}

function addOption(item: CollectField): void {
  item.options.push('');
}

function removeOption(item: CollectField, index: number): void {
  item.options.splice(index, 1);
}

function isChoice(item: CollectField): boolean {
  return item.type === '单选' || item.type === '多选';
}

function typeHint(item: CollectField): string {
  if (item.type === '单选') return COPY.radioHint;
  if (item.type === '多选') return COPY.checkHint;
  return COPY.textHint;
}

function optionLabel(index: number): string {
  return `${COPY.option} ${index + 1}`;
}

function optionMax(item: CollectField): number {
  return item.type === '多选' ? (props.checkMax ?? 60) : (props.radioMax ?? 60);
}

function itemLabel(index: number): string {
  return `${COPY.ordinal} ${index + 1} ${COPY.unit}`;
}

</script>

<template>
  <div class="card">
    <div class="row" data-between="true">
      <span class="section-label">{{ label }}</span>
      <span class="pill">{{ `${fields.length} 项` }}</span>
    </div>
    <p class="field-hint">{{ hint }}</p>
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
          :aria-label="item.type === '单选' ? t('admin.limits.radioOption') : t('admin.limits.checkOption')"
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
              :aria-label="`删除选项 ${optionIndex + 1}`"
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
            <span>{{ item.required ? '必填' : '选填' }}</span>
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
    <button class="cta ghost" type="button" :disabled="disabled" @click="addField">{{ t('registration.fields.addField') }}</button>
  </div>
</template>
