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

// ── 基础判断 ──────────────────────────────────────────────────────

/** 逐条执行规则，返回第一条错误；通过时返回空串。 */
export function check(value, options = {}) {
    const {
        label = '该字段',
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

export function usernameRule(label = '用户名') {
    return {
        label,
        min: limit('usernameMin', 3),
        max: limit('usernameMax', 20),
        pattern: PATTERNS.username,
        patternMessage: '只能使用中英文、数字与下划线',
    };
}

export function passwordRule() {
    return {
        label: '密码',
        min: limit('passwordMin', 6),
        max: limit('passwordMax', 32),
    };
}

/** 密码强度提示：长度达标后再看字符种类，仅作提示不做拦截。 */
export function passwordStrength(value) {
    const text = String(value || '');
    if (text.length === 0) {
        return { level: 0, label: '未填写' };
    }
    let score = text.length >= limit('passwordMin', 6) ? 1 : 0;
    if (/[A-Za-z]/.test(text) && /\d/.test(text)) {
        score += 1;
    }
    if (/[^A-Za-z0-9]/.test(text) || text.length >= 12) {
        score += 1;
    }
    return { level: score, label: ['弱', '弱', '中', '强'][score] };
}

/** 两个密码框一致性校验。 */
export function matchRule(control, otherControl, message = '两次输入的密码不一致') {
    return () => {
        const value = String(control?.value || '');
        const other = String(otherControl?.value || '');
        if (!value || !other) {
            return '';
        }
        return value === other ? '' : message;
    };
}
