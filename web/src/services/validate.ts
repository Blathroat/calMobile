/**
 * 表单校验。
 *
 * 字符数上限、允许上传的格式等规则由管理员在「管理-设置」里配置，bootstrap 时随
 * `limits` / `media` / `server` 下发。页面只声明字段，必填、长度、格式判断与错误文案
 * 统一在这里实现，避免各页各写一套 if。
 *
 * 与旧实现（DOM 版 `fieldValidator`）的区别：Vue 页面用响应式状态保存错误，
 * 因此这里提供纯函数 `check` 与 `validateAll`，由页面决定错误显示在哪。
 */
import { useBootstrapStore } from '@/stores/bootstrap';
import { t } from '@/i18n';

// ── 规则常量 ──────────────────────────────────────────────────────

export const PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  username: /^[A-Za-z0-9_\u4e00-\u9fa5]+$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  timeRange: /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/,
  /** 展会分类使用中文、英文、数字与常见分隔符。 */
  category: /^[A-Za-z0-9\u4e00-\u9fa5/\-·、\s]+$/,
  /** 邮箱验证码：后端固定 6 位数字。 */
  verificationCode: /^\d{6}$/,
};

const MESSAGES = {
  required: (label: string) => `请填写${label}`,
  min: (label: string, min: number) => `${label}至少需要 ${min} 个字符`,
  max: (label: string, max: number) => `${label}最多 ${max} 个字符`,
  format: (label: string) => `${label}格式不正确`,
};

/** 读取服务器下发的字符数上限，缺省时回退到内置默认值。 */
export function limit(key: string, fallback: number): number {
  const value = Number(useBootstrapStore().limits?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const AVATAR_EXPORT = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** 头像大小上限（MB）。缺省与后端 `upload.avatarSizeMb` 一致。 */
export function avatarSizeLimitMb(): number {
  const value = Number(useBootstrapStore().server.avatarSizeMb);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

/** 头像允许的后缀。缺省与后端默认列表一致。 */
export function avatarFormatList(): string[] {
  const list = useBootstrapStore().server.avatarFormats;
  const formats = Array.isArray(list)
    ? list.map((item) => String(item).toLowerCase()).filter((item) => AVATAR_EXPORT.has(item))
    : [];
  return formats.length > 0 ? formats : ['jpg', 'jpeg', 'png', 'webp'];
}

/** 裁剪导出用的 MIME：优先 jpeg，否则 png，再否则 webp。 */
export function avatarExportMime(): 'image/jpeg' | 'image/png' | 'image/webp' {
  const formats = new Set(avatarFormatList());
  if (formats.has('jpg') || formats.has('jpeg')) return 'image/jpeg';
  if (formats.has('png')) return 'image/png';
  if (formats.has('webp')) return 'image/webp';
  return 'image/jpeg';
}

/** 上传允许的后缀列表（小写，不含点）。 */
export function allowedFormats(kind: 'image' | 'video' = 'image'): string[] {
  const server = useBootstrapStore().server;
  const list = kind === 'video' ? server.videoFormats : server.imageFormats;
  return Array.isArray(list) ? list.filter(Boolean).map((item) => String(item)) : [];
}

/** 数量上限的兜底值：与后端默认值一致。 */
const COUNT_FALLBACK = { image: 8, video: 2 };

/** 大小上限（MB）的兜底值：与后端 `app_settings.media` 的默认值一致。 */
const SIZE_FALLBACK = { image: 10, video: 50 };

/**
 * 单次上传的数量上限（图片按张、视频按个）。
 *
 * `videoCount` 为 **0 是合法配置**（管理员用它表示「不允许视频」），因此只在取不到
 * 数字时兜底，不能写 `|| 2` —— 那会把禁用配置读反。
 */
export function uploadCountLimit(kind: 'image' | 'video' = 'image'): number {
  const media = useBootstrapStore().media;
  const value = Number(kind === 'video' ? media.videoCount : media.imageCount);
  return Number.isFinite(value) && value >= 0 ? value : COUNT_FALLBACK[kind];
}

/** 单个文件的大小上限（MB）：图片与视频分别读两个字段。 */
export function uploadSizeLimitMb(kind: 'image' | 'video' = 'image'): number {
  const media = useBootstrapStore().media;
  const value = Number(kind === 'video' ? media.videoSizeMb : media.imageSizeMb);
  return Number.isFinite(value) && value > 0 ? value : SIZE_FALLBACK[kind];
}

/**
 * 上传结果的大小校验：超过上限时返回可展示的错误，未超过返回空串。
 * `bytes` 缺省（原生没回报大小）时不判：宁可放过，也不要凭猜测拦下正常文件。
 */
export function uploadSizeError(kind: 'image' | 'video', bytes: unknown): string {
  const max = uploadSizeLimitMb(kind);
  const size = Number(bytes) || 0;
  if (size <= max * 1024 * 1024) return '';
  const label = kind === 'video' ? t('form.video') : t('form.image');
  return `${label}超过服务器设置的 ${max} MB 上限`;
}

// ── 基础判断 ──────────────────────────────────────────────────────

export interface CheckOptions {
  label?: string;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
  custom?: (value: string) => string;
}

/** 逐条执行规则，返回第一条错误；通过时返回空串。 */
export function check(value: unknown, options: CheckOptions = {}): string {
  const { label = t('form.thisField'), required = false, min = 0, max = 0, pattern, patternMessage, custom } = options;
  const trimmed = String(value ?? '').trim();
  if (required && trimmed === '') return MESSAGES.required(label);
  if (trimmed === '') return '';
  if (min > 0 && trimmed.length < min) return MESSAGES.min(label, min);
  if (max > 0 && trimmed.length > max) return MESSAGES.max(label, max);
  if (pattern && !pattern.test(trimmed)) return patternMessage || MESSAGES.format(label);
  if (typeof custom === 'function') return custom(trimmed) || '';
  return '';
}

/** 依次校验，返回第一条错误与它的下标；全部通过时 `ok` 为真。 */
export function validateAll(checks: Array<() => string>): { ok: boolean; message: string; index: number } {
  for (const [index, run] of checks.entries()) {
    const message = run();
    if (message) return { ok: false, message, index };
  }
  return { ok: true, message: '', index: -1 };
}

// ── 常用组合规则 ──────────────────────────────────────────────────

export function usernameRule(label = t('form.username')): CheckOptions {
  return {
    label,
    min: limit('usernameMin', 3),
    max: limit('usernameMax', 20),
    pattern: PATTERNS.username,
    patternMessage: t('form.usernameCharset'),
  };
}

export function passwordRule(): CheckOptions {
  return {
    label: t('auth.login.password'),
    min: limit('passwordMin', 6),
    max: limit('passwordMax', 32),
  };
}

/** 密码强度提示：长度达标后再看字符种类，仅作提示不做拦截。 */
export function passwordStrength(value: unknown): { level: number; label: string } {
  const text = String(value ?? '');
  if (text.length === 0) return { level: 0, label: t('profile.notFilled') };
  let score = text.length >= limit('passwordMin', 6) ? 1 : 0;
  if (/[A-Za-z]/.test(text) && /\d/.test(text)) score += 1;
  if (/[^A-Za-z0-9]/.test(text) || text.length >= 12) score += 1;
  const labels = [t('form.passwordWeak'), t('form.passwordWeak'), t('form.passwordMedium'), t('form.passwordStrong')];
  return { level: score, label: labels[score] ?? '' };
}

/** 两个密码框一致性校验。 */
export function matchRule(value: unknown, other: unknown, message = t('form.passwordMismatch')): string {
  const a = String(value ?? '');
  const b = String(other ?? '');
  if (!a || !b) return '';
  return a === b ? '' : message;
}
