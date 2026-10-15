/**
 * 新建展会还没有 id 时，简介编辑页与表单之间暂存的稿。
 *
 * 只活在这次打开应用的内存里：保存展会成功后清掉。
 * 刷新或进程重启后稿就没了，不会当成已创建的展会。
 */
import type { CollectField } from '@/components/CollectFieldsCard.vue';

export interface ExhibitionDraft {
  title: string;
  venue: string;
  date: string;
  time: string;
  status: string;
  category: string;
  description: string;
  imageUri: string;
  registrationStart: string;
  registrationEnd: string;
  qrEnabled: boolean;
  allowCancel: boolean;
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
