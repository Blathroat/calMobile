/**
 * HTML 清洗与富文本处理。
 * 展会简介来自展商编辑器，前端渲染前统一过滤脚本、事件属性与危险协议。
 */

const ALLOWED_TAGS = new Set([
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'a', 'img', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan']);

const SAFE_URL = /^(https?:|data:image\/|content:|file:)/i;

/** 清洗 HTML，仅保留富文本需要的标签与属性。 */
export function sanitizeHtml(html) {
    const source = String(html || '').trim();
    if (!source) {
        return '';
    }
    const template = document.createElement('template');
    template.innerHTML = source;
    clean(template.content);
    return template.innerHTML;
}

function clean(root) {
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType === Node.COMMENT_NODE) {
            node.remove();
            continue;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            continue;
        }
        const tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
            // 保留文本内容，丢弃标签本身（例如 script/style 之外的未知标签）
            const text = document.createTextNode(node.textContent || '');
            node.replaceWith(text);
            continue;
        }
        for (const attribute of Array.from(node.attributes)) {
            const name = attribute.name.toLowerCase();
            if (!ALLOWED_ATTRS.has(name)) {
                node.removeAttribute(attribute.name);
                continue;
            }
            if ((name === 'href' || name === 'src') && !SAFE_URL.test(attribute.value.trim())) {
                node.removeAttribute(attribute.name);
            }
        }
        if (tag === 'a') {
            node.setAttribute('rel', 'noopener noreferrer');
            node.setAttribute('target', '_blank');
        }
        clean(node);
    }
}

/** 简介文本摘要：去掉标签后截断，用于列表与卡片。 */
export function plainText(html, max = 120) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const text = (template.content.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
