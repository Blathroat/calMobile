/** Markdown 渲染入口，所有富文本先经过清洗再交给页面展示。 */
const URL_PATTERN = /^(https?:|mailto:)/i;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

export function sanitizeUrl(value: string): string {
  const url = String(value || '').trim();
  return URL_PATTERN.test(url) ? url : '#';
}

export function markdownToHtml(source: string): string {
  const lines = String(source || '').split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    const text = line.trim();
    if (!text) { if (inList) { html.push('</ul>'); inList = false; } continue; }
    const list = /^[-*]\s+(.+)$/.exec(text);
    if (list) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inline(list[1] || '')}</li>`);
      continue;
    }
    if (inList) { html.push('</ul>'); inList = false; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(text);
    if (heading) { const level = heading[1]?.length || 1; html.push(`<h${level}>${inline(heading[2] || '')}</h${level}>`); continue; }
    html.push(`<p>${inline(text)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('');
}

function inline(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => `<img src="${escapeHtml(sanitizeUrl(url))}" alt="${escapeHtml(alt)}">`);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => `<a href="${escapeHtml(sanitizeUrl(url))}" rel="noopener noreferrer">${label}</a>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return text;
}

// ── HTML 清洗 ─────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'video', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan']);

/**
 * `<video>` 的专用属性白名单。
 *
 * 简介里的视频由展商编辑器插入，只放播放所需的这几个：`autoplay` 会在详情页突然出声、
 * `on*` 是脚本入口、`style` 能盖住整页，因此一律不放。其余标签仍走 {@link ALLOWED_ATTRS}。
 */
const VIDEO_ATTRS = new Set(['src', 'controls', 'poster', 'preload', 'class']);

const SAFE_URL = /^(https?:|data:image\/|content:|file:)/i;

/** 清洗 HTML：展商编辑器产出的简介在渲染前统一过滤脚本、事件属性与危险协议。 */
export function sanitizeHtml(html: unknown): string {
  const source = String(html ?? '').trim();
  if (!source || typeof document === 'undefined') return '';
  const template = document.createElement('template');
  template.innerHTML = source;
  clean(template.content);
  return template.innerHTML;
}

function clean(root: ParentNode): void {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      continue;
    }
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // 保留文本内容，丢弃标签本身（script / style 的内容也会被清掉）
      element.replaceWith(document.createTextNode(element.textContent ?? ''));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const allowed = tag === 'video' ? VIDEO_ATTRS : ALLOWED_ATTRS;
      if (!allowed.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && !SAFE_URL.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name);
      }
    }
    if (tag === 'a') {
      element.setAttribute('rel', 'noopener noreferrer');
      element.setAttribute('target', '_blank');
    }
    clean(element);
  }
}

/** 简介文本摘要：去掉标签后截断，用于列表与卡片。 */
export function plainText(html: unknown, max = 120): string {
  if (typeof document === 'undefined') return '';
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  const text = (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
