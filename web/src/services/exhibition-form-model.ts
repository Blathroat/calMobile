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

/** 将详情映射到表单，并保留旧记录中不再出现在分类清单里的值。 */
export function exhibitionContentFromServer(item: JsonObject, data: ExhibitionDetail): ExhibitionFormContent {
  const status = String(item.statusCode ?? '');
  return {
    model: {
      title: String(item.title ?? ''),
      venue: String(item.venue ?? ''),
      date: String(item.date ?? ''),
      endDate: String(item.endDate ?? ''),
      time: String(item.time ?? ''),
      status: REGISTRATION_MODES.some((mode) => mode === status) ? status : EXHIBITION_STATUS.REVIEW_REQUIRED,
      category: String(item.category ?? ''),
      description: String(item.description ?? ''),
      imageUri: String(item.imageUri ?? ''),
      registrationStart: String(item.registrationStart ?? ''),
      registrationEnd: String(item.registrationEnd ?? ''),
      qrEnabled: item.qrEnabled === true,
      allowCancel: item.allowCancel !== false,
      registrationNotice: String(item.registrationNotice ?? ''),
    },
    fields: (data.fields ?? []).map((field) => ({
      title: String(field.title ?? ''),
      type: String(field.type ?? FIELD_TYPE.TEXT),
      required: field.required === true,
      options: normalizeOptions(field.options),
    })),
  };
}

export function exhibitionContentFromDraft(draft: ExhibitionDraft): ExhibitionFormContent {
  return {
    model: {
      title: draft.title,
      venue: draft.venue,
      date: draft.date,
      endDate: draft.endDate ?? '',
      time: draft.time,
      status: REGISTRATION_MODES.some((mode) => mode === draft.status)
        ? draft.status
        : EXHIBITION_STATUS.REVIEW_REQUIRED,
      category: draft.category,
      description: draft.description,
      imageUri: draft.imageUri,
      registrationStart: draft.registrationStart,
      registrationEnd: draft.registrationEnd,
      qrEnabled: draft.qrEnabled,
      allowCancel: draft.allowCancel,
      registrationNotice: draft.registrationNotice ?? '',
    },
    fields: draft.fields.map((field) => ({
      title: field.title,
      type: field.type,
      required: field.required,
      options: [...field.options],
    })),
  };
}

function normalizeOptions(options: unknown): string[] {
  if (Array.isArray(options)) return options.map((item) => String(item));
  return String(options || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
