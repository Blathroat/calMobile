/**
 * DOM 与格式化工具。
 * 页面只使用原生 DOM API，保持与 WebView 的零依赖运行方式。
 */

/** 创建元素：el('div', { class: 'card' }, [child]) */
export function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value === null || value === undefined || value === false) {
            continue;
        }
        if (key === 'class') {
            node.className = value;
        } else if (key === 'dataset') {
            Object.assign(node.dataset, value);
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(node.style, value);
        } else if (key === 'html') {
            node.innerHTML = value;
        } else if (key === 'text') {
            node.textContent = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'value') {
            node.value = value;
        } else if (value === true) {
            node.setAttribute(key, '');
        } else {
            node.setAttribute(key, String(value));
        }
    }
    append(node, children);
    return node;
}

/** 追加子节点，自动跳过空值并把数组拍平。 */
export function append(parent, children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
        if (child === null || child === undefined || child === false || child === '') {
            continue;
        }
        if (Array.isArray(child)) {
            append(parent, child);
        } else if (child instanceof Node) {
            parent.appendChild(child);
        } else {
            parent.appendChild(document.createTextNode(String(child)));
        }
    }
    return parent;
}

/** 清空并替换子节点。 */
export function replace(parent, children) {
    parent.replaceChildren();
    append(parent, children);
    return parent;
}

export function qs(selector, root = document) {
    return root.querySelector(selector);
}

// ── 格式化 ────────────────────────────────────────────────────────

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** ISO 日期（2026-06-12）→ { year, month, day } */
export function parseDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) {
        return null;
    }
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDateWithWeekday(iso) {
    const date = parseDate(iso);
    if (!date) {
        return '';
    }
    const weekday = WEEKDAYS[new Date(date.year, date.month - 1, date.day).getDay()];
    return `${date.month}月${date.day}日（${weekday}）`;
}

/** 把答案文本按行渲染为键值对，找不到分隔符时返回原文。 */
export function answerLines(answers) {
    const text = String(answers || '').trim();
    if (text === '') {
        return [];
    }
    return text.split('\n').map((line) => {
        const index = line.indexOf('：') >= 0 ? line.indexOf('：') : line.indexOf(':');
        if (index <= 0) {
            return { label: '', value: line.trim() };
        }
        return { label: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
    });
}

/** 裁剪文本，用于列表摘要。 */
export function truncate(value, max = 42) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function monthLabel(year, month) {
    return `${year} 年 ${month} 月`;
}

export function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

/** 返回该月第一天的星期偏移，周一为一周起点。 */
export function firstWeekdayOffset(year, month) {
    const weekday = new Date(year, month - 1, 1).getDay();
    return (weekday + 6) % 7;
}

export function addMonths(year, month, delta) {
    const total = (year * 12) + (month - 1) + delta;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
