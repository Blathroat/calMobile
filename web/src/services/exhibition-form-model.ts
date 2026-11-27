import type { ExhibitionDetail, JsonObject } from '@/api/types';
import type { CollectField } from '@/components/CollectFieldsCard.vue';
import { EXHIBITION_STATUS, FIELD_TYPE, REGISTRATION_MODES } from '@/services/status';
import type { ExhibitionDraft } from '@/services/exhibition-draft';

export interface ExhibitionFormModel {
  title: string;
  venue: string;
  date: string;
  endDate: string;
  time: string;
  status: string;
  category: string;
  description: string;
  imageUri: string;
  registrationStart: string;
  registrationEnd: string;
  qrEnabled: boolean;
  allowCancel: boolean;
  registrationNotice: string;
}

export interface ExhibitionFormContent {
  model: ExhibitionFormModel;
  fields: CollectField[];
}

export function emptyExhibitionFormModel(): ExhibitionFormModel {
  return {
    title: '',
    venue: '',
    date: '',
    endDate: '',
    time: '',
    status: EXHIBITION_STATUS.REVIEW_REQUIRED,
    category: '',
    description: '',
    imageUri: '',
    registrationStart: '',
    registrationEnd: '',
    qrEnabled: false,
    allowCancel: true,
    registrationNotice: '',
  };
}

/** 保存请求与未保存基线共用同一份字段归一化结果。 */
export function submittedExhibitionData(model: ExhibitionFormModel, fields: CollectField[]): JsonObject {
  return {
    title: model.title.trim(),
    venue: model.venue.trim(),
    date: model.date,
    endDate: model.endDate,
    time: model.time.trim(),
    status: model.status,
    category: model.category.trim(),
    description: model.description,
    descriptionFormat: 'md',
    imageUri: model.imageUri,
    registrationStart: model.registrationStart,
    registrationEnd: model.registrationEnd,
    qrEnabled: model.qrEnabled,
    allowCancel: model.allowCancel,
    registrationNotice: model.registrationNotice.trim(),
    fields: fields
      .filter((field) => field.title.trim() !== '')
      .map((field) => ({
        title: field.title.trim(),
        type: field.type,
        required: field.required,
        options: field.type === FIELD_TYPE.TEXT ? [] : field.options.map((option) => option.trim()).filter(Boolean),
      })),
  };
}

/**
 * 服务器详情与内存稿各自的字段类型不同，但缺省规则完全一样：字符串字段一律
 * `String(... ?? '')` 兜空，状态不在清单里退回「需审核」。两边都先收成可索引对象再映射。
 */
function toFormModel(raw: object, statusCode: unknown): ExhibitionFormModel {
  const source = raw as Record<string, unknown>;
  const status = String(statusCode ?? '');
  return {
    title: String(source.title ?? ''),
    venue: String(source.venue ?? ''),
    date: String(source.date ?? ''),
    endDate: String(source.endDate ?? ''),
    time: String(source.time ?? ''),
    status: REGISTRATION_MODES.some((mode) => mode === status) ? status : EXHIBITION_STATUS.REVIEW_REQUIRED,
    category: String(source.category ?? ''),
    description: String(source.description ?? ''),
    imageUri: String(source.imageUri ?? ''),
    registrationStart: String(source.registrationStart ?? ''),
    registrationEnd: String(source.registrationEnd ?? ''),
    qrEnabled: source.qrEnabled === true,
    allowCancel: source.allowCancel !== false,
    registrationNotice: String(source.registrationNotice ?? ''),
  };
}

/** 收集项归一化：缺类型按文本处理，选项统一成字符串数组。 */
function toCollectField(field: object): CollectField {
  const { title, type, required, options } = field as Record<string, unknown>;
  return {
    title: String(title ?? ''),
    type: String(type ?? FIELD_TYPE.TEXT),
    required: required === true,
    options: normalizeOptions(options),
  };
}

/** 将详情映射到表单，并保留旧记录中不再出现在分类清单里的值。 */
export function exhibitionContentFromServer(item: JsonObject, data: ExhibitionDetail): ExhibitionFormContent {
  return {
    model: toFormModel(item, item.statusCode),
    fields: (data.fields ?? []).map(toCollectField),
  };
}

/** 内存稿回填：内容来自用户刚填的表单，映射规则与服务器详情一致。 */
export function exhibitionContentFromDraft(draft: ExhibitionDraft): ExhibitionFormContent {
  return {
    model: toFormModel(draft, draft.status),
    fields: draft.fields.map(toCollectField),
  };
}

function normalizeOptions(options: unknown): string[] {
  if (Array.isArray(options)) return options.map((item) => String(item));
  return String(options || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
