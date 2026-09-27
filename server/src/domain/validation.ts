/**
 * 请求校验的共享原语。
 *
 * 路由只负责把自己的字段组合成 schema；所有「把输入转成字符串 / 整数 / 布尔」
 * 和中文错误都集中在这里，避免同一个规则在多个路由里逐项手写。
 */

import { z } from 'zod';
import { badRequest } from './errors.js';
import { readSection } from './settings.js';

export interface TextOptions {
  label?: string;
  max?: number;
  required?: boolean;
}

export interface IntOptions {
  label?: string;
  min?: number;
  max?: number;
  fallback?: number;
}

export interface IsoDateOptions {
  label?: string;
  required?: boolean;
}

export interface TimeRangeOptions {
  label?: string;
  required?: boolean;
}

export interface StringListOptions {
  label?: string;
  max?: number;
  itemMax?: number;
}

export const inputString = z.preprocess(
  (value) => String(value === undefined || value === null ? '' : value),
  z.string(),
);

/** 邮箱格式保持与邮件发送层一致。返回值只去空白，不擅自改变大小写。 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function emailInputSchema(message = '邮箱格式不正确') {
  return z
    .preprocess((value) => String(value === undefined || value === null ? '' : value).trim(), z.string())
    .superRefine((value, ctx) => {
      if (!value || !EMAIL_PATTERN.test(value) || value.length > 120) {
        ctx.addIssue({ code: 'custom', message });
      }
    });
}
export const emailSchema = emailInputSchema();

/** 从 Zod 错误中取第一条用户可见中文。 */
export function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message || '请求参数不正确';
}

/** 解析 schema；错误统一转为现有 ApiError，写路由会将其收成信封。 */
export function parseSchema<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(validationMessage(result.error));
  }
  return result.data;
}

/** 不抛异常的 schema 解析，认证路由可据此返回 200 + `{ ok:false }`。 */
export function safeParseSchema<T extends z.ZodType>(
  schema: T,
  value: unknown,
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(value);
  return result.success ? result : { success: false, error: validationMessage(result.error) };
}

/** 当前生效的字符数上限。 */
export async function limits() {
  return readSection('limits');
}

/** 必填或可选文本：去空白、校验长度。 */
export function textSchema({ label, max, required = true }: TextOptions = {}) {
  const name = label || '内容';
  const trimmed = inputString.transform((value) => value.trim());
  const checked = required ? trimmed.pipe(z.string().min(1, `请输入${name}`)) : trimmed;
  return max ? checked.pipe(z.string().max(max, `${name}最多 ${max} 个字符`)) : checked;
}

/** 整数：沿用旧实现的 parseInt 语义，可给范围与默认值。 */
export function intSchema({ label, min, max, fallback }: IntOptions = {}) {
  const name = label || '数值';
  const schema = z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return fallback;
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? parsed : value;
    },
    z
      .number({ error: (issue) => (issue.input === undefined ? `请输入${name}` : `${name}必须是整数`) })
      .refine(Number.isInteger, `${name}必须是整数`),
  );
  return schema
    .refine((value) => min === undefined || value >= min, `${name}不能小于 ${min}`)
    .refine((value) => max === undefined || value <= max, `${name}不能大于 ${max}`);
}

/** 布尔：接受 true/false、"true"/"false"、1/0。 */
export function boolSchema(fallback = false) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === 1 || value === '1';
  }, z.boolean());
}

/** 日期：只接受 YYYY-MM-DD，并回查 Date 的归一化结果。 */
export function isoDateSchema({ label, required = false }: IsoDateOptions = {}) {
  const name = label || '日期';
  return z
    .preprocess((value) => String(value === undefined || value === null ? '' : value).trim(), z.string())
    .superRefine((value, ctx) => {
      if (!value) {
        if (required) ctx.addIssue({ code: 'custom', message: `请选择${name}` });
        return;
      }
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) {
        ctx.addIssue({ code: 'custom', message: `${name}格式应为 YYYY-MM-DD` });
        return;
      }
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: 'custom', message: `${name}不是一个有效日期` });
        return;
      }
      if (date.toISOString().slice(0, 10) !== value) {
        ctx.addIssue({ code: 'custom', message: `${name}不是一个有效日期` });
      }
    });
}

/** 时间：接受 09:00-17:30 或 09:00。 */
export function timeRangeSchema({ label = '时间', required = true }: TimeRangeOptions = {}) {
  return z
    .preprocess((value) => String(value === undefined || value === null ? '' : value).trim(), z.string())
    .superRefine((value, ctx) => {
      if (!value) {
        if (required) ctx.addIssue({ code: 'custom', message: `请输入${label}` });
        return;
      }
      if (!/^\d{2}:\d{2}(-\d{2}:\d{2})?$/.test(value)) {
        ctx.addIssue({ code: 'custom', message: `${label}格式应为 09:00-17:30` });
      }
    });
}

/** 字符串数组：空值与非数组按旧规则视为空数组，项超长仍然报错。 */
export function stringListSchema({ label, max = 40, itemMax = 60 }: StringListOptions = {}) {
  const item = inputString.transform((value) => value.trim());
  return z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
            .slice(0, max)
        : [],
    z.array(item).superRefine((items, ctx) => {
      const invalid = items.find((value) => value.length > itemMax);
      if (invalid) ctx.addIssue({ code: 'custom', message: `${label || '列表项'}单项最多 ${itemMax} 个字符` });
    }),
  );
}
