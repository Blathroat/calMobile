import { t } from '@/i18n';
/**
 * 收集项编辑时的长度校验。上限来自管理设置，展会和私人会议共用。
 */
export interface CollectLimitField {
  title: string;
  type: string;
  options: string[];
}

export interface CollectLimitBounds {
  title: number;
  radio: number;
  check: number;
}

export function collectFieldError(item: CollectLimitField, bounds: CollectLimitBounds): string {
  if (item.title.trim().length > bounds.title) {
    return `文本框标题最多 ${bounds.title} 个字符`;
  }
  if (item.type === '文本') return '';
  const max = item.type === '多选' ? bounds.check : bounds.radio;
  const name = item.type === '多选' ? t('admin.limits.checkOption') : t('admin.limits.radioOption');
  if (item.options.some((option) => option.trim().length > max)) {
    return `${name}最多 ${max} 个字符`;
  }
  return '';
}

export function firstCollectFieldError(items: CollectLimitField[], bounds: CollectLimitBounds): string {
  for (const item of items) {
    const message = collectFieldError(item, bounds);
    if (message) return message;
  }
  return '';
}
