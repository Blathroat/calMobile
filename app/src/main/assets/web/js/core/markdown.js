/**
 * Markdown 处理。
 *
 * 渲染与解析都交给内置的 marked（随 EasyMDE 一同打包），本模块只负责：
 * 1. 从全局取出 marked 实例（EasyMDE 会把 marked 挂到 window.marked）；
 * 2. 渲染后仍然走 sanitizeHtml 白名单，避免 Markdown 中夹带 HTML；
 * 3. 为旧数据提供 HTML → Markdown 的转换，保证历史简介仍可编辑。
 */

import { sanitizeHtml } from './sanitize.js';

function resolveMarked() {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.marked || null;
}

/** Markdown → 清洗后的 HTML。 */
export function markdownToHtml(markdown) {
    const source = String(markdown || '');
    if (source.trim() === '') {
        return '';
    }
    const marked = resolveMarked();
    if (!marked) {
        return '';
    }
    const html = typeof marked.parse === 'function' ? marked.parse(source) : marked(source);
    return sanitizeHtml(html);
}

/** 判断文本是否包含 Markdown 结构，用于旧数据的格式推断。 */
export function looksLikeMarkdown(text) {
    return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|)/.test(String(text || ''))
        || /(\*\*|__|\[[^\]]+\]\([^)]+\))/.test(String(text || ''));
}

const VOID_TAGS = new Set(['br', 'hr', 'img']);
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table']);

/**
 * HTML → Markdown。
 * 只覆盖旧富文本编辑器可能产生的标签，输出结果与 EasyMDE 的语法兼容。
 */
export function htmlToMarkdown(html) {
    const source = String(html || '').trim();
    if (source === '') {
        return '';
    }
    if (!/<[a-z][\s\S]*>/i.test(source)) {
        // 已经是纯文本或 Markdown，直接返回
        return source;
    }

    const template = document.createElement('template');
    template.innerHTML = source;
    const output = convertChildren(template.content);
    return output
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
}

function convertChildren(node) {
    let result = '';
    for (const child of Array.from(node.childNodes)) {
        result += convertNode(child);
    }
    return result;
}

function convertNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
    }
    const tag = node.tagName.toLowerCase();
    const inner = convertChildren(node);
    switch (tag) {
        case 'br':
            return '\n';
        case 'hr':
            return '\n\n---\n\n';
        case 'strong':
        case 'b':
            return inner.trim() === '' ? '' : `**${inner.trim()}**`;
        case 'em':
        case 'i':
            return inner.trim() === '' ? '' : `*${inner.trim()}*`;
        case 'u':
            return inner.trim() === '' ? '' : `<u>${inner.trim()}</u>`;
        case 's':
        case 'del':
            return inner.trim() === '' ? '' : `~~${inner.trim()}~~`;
        case 'code':
            return `\`${inner}\``;
        case 'a': {
            const href = node.getAttribute('href') || '';
            return href ? `[${inner.trim() || href}](${href})` : inner;
        }
        case 'img': {
            const src = node.getAttribute('src') || '';
            if (!src) {
                return '';
            }
            const alt = node.getAttribute('alt') || '图片';
            return `\n\n![${alt}](${src})\n\n`;
        }
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
            const level = Number(tag.slice(1));
            return `\n\n${'#'.repeat(Math.min(level + 1, 6))} ${inner.trim()}\n\n`;
        }
        case 'blockquote':
            return `\n\n${inner.trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
        case 'ul':
            return `\n${listItems(node, '- ')}\n`;
        case 'ol':
            return `\n${listItems(node, null)}\n`;
        case 'li':
            return inner;
        case 'pre':
            return `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
        case 'table':
            return `\n\n${convertTable(node)}\n\n`;
        case 'p':
        case 'div':
        case 'section':
        case 'article':
            return `\n\n${inner.trim()}\n\n`;
        default:
            return VOID_TAGS.has(tag) ? '' : (BLOCK_TAGS.has(tag) ? `\n\n${inner}\n\n` : inner);
    }
}

function listItems(list, bullet) {
    const lines = [];
    let index = 1;
    for (const item of Array.from(list.children)) {
        if (item.tagName.toLowerCase() !== 'li') {
            continue;
        }
        const text = convertChildren(item).trim().replace(/\n+/g, ' ');
        lines.push(`${bullet || `${index}. `}${text}`);
        index += 1;
    }
    return lines.join('\n');
}

function convertTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) {
        return '';
    }
    const cells = (row) => Array.from(row.children).map((cell) => convertChildren(cell).trim().replace(/\n+/g, ' '));
    const header = cells(rows[0]);
    const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
    for (const row of rows.slice(1)) {
        lines.push(`| ${cells(row).join(' | ')} |`);
    }
    return lines.join('\n');
}

/** 纯文本摘要，用于卡片预览。 */
export function markdownSummary(markdown, max = 70) {
    const text = String(markdown || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
