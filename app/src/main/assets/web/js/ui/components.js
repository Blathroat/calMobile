/**
 * 共享界面组件：图标、顶部栏、卡片、分段控件、反馈状态与弹层。
 * 组件结构对应 newUI 线框中的 .topbar / .card / .row-card / .seg / .success-state / .note。
 */

import { el, append, replace, qs } from '../core/dom.js';

// ── 图标（统一细线 SVG，对应 newUI 的 .icon 规格） ────────────────

const PATHS = {
    back: '<path d="m14 5-7 7 7 7"/>',
    chevronLeft: '<path d="m14 5-7 7 7 7"/>',
    chevronRight: '<path d="m10 5 7 7-7 7"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3.5v3M16 3.5v3M3.5 10h17"/>',
    check: '<path d="m5 12.5 4.5 4.5 9-10"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M7 7l1 12.2h8L17 7"/>',
    edit: '<path d="M4.5 19.5h4l11-11-4-4-11 11v4Z"/><path d="m14.5 6.5 4 4"/>',
    home: '<path d="m4 11 8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1Z"/>',
    ticket: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 3.9v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-3.9Z"/><path d="M12 8v8"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4S17.8 16.4 19 20"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.9M3.5 12.5h17"/>',
    shield: '<path d="M12 3.5 19 6v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6Z"/><path d="m9 12 2 2 4-4.5"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
    video: '<rect x="3.5" y="6" width="12" height="12" rx="2"/><path d="m15.5 12 5-3v6Z"/>',
    save: '<path d="M6 4.5h9.5L20 9v10.5H6z"/><path d="M9 4.5v5h6v-5M9 19.5v-5h6v5"/>',
    download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19.5h14"/>',
    bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5 1.5 5H5s1.5-1 1.5-5Z"/><path d="M10.5 18.5a1.8 1.8 0 0 0 3 0"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8.2v.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5.5V11h-5.5"/>',
};

export function icon(name, extraClass = 'icon') {
    const path = PATHS[name] || PATHS.info;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', extraClass);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = path;
    return svg;
}

/** 页面外壳：顶部栏 + 内容区（+ 可选底部导航）。由 router 挂载。 */
export function renderShell(shell, { topbar, body, tabbar, nav }) {
    const app = qs('#app');
    app.dataset.nav = tabbar ? 'bottom' : 'none';
    replace(app, [
        topbar || el('div', { class: 'topbar', hidden: true }),
        el('main', { class: 'app-body route-enter', id: 'page-body' }, body || []),
        tabbar || null,
    ]);
    return app;
}

/** 顶部栏：返回按钮、标题与右侧操作。 */
export function topbar({ title, onBack, actions = [], showBack = true }) {
    const bar = el('header', { class: 'topbar' });
    if (showBack) {
        append(bar, el('button', {
            class: 'icon-button',
            type: 'button',
            'aria-label': '返回',
            onclick: onBack,
        }, [icon('back')]));
    } else {
        append(bar, el('span', { class: 'topbar-side', 'aria-hidden': 'true' }));
    }
    append(bar, el('h1', { class: 'topbar-title', text: title || '' }));
    const side = el('div', { class: 'topbar-side' });
    append(side, actions);
    append(bar, side);
    return bar;
}

/** 分段控件：保持 newUI 的选中态与悬浮语义。 */
export function segmented({ items, value, onChange, label }) {
    const group = el('div', { class: 'seg', role: 'group', 'aria-label': label || '筛选' });
    for (const item of items) {
        const active = String(item.value) === String(value);
        append(group, el('button', {
            type: 'button',
            'aria-pressed': active ? 'true' : 'false',
            onclick: () => onChange?.(item.value),
        }, [item.label]));
    }
    return group;
}

/** 空 / 加载 / 错误 / 成功状态，均给出下一步说明。 */
export function stateBlock({ tone = 'neutral', title, description, action, iconName }) {
    const block = el('div', { class: 'state', dataset: { tone } });
    append(block, el('span', { class: 'state-icon' }, [icon(iconName || (tone === 'error' ? 'info' : 'list'), 'icon icon-sm')]));
    if (title) {
        append(block, el('strong', { text: title }));
    }
    if (description) {
        append(block, el('p', { class: 'muted', text: description }));
    }
    if (action) {
        append(block, el('button', {
            class: 'cta ghost',
            type: 'button',
            onclick: action.onClick,
        }, [action.label]));
    }
    return block;
}

export function loadingBlock(rows = 3) {
    const box = el('div', { class: 'skeleton' });
    for (let index = 0; index < rows; index += 1) {
        append(box, el('div', { class: 'skeleton-row' }));
    }
    return box;
}

/** 通用卡片。 */
export function card(children, props = {}) {
    return el('div', { class: 'card', ...props }, children);
}

/** 行卡片：缩略图 + 文案 + 右侧标签。 */
export function rowCard({ leading, title, meta = [], trailing, onClick, pressable = true, ariaLabel }) {
    const copy = el('span', { class: 'row-copy' });
    if (title) {
        append(copy, el('strong', { class: 'row-title truncate', text: title }));
    }
    for (const line of meta) {
        if (line) {
            append(copy, el('span', { class: 'row-meta', text: line }));
        }
    }
    const node = el(onClick ? 'button' : 'div', {
        class: 'row-card',
        type: onClick ? 'button' : null,
        dataset: { pressable: pressable && onClick ? 'true' : 'false' },
        'aria-label': ariaLabel || null,
        onclick: onClick,
    }, [leading || null, copy, trailing || null]);
    return node;
}

export function statusTag(text, tone = 'pending') {
    return el('span', { class: 'status-tag', dataset: { tone }, text: text || '' });
}

/** 状态 → 标签色，颜色不作为唯一线索，始终带文字。 */
export function statusTone(status) {
    switch (status) {
        case '已通过':
        case '报名中':
        case '无需审核':
            return 'ok';
        case '待审核':
        case '需审核':
            return 'pending';
        case '已拒绝':
        case '已撤销':
            return 'danger';
        case '截止报名':
            return 'warn';
        case '仅展示':
            return 'info';
        default:
            return 'muted';
    }
}

export function fieldShell({ label, control, hint, error, required }) {
    const wrapper = el('div', { class: 'field' });
    if (label) {
        const id = control?.id;
        append(wrapper, el('label', { for: id || null }, [
            label,
            required ? el('span', { class: 'required', 'aria-hidden': 'true', text: ' *' }) : null,
        ]));
    }
    append(wrapper, control);
    if (hint) {
        append(wrapper, el('p', { class: 'field-hint', text: hint }));
    }
    if (error) {
        wrapper.dataset.invalid = 'true';
        append(wrapper, el('p', { class: 'field-error', role: 'alert', text: error }));
    }
    return wrapper;
}

export function textField({ id, label, value = '', placeholder = '', type = 'text', required = false, hint, autocomplete, min, inputmode }) {
    const input = el('input', {
        class: 'input',
        id,
        type,
        value,
        placeholder,
        autocomplete,
        min,
        inputmode,
        required: required ? true : null,
    });
    return { wrapper: fieldShell({ label, control: input, hint, required }), input };
}

export function textAreaField({ id, label, value = '', placeholder = '', required = false, hint, rows = 4 }) {
    const area = el('textarea', { class: 'textarea', id, placeholder, rows, required: required ? true : null });
    area.value = value;
    return { wrapper: fieldShell({ label, control: area, hint, required }), input: area };
}

export function selectField({ id, label, value, options, hint }) {
    const select = el('select', { class: 'select', id });
    for (const option of options) {
        const node = el('option', { value: option.value, text: option.label });
        if (String(option.value) === String(value)) {
            node.selected = true;
        }
        append(select, node);
    }
    return { wrapper: fieldShell({ label, control: select, hint }), input: select };
}

export function switchRow({ id, label, description, checked, onChange }) {
    const input = el('input', { type: 'checkbox', id, onchange: (event) => onChange?.(event.target.checked) });
    input.checked = Boolean(checked);
    return el('div', { class: 'switch-row' }, [
        el('span', { class: 'switch-copy' }, [
            el('strong', { text: label }),
            description ? el('span', { class: 'row-meta', text: description }) : null,
        ]),
        el('label', { class: 'switch', for: id }, [input, el('span')]),
    ]);
}

export function notice(text, tone = 'neutral', iconName = 'info') {
    return el('div', { class: 'notice', dataset: { tone } }, [
        icon(iconName, 'icon icon-sm'),
        el('span', { text }),
    ]);
}

/** 底部面板：用于选择、确认和表单补充。 */
export function openSheet({ title, content, actions = [], size }) {
    const host = qs('#overlay-host');
    const panel = el('div', { class: 'sheet-panel', dataset: { size: size || 'auto' } });
    if (title) {
        append(panel, el('h2', { class: 'sheet-title', text: title }));
    }
    append(panel, content);
    if (actions.length > 0) {
        const row = el('div', { class: 'sheet-actions' });
        for (const action of actions) {
            append(row, el('button', {
                class: action.variant === 'primary' ? 'cta' : 'cta ghost',
                type: 'button',
                style: { width: 'auto', minWidth: '112px' },
                onclick: () => action.onClick?.(close),
            }, [action.label]));
        }
        append(panel, row);
    }

    const overlay = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [panel]);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            close();
        }
    });
    append(host, overlay);

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    function onKey(event) {
        if (event.key === 'Escape') {
            close();
        }
    }

    document.addEventListener('keydown', onKey);
    const focusTarget = panel.querySelector('input, textarea, button');
    focusTarget?.focus();
    return { close, panel };
}

/** 二次确认，用于删除与撤销等不可逆操作。 */
export function confirmSheet({ title, message, confirmLabel = '确认', cancelLabel = '取消', tone = 'primary', onConfirm }) {
    const sheet = openSheet({
        title,
        content: [el('p', { class: 'muted', text: message })],
        actions: [
            { label: cancelLabel, onClick: (close) => close() },
            {
                label: confirmLabel,
                variant: tone === 'danger' ? 'ghost' : 'primary',
                onClick: (close) => {
                    close();
                    onConfirm?.();
                },
            },
        ],
    });
    if (tone === 'danger') {
        const buttons = sheet.panel.querySelectorAll('.sheet-actions .cta');
        buttons[buttons.length - 1]?.classList.add('danger');
    }
    return sheet;
}

let toastSequence = 0;

/** 轻提示：仅作为附加反馈，页面内同时保留原位状态说明。 */
export function toast(message, tone = 'neutral') {
    if (!message) {
        return;
    }
    const host = qs('#toast-host');
    if (!host) {
        return;
    }
    const id = `toast-${toastSequence++}`;
    const node = el('div', { class: 'toast', id, dataset: { tone }, role: 'status', text: message });
    append(host, node);
    setTimeout(() => node.remove(), 2600);
}

/** 图片或占位：src 为空时保持线框的斜线占位。 */
export function mediaBox({ src, className = 'thumb', alt = '', fallbackText = '' }) {
    const box = el('span', { class: `ph-img ${className}` });
    if (src) {
        append(box, el('img', { src, alt }));
    } else if (fallbackText) {
        box.classList.add('avatar');
        append(box, el('span', { text: fallbackText, 'aria-hidden': 'true' }));
    } else {
        box.setAttribute('aria-hidden', 'true');
    }
    return box;
}
