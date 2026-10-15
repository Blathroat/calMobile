/** 路由请求 schema：只组合 validation.ts 的共享原语，业务查询仍留在路由。 */

import { z } from 'zod';
import * as labels from './labels.js';
import {
  boolSchema,
  emailInputSchema,
  inputString,
  intSchema,
  isoDateSchema,
  stringListSchema,
  textSchema,
  timeRangeSchema,
} from './validation.js';
import type { ServerSettings } from '../config/migrate.js';

export type Limits = ServerSettings['limits'];

const usernamePattern = /^[A-Za-z0-9_.-]+$/;

export const loginSchema = z
  .object({
    username: textSchema({ required: false }),
    password: inputString,
    deviceToken: z.string().trim().max(128).optional(),
    deviceName: z.string().trim().max(80).optional(),
  })
  .superRefine(({ username, password }, ctx) => {
    if (!username || !password) ctx.addIssue({ code: 'custom', message: '请输入账号与密码' });
  });
export type LoginInput = z.infer<typeof loginSchema>;

export const loginVerifySchema = z
  .object({
    ticket: textSchema({ required: false }),
    code: textSchema({ required: false }),
    deviceToken: z.string().trim().max(128).optional(),
    deviceName: z.string().trim().max(80).optional(),
    trustDevice: z.boolean().optional(),
  })
  .superRefine(({ ticket, code }, ctx) => {
    if (!ticket || !code) ctx.addIssue({ code: 'custom', message: '请填写验证码' });
  });
export type LoginVerifyInput = z.infer<typeof loginVerifySchema>;

export const ticketSchema = z.object({ ticket: textSchema({ required: false }) });
export const codeSchema = z.object({ code: textSchema({ required: false }) });
export const registerVerifySchema = z.object({
  email: inputString.transform((value) => value.trim()),
  code: inputString.transform((value) => value.trim()),
  deviceToken: z.string().trim().max(128).optional(),
  deviceName: z.string().trim().max(80).optional(),
});
export const refreshSchema = z.object({ refreshToken: inputString });
export const logoutSchema = z.object({ refreshToken: inputString });

export function registerSchema(limits: Limits) {
  return z.object({
    username: inputString
      .transform((value) => value.trim())
      .superRefine((value, ctx) => {
        if (value.length < limits.usernameMin || value.length > limits.usernameMax) {
          ctx.addIssue({
            code: 'custom',
            message: `用户名长度需在 ${limits.usernameMin}-${limits.usernameMax} 个字符之间`,
          });
        }
        if (!usernamePattern.test(value)) {
          ctx.addIssue({ code: 'custom', message: '用户名只能包含字母、数字、下划线、点或横线' });
        }
      }),
    password: inputString.superRefine((value, ctx) => {
      if (value.length < limits.passwordMin || value.length > limits.passwordMax) {
        ctx.addIssue({
          code: 'custom',
          message: `密码长度需在 ${limits.passwordMin}-${limits.passwordMax} 个字符之间`,
        });
      }
    }),
    email: emailInputSchema('请输入有效的邮箱地址'),
  });
}
export type RegisterInput = z.infer<ReturnType<typeof registerSchema>>;

export function resetPasswordSchema(limits: Limits) {
  return z
    .object({
      email: inputString.transform((value) => value.trim()),
      code: textSchema({ required: false }),
      newPassword: inputString,
      confirmPassword: inputString,
    })
    .superRefine(({ newPassword, confirmPassword }, ctx) => {
      if (newPassword !== confirmPassword) {
        ctx.addIssue({ code: 'custom', message: '两次输入的新密码不一致' });
      } else if (newPassword.length < limits.passwordMin || newPassword.length > limits.passwordMax) {
        ctx.addIssue({
          code: 'custom',
          message: `密码长度需在 ${limits.passwordMin}-${limits.passwordMax} 个字符之间`,
        });
      }
    });
}
export type ResetPasswordInput = z.infer<ReturnType<typeof resetPasswordSchema>>;

export function profilePatchSchema(limits: Limits) {
  return z
    .object({
      nickname: inputString
        .transform((value) => value.trim())
        .superRefine((value, ctx) => {
          if (!value) ctx.addIssue({ code: 'custom', message: '昵称不能为空' });
          if (value.length > limits.nickname)
            ctx.addIssue({ code: 'custom', message: `昵称最多 ${limits.nickname} 个字符` });
        }),
      email: inputString,
      bio: textSchema({ label: '个人简介', max: limits.bio, required: false }),
      region: textSchema({ label: '地区', max: limits.region, required: false }),
      socialMedia: textSchema({ required: false }),
      avatar: textSchema({ required: false }),
      showRegistrations: boolSchema(),
    })
    .partial()
    .superRefine((value, ctx) => {
      if ('email' in value)
        ctx.addIssue({ code: 'custom', path: ['email'], message: '邮箱需要通过「验证新邮箱」修改' });
    });
}
export type ProfilePatchInput = z.infer<ReturnType<typeof profilePatchSchema>>;

export function passwordChangeSchema(limits: Limits) {
  return z
    .object({ newPassword: inputString, confirmPassword: inputString })
    .superRefine(({ newPassword, confirmPassword }, ctx) => {
      if (!newPassword || !confirmPassword) {
        ctx.addIssue({ code: 'custom', message: '请填写完整密码' });
      } else if (newPassword !== confirmPassword) {
        ctx.addIssue({ code: 'custom', message: '两次输入的新密码不一致' });
      } else if (newPassword.length < limits.passwordMin) {
        ctx.addIssue({ code: 'custom', message: `密码至少需要 ${limits.passwordMin} 个字符` });
      } else if (newPassword.length > limits.passwordMax) {
        ctx.addIssue({ code: 'custom', message: `密码最多 ${limits.passwordMax} 个字符` });
      }
    });
}
export type PasswordChangeInput = z.infer<ReturnType<typeof passwordChangeSchema>>;

export const securityIdentitySchema = z.object({
  method: z.enum(['email', 'totp']),
  scope: z.enum(['password', 'email', 'totp', 'totp-confirm', 'factor']),
  code: inputString.pipe(z.string().trim().regex(/^\d{6}$/, '请输入 6 位数字验证码')),
});

export const passwordOnlySchema = z.object({ password: inputString }).superRefine(({ password }, ctx) => {
  if (!password) ctx.addIssue({ code: 'custom', path: ['password'], message: '请输入当前密码' });
});
export const emailSchema = z.object({ email: emailInputSchema('邮箱格式不正确') });
export const emailVerifyLooseSchema = z.object({
  email: inputString.transform((value) => value.trim()),
  code: inputString.transform((value) => value.trim()),
});
export const uiModeSchema = z.object({ mode: inputString });
/** 个人配色：下标是色板上的一个位置，合法范围由路由按补齐后的色板长度判定。 */
export const uiThemeSchema = z.object({ themeIndex: z.unknown() });
export const notifySchema = z
  .object({
    exhibitionReminder: boolSchema(),
    registrationUpdates: boolSchema(),
  })
  .partial();
export const serverSettingsPatchSchema = z
  .object({
    themeIndex: z.unknown(),
    announcement: z.unknown(),
    announcementEnabled: z.unknown(),
    appTitleZh: z.unknown(),
    appTitleEn: z.unknown(),
    categories: z.unknown(),
    canRevise: z.unknown(),
    imageCount: z.unknown(),
    imageSizeMb: z.unknown(),
    videoCount: z.unknown(),
    videoSizeMb: z.unknown(),
    avatarSizeMb: z.unknown(),
    avatarFormats: z.unknown(),
    imageFormats: z.unknown(),
    videoFormats: z.unknown(),
    exhibitionTitle: z.unknown(),
    exhibitionVenue: z.unknown(),
    category: z.unknown(),
    fieldTitle: z.unknown(),
    usernameMin: z.unknown(),
    usernameMax: z.unknown(),
    passwordMin: z.unknown(),
    passwordMax: z.unknown(),
    nickname: z.unknown(),
    bio: z.unknown(),
    region: z.unknown(),
    answer: z.unknown(),
    // 缺省展会封面（媒体短 URL）与「展商可同时筹备的展会数」上限（0 = 不限）
    defaultCover: z.unknown(),
    maxFutureExhibitions: z.unknown(),
    maxFutureMeetings: z.unknown(),
    notify: notifySchema,
  })
  .partial()
  .passthrough();
export const userStatusSchema = z.object({
  status: z.preprocess(labels.toUserStatus, z.string({ error: labels.USER_STATUS_HINT })),
});
export const adminTwoFactorSchema = z.object({
  enabled: z.literal(false, { error: '两步验证只能由本人开启（需要验证码）' }),
});
export const exhibitionStatusSchema = z.object({
  status: z.preprocess(labels.toExhibitionStatus, z.string({ error: labels.EXHIBITION_STATUS_HINT })),
});
export const reviewQuerySchema = z
  .object({
    status: inputString
      .transform((value) => value.trim())
      .refine(
        (value) => !value || value === '全部' || Boolean(labels.toRegistrationStatus(value)),
        labels.REGISTRATION_STATUS_HINT,
      ),
  })
  .transform(({ status }) => ({
    statusLabel: status || '全部',
    statusCode: !status || status === '全部' ? '' : labels.toRegistrationStatus(status) || '',
  }));

export const monthQuerySchema = z.object({
  year: intSchema({ label: '年份', min: 1970, max: 9999 }),
  month: intSchema({ label: '月份', min: 1, max: 12 }),
  day: intSchema({ label: '日期', min: 0, max: 31, fallback: 0 }),
});

export function fieldSchema(limits: Limits) {
  const objectSchema = z
    .object({
      type: z
        .preprocess((value) => String(value === undefined || value === null ? '文本' : value).trim(), z.string())
        .refine(
          (value): value is (typeof labels.EXHIBITION_FIELD_TYPES)[number] =>
            (labels.EXHIBITION_FIELD_TYPES as readonly string[]).includes(value),
          '收集项类型只能是 文本 / 单选 / 多选',
        ),
      title: textSchema({ label: '收集项标题', max: limits.fieldTitle }),
      required: boolSchema(false),
      options: z.unknown().optional(),
    })
    .transform((field, ctx) => {
      if (field.type === '文本') return { ...field, options: [] };
      const options = stringListSchema({ label: '选项' }).safeParse(field.options);
      if (!options.success) {
        ctx.addIssue({ code: 'custom', message: options.error.issues[0]?.message || '请求参数不正确' });
        return z.NEVER;
      }
      return { ...field, options: options.data };
    });
  return z.preprocess(
    (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    objectSchema,
  );
}

export function fieldsSchema(limits: Limits) {
  return z.array(fieldSchema(limits), { error: '收集项需为数组' }).max(50, '收集项最多 50 项');
}

/** 私人会议设置：是否接受预约、通过后能否撤销、申请页说明，以及展商自己的收集项。 */
export function meetingSettingsSchema(limits: Limits) {
  return z.object({
    acceptMeetings: boolSchema(false),
    allowCancel: boolSchema(false),
    notice: textSchema({ label: '预约说明', max: 400, required: false }),
    fields: fieldsSchema(limits),
  });
}

/** 私人会议申请：日期必填，时间选填，答案是收集项拼出来的文本。 */
export function meetingApplySchema(answerMax: number) {
  return z.object({
    exhibitorId: textSchema({ label: '展商', max: 80 }),
    meetingDate: isoDateSchema({ label: '会议日期', required: true }),
    meetingTime: textSchema({ label: '会议时间', max: 20, required: false }),
    answers: textSchema({ label: '报名信息', max: answerMax, required: false }),
  });
}

function descriptionFormatSchema() {
  return inputString.transform((value) => (value === 'html' ? 'html' : 'md'));
}

export function exhibitionInputSchema(
  limits: Limits,
  existing?: {
    title?: string | null;
    venue?: string | null;
    category?: string | null;
    exhibition_date?: string | null;
    time?: string | null;
    status?: string | null;
    registration_start?: string | null;
    registration_end?: string | null;
    description?: string | null;
    description_format?: string | null;
    image_uri?: string | null;
    exhibitor_note?: string | null;
    qr_enabled?: boolean | null;
    allow_cancel?: boolean | null;
  },
) {
  const creating = !existing;
  const schema = z
    .object({
      title: textSchema({ label: '展会名称', max: limits.exhibitionTitle, required: false }),
      venue: textSchema({ label: '展会地点', max: limits.exhibitionVenue, required: false }),
      category: textSchema({ label: '展会分类', max: limits.category, required: false }),
      date: isoDateSchema({ label: '展会日期', required: true }),
      time: timeRangeSchema({ label: '展会时间', required: true }),
      status: inputString,
      registrationStart: isoDateSchema({ label: '报名开始日期' }),
      registrationEnd: isoDateSchema({ label: '报名截止日期' }),
      description: inputString,
      descriptionFormat: descriptionFormatSchema(),
      imageUri: inputString,
      exhibitorNote: inputString,
      qrEnabled: boolSchema(false),
      allowCancel: z.preprocess((value) => {
        if (value === undefined || value === null || value === '') return undefined;
        if (typeof value === 'boolean') return value;
        return value === 'true' || value === 1 || value === '1';
      }, z.boolean().optional()),
      fields: z.preprocess((value) => (Array.isArray(value) ? value : null), fieldsSchema(limits).nullable()),
    })
    .partial();
  return schema
    .superRefine((source, ctx) => {
      const title = source.title || '';
      if (!title) ctx.addIssue({ code: 'custom', path: ['title'], message: '展会名称不能为空' });
      const date = source.date ?? existing?.exhibition_date ?? '';
      const time = source.time ?? existing?.time ?? '';
      if (creating && !date) ctx.addIssue({ code: 'custom', path: ['date'], message: '请选择展会日期' });
      if (creating && !time) ctx.addIssue({ code: 'custom', path: ['time'], message: '请输入展会时间' });
      const registrationStart = source.registrationStart ?? existing?.registration_start ?? '';
      const registrationEnd = source.registrationEnd ?? existing?.registration_end ?? '';
      if (registrationStart && registrationEnd && registrationEnd < registrationStart) {
        ctx.addIssue({ code: 'custom', path: ['registrationEnd'], message: '报名截止日期不能早于开始日期' });
      }
      const mappedStatus =
        source.status && source.status.trim() ? labels.toExhibitionStatus(source.status) : existing?.status || 'review';
      if (!mappedStatus)
        ctx.addIssue({
          code: 'custom',
          path: ['status'],
          message: labels.EXHIBITION_STATUS_HINT,
        });
    })
    .transform((source) => {
      const title = source.title || '';
      const date = source.date ?? existing?.exhibition_date ?? '';
      const time = source.time ?? existing?.time ?? '';
      const registrationStart = source.registrationStart ?? existing?.registration_start ?? '';
      const registrationEnd = source.registrationEnd ?? existing?.registration_end ?? '';
      const description = source.description ?? existing?.description ?? '';
      const requestedFormat = source.descriptionFormat ?? existing?.description_format ?? 'md';
      const descriptionFormat =
        requestedFormat === 'html' || /^\s*<(p|div|h[1-6]|ul|ol|blockquote|br|strong|em)\b/.test(description)
          ? 'html'
          : 'md';
      const mappedStatus =
        source.status && source.status.trim() ? labels.toExhibitionStatus(source.status) : existing?.status || 'review';
      return {
        title,
        venue: source.venue ?? existing?.venue ?? '',
        category: source.category ?? existing?.category ?? '',
        date,
        time,
        status: mappedStatus,
        registrationStart,
        registrationEnd,
        description,
        descriptionFormat,
        imageUri: source.imageUri ?? existing?.image_uri ?? '',
        exhibitorNote: source.exhibitorNote ?? (creating ? '主办方公开信息' : (existing?.exhibitor_note ?? '')),
        qrEnabled: source.qrEnabled ?? Boolean(existing?.qr_enabled),
        allowCancel: source.allowCancel ?? (existing ? existing.allow_cancel !== false : true),
        fields: Array.isArray(source.fields) && source.fields.length > 0 ? source.fields : null,
      };
    });
}
export type ExhibitionInput = z.infer<ReturnType<typeof exhibitionInputSchema>>;

export function registrationSchema(answerMax = 0) {
  return z.object({
    exhibitionId: textSchema({ label: '展会', required: false }),
    visitorName: textSchema({ label: '姓名' }),
    visitorType: textSchema({ label: '参观身份' }),
    answers: inputString.refine(
      (value) => answerMax <= 0 || value.length <= answerMax,
      `报名填写内容最多 ${answerMax} 个字符`,
    ),
  });
}
export type RegistrationInput = z.infer<ReturnType<typeof registrationSchema>>;
export const registrationTargetSchema = z.object({ exhibitionId: textSchema({ required: false }) });
export const reviewStatusSchema = z.object({
  status: z.preprocess(labels.toRegistrationStatus, z.string({ error: labels.REGISTRATION_STATUS_HINT })),
});
export const checkinSchema = z.object({ code: textSchema({ required: false }) });
