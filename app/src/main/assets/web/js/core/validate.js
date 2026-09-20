import { t } from './strings.js';
/**
 * 表单校验。
 *
 * 字符数上限、允许上传的格式等规则由管理员在「管理-设置」里配置，
 * bootstrap 时随 state.limits / state.server 下发。页面只声明字段，
 * 具体的必填、长度、格式判断与错误提示统一在这里实现，避免各页各写一套 if。
 */

import { state } from './bridge.js';
import { el } from './dom.js';

// ── 规则常量 ──────────────────────────────────────────────────────

export const PATTERNS = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    username: /^[A-Za-z0-9_\u4e00-\u9fa5]+$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
    timeRange: /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/,
    /** 展会分类使用中文、英文、数字与常见分隔符。 */
    category: /^[A-Za-z0-9\u4e00-\u9fa5/\-·、\s]+$/,
    /** 邮箱验证码：后端固定 6 位数字（见 server/src/domain/otp.js 的 CODE_LENGTH）。 */
    verificationCode: /^\d{6}$/,
};

const MESSAGES = {
    required: (label) => `请填写${label}`,
    min: (label, min) => `${label}至少需要 ${min} 个字符`,
    max: (label, max) => `${label}最多 ${max} 个字符`,
    format: (label) => `${label}格式不正确`,
};

/** 读取服务器下发的字符数上限，缺省时回退到内置默认值。 */
export function limit(key, fallback) {
    const value = Number(state.limits?.[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 上传允许的后缀列表（小写，不含点）。 */
export function allowedFormats(kind = 'image') {
    const list = kind === 'video' ? state.server?.videoFormats : state.server?.imageFormats;
    return Array.isArray(list) ? list.filter(Boolean) : [];
}

/** 数量上限的兜底值：与 core/bridge.js 的 state.media 默认值、后端默认值一致。 */
const COUNT_FALLBACK = { image: 8, video: 2 };

/** 大小上限（MB）的兜底值：与后端 `app_settings.media` 的默认值一致。 */
const SIZE_FALLBACK = { image: 10, video: 50 };

/**
 * 单次上传的数量上限（图片按张、视频按个），来自服务器设置 `state.media`。
 * <p>
 * 注意 `videoCount` 为 **0 是合法配置**（管理员可以用它表示「不允许视频」），
 * 因此这里只在取不到数字时兜底，不能写成 `state.media.videoCount || 2`——
 * 那会把 0 悄悄换成 2，等于把禁用配置读反。
 */
export function uploadCountLimit(kind = 'image') {
    const value = Number(kind === 'video' ? state.media?.videoCount : state.media?.imageCount);
    return Number.isFinite(value) && value >= 0 ? value : COUNT_FALLBACK[kind] ?? COUNT_FALLBACK.image;
}

/** 单个文件的大小上限（MB）：图片与视频分别读 `state.media` 的两个字段。 */
export function uploadSizeLimitMb(kind = 'image') {
    const value = Number(kind === 'video' ? state.media?.videoSizeMb : state.media?.imageSizeMb);
    return Number.isFinite(value) && value > 0 ? value : SIZE_FALLBACK[kind] ?? SIZE_FALLBACK.image;
}

/**
 * 上传结果的大小校验：超过服务器设置的上限时返回可展示的错误，未超过返回空串。
 * <p>
 * `bytes` 缺省（原生没回报大小）时不判：宁可放过，也不要凭猜测拦下正常文件。
 */
export function uploadSizeError(kind, bytes) {
    const limit = uploadSizeLimitMb(kind);
    const size = Number(bytes) || 0;
    if (size <= limit * 1024 * 1024) {
        return '';
    }
    const label = kind === 'video' ? t('s_q79se0') : t('s_1k84spe');
    return `${label}超过服务器设置的 ${limit} MB 上限`;
}

// ── 基础判断 ──────────────────────────────────────────────────────

/** 逐条执行规则，返回第一条错误；通过时返回空串。 */
export function check(value, options = {}) {
    const {
        label = t('s_1qafeqo'),
        required = false,
        min = 0,
        max = 0,
        pattern,
        patternMessage,
        custom,
    } = options;
    const text = String(value ?? '');
    const trimmed = text.trim();
    if (required && trimmed === '') {
        return MESSAGES.required(label);
    }
    if (trimmed === '') {
        return '';
    }
    if (min > 0 && trimmed.length < min) {
        return MESSAGES.min(label, min);
    }
    if (max > 0 && trimmed.length > max) {
        return MESSAGES.max(label, max);
    }
    if (pattern && !pattern.test(trimmed)) {
        return patternMessage || MESSAGES.format(label);
    }
    if (typeof custom === 'function') {
        return custom(trimmed) || '';
    }
    return '';
}

// ── 字段级校验器 ──────────────────────────────────────────────────

/**
 * 为一个控件绑定校验：自动写入 maxlength、维护字数提示与内联错误。
 *
 * @returns {{check: Function, clear: Function, show: Function, focus: Function, control: Element}}
 */
export function fieldValidator(options) {
    const {
        control,
        label,
        required = false,
        min = 0,
        max = 0,
        pattern,
        patternMessage,
        custom,
        counter = max > 0,
    } = options;

    if (!control) {
        return { check: () => '', clear: () => {}, show: () => {}, focus: () => {}, control: null };
    }
    if (max > 0) {
        control.setAttribute('maxlength', String(max));
    }

    const host = control.closest('.field') || control.parentElement;
    let errorNode = null;
    let counterNode = null;

    if (counter && host) {
        counterNode = el('span', { class: 'field-counter', 'aria-live': 'polite' });
        host.appendChild(counterNode);
        const sync = () => {
            const length = String(control.value || '').length;
            counterNode.textContent = `${length}/${max}`;
            counterNode.dataset.over = length > max ? 'true' : 'false';
        };
        control.addEventListener('input', sync);
        sync();
    }

    function show(message) {
        if (!host) {
            return;
        }
        if (!message) {
            errorNode?.remove();
            errorNode = null;
            host.dataset.invalid = 'false';
            return;
        }
        if (!errorNode) {
            errorNode = el('p', { class: 'field-error', role: 'alert' });
            host.appendChild(errorNode);
        }
        errorNode.textContent = message;
        host.dataset.invalid = 'true';
    }

    function checkValue() {
        const message = check(control.value, { label, required, min, max, pattern, patternMessage, custom });
        show(message);
        return message;
    }

    function clear() {
        show('');
    }

    // 失焦时给出反馈，输入过程中自动清除已修复的错误。
    control.addEventListener('blur', () => checkValue());
    control.addEventListener('input', () => {
        if (host?.dataset.invalid === 'true') {
            checkValue();
        }
    });

    return {
        control,
        label,
        check: checkValue,
        clear,
        show,
        focus: () => control.focus?.(),
    };
}

/** 依次校验，返回第一条错误与对应控件。 */
export function validateAll(validators) {
    for (const validator of validators) {
        if (!validator) {
            continue;
        }
        const message = validator.check();
        if (message) {
            return { ok: false, message, validator };
        }
    }
    return { ok: true, message: '', validator: null };
}

// ── 常用组合规则 ──────────────────────────────────────────────────

export function usernameRule(label = t('s_u9jq8n')) {
    return {
        label,
        min: limit('usernameMin', 3),
        max: limit('usernameMax', 20),
        pattern: PATTERNS.username,
        patternMessage: t('s_2i4r18'),
    };
}

export function passwordRule() {
    return {
        label: t('s_1aph6eg'),
        min: limit('passwordMin', 6),
        max: limit('passwordMax', 32),
    };
}

/** 密码强度提示：长度达标后再看字符种类，仅作提示不做拦截。 */
export function passwordStrength(value) {
    const text = String(value || '');
    if (text.length === 0) {
        return { level: 0, label: t('s_15h5nhd') };
    }
    let score = text.length >= limit('passwordMin', 6) ? 1 : 0;
    if (/[A-Za-z]/.test(text) && /\d/.test(text)) {
        score += 1;
    }
    if (/[^A-Za-z0-9]/.test(text) || text.length >= 12) {
        score += 1;
    }
    return { level: score, label: [t('s_ei6h3w'), t('s_ei6h3w'), t('s_b7cu2g'), t('s_hk23ql')][score] };
}

/** 两个密码框一致性校验。 */
export function matchRule(control, otherControl, message = t('s_10ai5t2')) {
    return () => {
        const value = String(control?.value || '');
        const other = String(otherControl?.value || '');
        if (!value || !other) {
            return '';
        }
        return value === other ? '' : message;
    };
}
