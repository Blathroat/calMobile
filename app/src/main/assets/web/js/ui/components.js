import { t } from '../core/strings.js';
/**
 * 共享界面组件：图标、顶部栏、卡片、分段控件、反馈状态与弹层。
 * 组件结构对应 newUI 线框中的 .topbar / .card / .row-card / .seg / .success-state / .note。
 */

import { el, append, replace, qs } from '../core/dom.js';

// 状态文案与色调集中在 core/status.js；这里再导出一次，页面只需引一个模块。
export { statusTone } from '../core/status.js';

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
            'aria-label': t('s_omytgn'),
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

/**
 * 分段控件：选中态是一个会滑动的滑块，切换时平滑移动到目标按钮。
 *
 * 返回的节点额外暴露 `setValue`，页面可以只更新选中项而不重建 DOM，
 * 滑动动画因此不会因为重新渲染而中断（管理后台的 用户/展会/设置 就依赖这一点）。
 */
export function segmented({ items, value, onChange, label }) {
    const group = el('div', { class: 'seg', role: 'group', 'aria-label': label || t('s_1w7zwsp') });
    const indicator = el('span', { class: 'seg-indicator', 'aria-hidden': 'true' });
    append(group, indicator);

    const buttons = [];
    let current = String(value ?? '');
    let mounted = false;

    for (const item of items) {
        const button = el('button', {
            type: 'button',
            'aria-pressed': String(item.value) === current ? 'true' : 'false',
            onclick: () => {
                if (String(item.value) === current) {
                    return;
                }
                setValue(item.value, true);
                onChange?.(item.value);
            },
        }, [item.label]);
        button.dataset.value = String(item.value);
        buttons.push(button);
        append(group, button);
    }

    /** 滑块跟随选中按钮；首次定位不加过渡，避免从左侧滑过来。 */
    function position(animate) {
        const active = buttons.find((button) => button.dataset.value === current);
        if (!active || active.offsetWidth === 0) {
            indicator.dataset.hidden = 'true';
            return;
        }
        indicator.dataset.hidden = 'false';
        indicator.dataset.animate = animate && mounted ? 'true' : 'false';
        indicator.style.width = `${active.offsetWidth}px`;
        indicator.style.transform = `translate3d(${active.offsetLeft}px, 0, 0)`;
        mounted = true;
    }

    function setValue(next, animate = true) {
        current = String(next ?? '');
        for (const button of buttons) {
            button.setAttribute('aria-pressed', button.dataset.value === current ? 'true' : 'false');
        }
        position(animate);
    }

    // 挂载后才知道真实宽度，因此在下一帧再定位。
    const schedule = () => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => position(false));
        }
    };
    schedule();
    group.setValue = setValue;
    group.syncIndicator = () => position(false);
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

/**
 * 页面底部的固定操作区：与顶部栏一样是页面的固定行，样式只在 tokens.css 里声明。
 * 调用方只负责往里面放按钮或提示。
 */
export function pageFoot(children = []) {
    return el('div', { class: 'page-foot' }, children);
}

/**
 * 数据加载失败：原位给出说明与「重试」按钮，不使用全局错误页。
 * 页面只要把自己那块容器和一个重新加载的回调传进来即可。
 */
export function loadErrorBlock({ title = t('s_kvpltc'), description, onRetry } = {}) {
    return stateBlock({
        tone: 'error',
        title,
        description,
        action: onRetry ? { label: t('s_lswd2v'), onClick: onRetry } : null,
    });
}

/**
 * 找不到目标（展会已删除、报名已撤销这类）：说明原因并给出返回入口。
 * 与 {@link loadErrorBlock} 分开，是因为此时重试没有意义，只能离开。
 */
export function notFoundBlock({ iconName = 'info', title, description, backLabel, onBack } = {}) {
    return stateBlock({
        tone: 'error',
        iconName,
        title,
        description,
        action: onBack ? { label: backLabel || t('s_omytgn'), onClick: onBack } : null,
    });
}

/**
 * 卡片内的次级按钮：比 `.cta` 矮一档，用于「查看报名 / 编辑展会」这类并排小按钮。
 * `grow` 为真时等分父容器宽度（配合 `.grid-cols-2` 使用）。
 */
export function smallCta(label, onClick, { grow = true, danger = false, disabled = false } = {}) {
    return el('button', {
        class: `cta ${danger ? 'danger' : 'ghost'}`,
        type: 'button',
        dataset: { size: 'small' },
        style: grow ? { flex: '1 1 0' } : null,
        disabled: disabled ? true : null,
        onclick: onClick,
    }, [label]);
}

export function statusTag(text, tone = 'pending') {
    return el('span', { class: 'status-tag', dataset: { tone }, text: text || '' });
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

    let closing = false;

    /** 关闭时先播放退场动画，再移除节点，避免抽屉“瞬间消失”。 */
    function close() {
        if (closing) {
            return;
        }
        closing = true;
        document.removeEventListener('keydown', onKey);
        overlay.dataset.closing = 'true';
        const delay = prefersReducedMotion() ? 0 : 220;
        setTimeout(() => overlay.remove(), delay);
    }

    function onKey(event) {
        if (event.key === 'Escape') {
            close();
        }
    }

    document.addEventListener('keydown', onKey);
    const focusTarget = panel.querySelector('textarea, input, button');
    focusTarget?.focus();
    return { close, panel };
}

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 二次确认，用于删除与撤销等不可逆操作。 */
export function confirmSheet({ title, message, confirmLabel = t('s_kre8wf'), cancelLabel = t('s_1589w37'), tone = 'primary', onConfirm }) {
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
    // 退场动画结束后再移除，避免提示突然消失。
    setTimeout(() => {
        node.dataset.leaving = 'true';
        setTimeout(() => node.remove(), prefersReducedMotion() ? 0 : 200);
    }, 2400);
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

// ── 头像 ──────────────────────────────────────────────────────────

/** 圆形头像：有图时展示图片，没有头像时回落到昵称首字。 */
export function avatarNode({ src, name = '', className = 'avatar', label }) {
    const box = el('span', {
        class: `${className}${src ? ' has-image' : ''}`,
        'aria-label': label || `${name || t('s_1in002o')}的头像`,
    });
    if (src) {
        append(box, el('img', { src, alt: '' }));
    } else {
        append(box, el('span', { text: (name || t('s_cmla8n')).slice(0, 1), 'aria-hidden': 'true' }));
    }
    return box;
}

const CROP_OUTPUT_SIZE = 512;

/**
 * 圆形头像裁剪：单指拖动平移、双指捏合缩放，确认后导出方形画布。
 * 只依赖 canvas，不引入任何图像处理库；输出的 data URL 交给
 * `media.store` 落盘并换成短 URL。
 */
export function openAvatarCropper({ source, onDone, onError }) {
    const stageSize = 248;
    const state = { x: 0, y: 0, zoom: 1, base: 1, width: 0, height: 0, ready: false };

    const image = el('img', { class: 'crop-image', src: source, alt: '' });
    const stage = el('div', { class: 'crop-stage' }, [image]);
    stage.style.width = `${stageSize}px`;
    stage.style.height = `${stageSize}px`;

    const scaleLabel = el('span', { class: 'crop-scale', text: '1.0×' });
    const hint = el('p', {
        class: 'field-hint',
        text: t('s_1ty4r7s'),
    });

    function clamp() {
        const displayWidth = state.width * state.base * state.zoom;
        const displayHeight = state.height * state.base * state.zoom;
        const maxX = Math.max(0, (displayWidth - stageSize) / 2);
        const maxY = Math.max(0, (displayHeight - stageSize) / 2);
        state.x = Math.min(maxX, Math.max(-maxX, state.x));
        state.y = Math.min(maxY, Math.max(-maxY, state.y));
    }

    function paint() {
        if (!state.ready) {
            return;
        }
        clamp();
        const scale = state.base * state.zoom;
        image.style.width = `${state.width * scale}px`;
        image.style.height = `${state.height * scale}px`;
        image.style.transform = `translate(-50%, -50%) translate3d(${state.x}px, ${state.y}px, 0)`;
        scaleLabel.textContent = `${state.zoom.toFixed(1)}×`;
    }

    image.addEventListener('load', () => {
        state.width = image.naturalWidth || stageSize;
        state.height = image.naturalHeight || stageSize;
        state.base = Math.max(stageSize / state.width, stageSize / state.height);
        state.ready = true;
        paint();
    });
    image.addEventListener('error', () => {
        if (hint) {
            hint.textContent = t('s_gnybt');
            hint.dataset.tone = 'error';
        }
    });

    // ── 手势：单指拖动、双指捏合 ──────────────────────────────────
    // 用 Pointer Events 统一处理触摸与鼠标：按下时记录所有活动触点，
    // 两个触点同时按下时进入捏合模式，缩放比例取两指间距之比。

    const MIN_ZOOM = 1;
    const MAX_ZOOM = 4;
    const pointers = new Map();
    let pinchStartDistance = 0;
    // 捏合锚点：手势开始时两指中点（相对裁剪框中心）与当时的平移量。
    let pinchFocal = { x: 0, y: 0 };
    let pinchStartX = 0;
    let pinchStartY = 0;
    let pinchStartZoom = 1;
    let dragStartX = 0;
    let dragStartY = 0;
    let originX = 0;
    let originY = 0;

    function distance() {
        const [a, b] = [...pointers.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    /** 两指中点在元素坐标系里的位置，用于把缩放锚在手指下方。 */
    function focalPoint() {
        const rect = stage.getBoundingClientRect();
        const [a, b] = [...pointers.values()];
        return {
            x: ((a.x + b.x) / 2) - rect.left - (rect.width / 2),
            y: ((a.y + b.y) / 2) - rect.top - (rect.height / 2),
        };
    }

    function beginDrag(event) {
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        originX = state.x;
        originY = state.y;
        stage.dataset.dragging = 'true';
    }

    stage.addEventListener('pointerdown', (event) => {
        if (!state.ready) {
            return;
        }
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        stage.setPointerCapture?.(event.pointerId);
        if (pointers.size === 1) {
            beginDrag(event);
        } else if (pointers.size === 2) {
            // 第二根手指落下时切换到捏合：记录基准间距、锚点与当时的缩放。
            pinchStartDistance = distance();
            pinchStartZoom = state.zoom;
            pinchStartX = state.x;
            pinchStartY = state.y;
            pinchFocal = focalPoint();
            stage.dataset.pinching = 'true';
        }
    });

    stage.addEventListener('pointermove', (event) => {
        if (!pointers.has(event.pointerId)) {
            return;
        }
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size >= 2) {
            if (pinchStartDistance <= 0) {
                pinchStartDistance = distance();
                pinchStartZoom = state.zoom;
                pinchStartX = state.x;
                pinchStartY = state.y;
                pinchFocal = focalPoint();
                return;
            }
            const ratio = distance() / pinchStartDistance;
            const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * ratio));
            // 手指下的那一点保持不动：按缩放比把锚点相对平移量一起放大。
            const grow = next / pinchStartZoom;
            state.zoom = next;
            state.x = pinchFocal.x - ((pinchFocal.x - pinchStartX) * grow);
            state.y = pinchFocal.y - ((pinchFocal.y - pinchStartY) * grow);
            paint();
            return;
        }
        if (pointers.size === 1) {
            state.x = originX + (event.clientX - dragStartX);
            state.y = originY + (event.clientY - dragStartY);
            paint();
        }
    });

    const endPointer = (event) => {
        if (!pointers.has(event.pointerId)) {
            return;
        }
        pointers.delete(event.pointerId);
        if (pointers.size >= 2) {
            return;
        }
        stage.dataset.pinching = 'false';
        pinchStartDistance = 0;
        if (pointers.size === 1) {
            // 松开一根手指后，剩下那根继续接管拖动，避免画面“粘住”。
            beginDrag(event);
            return;
        }
        stage.dataset.dragging = 'false';
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);

    // 桌面或鼠标环境没有第二根手指，用滚轮作为捏合的等价操作。
    stage.addEventListener('wheel', (event) => {
        if (!state.ready) {
            return;
        }
        event.preventDefault();
        const step = event.deltaY < 0 ? 0.12 : -0.12;
        state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom + step));
        paint();
    }, { passive: false });

    return openSheet({
        title: t('s_1dbfyef'),
        content: [
            el('div', { class: 'crop-wrap' }, [stage]),
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'field-hint', text: t('s_vk66u0') }),
                scaleLabel,
            ]),
            hint,
        ],
        actions: [
            { label: t('s_1589w37'), onClick: (close) => close() },
            {
                label: t('s_1bykzhf'),
                variant: 'primary',
                onClick: async (close) => {
                    if (!state.ready) {
                        toast(t('s_94aane'), 'error');
                        return;
                    }
                    try {
                        const dataUrl = renderCrop();
                        close();
                        await onDone?.(dataUrl);
                    } catch (error) {
                        onError?.(error);
                    }
                },
            },
        ],
    });

    function renderCrop() {
        const scale = state.base * state.zoom;
        const sourceSize = stageSize / scale;
        const left = (stageSize / 2 + state.x) - (state.width * scale) / 2;
        const top = (stageSize / 2 + state.y) - (state.height * scale) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = CROP_OUTPUT_SIZE;
        canvas.height = CROP_OUTPUT_SIZE;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
        context.drawImage(image, -left / scale, -top / scale, sourceSize, sourceSize,
            0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
        return canvas.toDataURL('image/jpeg', 0.9);
    }
}
