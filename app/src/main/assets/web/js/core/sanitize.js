/**
 * HTML 清洗与富文本处理。
 * 展会简介来自展商编辑器，前端渲染前统一过滤脚本、事件属性与危险协议。
 */

const ALLOWED_TAGS = new Set([
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'a', 'img', 'video', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan']);

/**
 * `<video>` 的专用属性白名单。
 * <p>
 * 简介里的视频由展商编辑器插入（`<video controls src="短 URL"></video>`），
 * 只放播放所需的这几个：`autoplay` 会在详情页突然出声、`on*` 是脚本入口、
 * `style` 能盖住整页，因此一律不放。其余标签的属性仍走 {@link ALLOWED_ATTRS}，
 * 不因为放开视频而放宽别的标签。
 */
const VIDEO_ATTRS = new Set(['src', 'controls', 'poster', 'preload', 'class']);

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
            const allowed = tag === 'video' ? VIDEO_ATTRS : ALLOWED_ATTRS;
            if (!allowed.has(name)) {
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
