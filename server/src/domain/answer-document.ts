/**
 * 收集项回答的文稿。
 *
 * 两张申请页和两条报名路由共用这一处：编码、按标题解码、必填、文本长度、选项和整段上限。
 * 空项在文稿里写成「未填写」，调用方拿到的值是空字符串。不传收集项时只按行切开，供详情展示历史原文。
 * 带上限校验时必须同时传入收集项。一份都没有时保留原文，只检查整段长度。
 */

const EMPTY = '未填写';

export interface AnswerField {
  title?: string;
  type?: string;
  required?: boolean;
  /** 字符串数组，或逗号分隔的选项字符串。 */
  options?: unknown;
}

export interface AnswerLimits {
  textFill: number;
  answer: number;
}

export interface AnswerProblem {
  /** 缺省表示整段报名内容，不是某一项。 */
  title?: string;
  message: string;
}

export interface AnswerLine {
  label: string;
  value: string;
}

export interface AnswerDocumentResult {
  /** 按标题对齐。多选是 string[]，其余是 string。没有收集项时是空对象。 */
  values: Record<string, string | string[]>;
  /** 有序行。空值是空字符串。 */
  lines: AnswerLine[];
  /** 有收集项时是按字段顺序重写的规范文稿；只解码时保持原文。 */
  text: string;
  problems: AnswerProblem[];
  /** 接口用的那一条：第一个字段错误，否则整段超长。没有问题时是空字符串。 */
  message: string;
}

export type AnswerSource = { values: Readonly<Record<string, unknown>> } | { text: unknown };

interface NormalizedField {
  title: string;
  type: string;
  required: boolean;
  options: unknown;
}

export function answerDocument(input: {
  fields?: readonly AnswerField[];
  source: AnswerSource;
  limits?: AnswerLimits;
}): AnswerDocumentResult {
  if (!input.fields) {
    const text = sourceText(input.source);
    return { values: {}, lines: displayLines(text), text, problems: [], message: '' };
  }

  const fields = normalizeFields(input.fields);
  // 展会可以没有收集项。此时答案就是调用方交来的原文，不能按空字段表改写成空串。
  if (fields.length === 0) {
    const text = sourceText(input.source);
    const problems =
      input.limits && input.limits.answer > 0 && text.length > input.limits.answer
        ? [{ message: `整段报名内容最多 ${input.limits.answer} 个字符` }]
        : [];
    return { values: {}, lines: displayLines(text), text, problems, message: problems[0]?.message ?? '' };
  }

  const values =
    'values' in input.source
      ? valuesFromMap(fields, input.source.values)
      : valuesFromText(fields, sourceText(input.source));
  const lines = fields.map((field) => ({
    label: field.title,
    value: shownValue(field, values[field.title]),
  }));
  const text = lines.map((line) => `${line.label}：${line.value || EMPTY}`).join('\n');
  const problems = input.limits ? problemsFor(fields, values, text, input.limits) : [];
  const message = problems.find((problem) => problem.title)?.message ?? problems[0]?.message ?? '';
  return { values, lines, text, problems, message };
}

function sourceText(source: AnswerSource): string {
  if ('text' in source) return String(source.text ?? '');
  return '';
}

/** 详情没有收集项定义。按第一处冒号切开，保留行序和对不上标题的行。 */
function displayLines(text: string): AnswerLine[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed.split('\n').map((line) => {
    const full = line.indexOf('：');
    const index = full >= 0 ? full : line.indexOf(':');
    if (index <= 0) return { label: '', value: line.trim() };
    return {
      label: line.slice(0, index).trim(),
      value: emptyToBlank(line.slice(index + 1).trim()),
    };
  });
}

function normalizeFields(fields: readonly AnswerField[]): NormalizedField[] {
  const list: NormalizedField[] = [];
  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    const title = String(field.title ?? '').trim();
    if (!title) continue;
    list.push({
      title,
      type: String(field.type ?? ''),
      required: field.required === true,
      options: field.options,
    });
  }
  return list;
}

function valuesFromMap(
  fields: readonly NormalizedField[],
  map: Readonly<Record<string, unknown>>,
): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const field of fields) values[field.title] = readValue(field, map[field.title]);
  return values;
}

function valuesFromText(fields: readonly NormalizedField[], text: string): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const field of fields) values[field.title] = readValue(field, storedValue(text, field.title));
  return values;
}

/** 同一标题出现多行时取第一行。全角、半角冒号都认。 */
function storedValue(text: string, title: string): string {
  for (const line of text.split('\n')) {
    for (const separator of ['：', ':']) {
      const prefix = `${title}${separator}`;
      if (!line.startsWith(prefix)) continue;
      return emptyToBlank(line.slice(prefix.length).trim());
    }
  }
  return '';
}

function readValue(field: NormalizedField, raw: unknown): string | string[] {
  if (field.type === '多选') return choices(raw);
  return scalar(raw);
}

function scalar(raw: unknown): string {
  const text = Array.isArray(raw)
    ? raw
        .map((item) => String(item).trim())
        .filter(Boolean)
        .join('、')
    : String(raw ?? '').trim();
  return emptyToBlank(text);
}

function choices(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map((item) => String(item)) : [String(raw ?? '')];
  return parts
    .flatMap((part) => (emptyToBlank(part.trim()) === '' ? [] : part.split(/[、,，]/)))
    .map((item) => item.trim())
    .filter(Boolean);
}

function shownValue(field: NormalizedField, value: string | string[] | undefined): string {
  if (field.type === '多选') return Array.isArray(value) ? value.join('、') : '';
  return typeof value === 'string' ? value : '';
}

function emptyToBlank(value: string): string {
  return value === EMPTY ? '' : value;
}

function optionList(options: unknown): string[] {
  const list = Array.isArray(options)
    ? options.map((item) => String(item).trim())
    : String(options ?? '')
        .split(',')
        .map((item) => item.trim());
  return list.filter(Boolean);
}

function problemsFor(
  fields: readonly NormalizedField[],
  values: Readonly<Record<string, string | string[]>>,
  text: string,
  limits: AnswerLimits,
): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  for (const field of fields) {
    const message = fieldProblem(field, values[field.title], limits.textFill);
    if (message) problems.push({ title: field.title, message });
  }
  if (limits.answer > 0 && text.length > limits.answer) {
    problems.push({ message: `整段报名内容最多 ${limits.answer} 个字符` });
  }
  return problems;
}

function fieldProblem(field: NormalizedField, value: string | string[] | undefined, textFill: number): string {
  if (isEmpty(field, value)) return field.required ? `请填写「${field.title}」` : '';
  if (field.type !== '单选' && field.type !== '多选') {
    const text = typeof value === 'string' ? value : '';
    if (textFill > 0 && text.length > textFill) return `「${field.title}」最多 ${textFill} 个字符`;
    return '';
  }
  const options = optionList(field.options);
  if (options.length === 0) return '';
  const chosen = field.type === '多选' && Array.isArray(value) ? value : [String(value ?? '')];
  if (chosen.some((item) => !options.includes(item))) return `「${field.title}」只能选择：${options.join(' / ')}`;
  return '';
}

function isEmpty(field: NormalizedField, value: string | string[] | undefined): boolean {
  if (field.type === '多选') return !Array.isArray(value) || value.length === 0;
  return String(value ?? '').trim() === '';
}
