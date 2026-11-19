/**
 * 新建展会还没有 id 时，简介编辑页与表单之间暂存的稿。
 *
 * 只活在这次打开应用的内存里：保存展会成功后清掉。
 * 刷新或进程重启后稿就没了，不会当成已创建的展会。
 */
import type { CollectField } from '@/components/CollectFieldsCard.vue';

export interface ExhibitionDraft {
  /** 编辑已有展会时带的展会 id（新建为空串，缺省）：二级页据此判断草稿属于哪场展会。 */
  id?: string;
  title: string;
  venue: string;
  date: string;
  /** 闭展日期；空串（或缺省）表示还没选（单日展会按 NULL 存），与开展同一天时照原样记这一天。 */
  endDate?: string;
  time: string;
  status: string;
  category: string;
  description: string;
  imageUri: string;
  registrationStart: string;
  registrationEnd: string;
  qrEnabled: boolean;
  allowCancel: boolean;
  /** 报名注意事项（选填）；缺省视为空串，兼容旧草稿。 */
  registrationNotice?: string;
  fields: CollectField[];
}

let current: ExhibitionDraft | null = null;

function copyFields(fields: CollectField[]): CollectField[] {
  return fields.map((field) => ({
    title: field.title,
    type: field.type,
    required: field.required,
    options: [...field.options],
  }));
}

export function stashExhibitionDraft(draft: ExhibitionDraft): void {
  current = { ...draft, fields: copyFields(draft.fields) };
}

export function readExhibitionDraft(): ExhibitionDraft | null {
  return current;
}

export function patchExhibitionDraft(description: string): void {
  if (!current) return;
  current.description = description;
}

export function clearExhibitionDraft(): void {
  current = null;
}
