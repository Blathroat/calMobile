/** Markdown 渲染入口，所有富文本先经过清洗再交给页面展示。 */
import type TurndownService from 'turndown';

const URL_PATTERN = /^(https?:|mailto:)/i;
let parser: typeof import('marked').marked | undefined;
let purifier: ReturnType<typeof import('dompurify').default> | undefined;
let converter: TurndownService | undefined;

/** 页面在加载简介时准备解析器和清洗器，Vite 将依赖打成 APK 内的按需资源。 */
export async function loadMarkdownParser(): Promise<void> {
  if (parser && purifier) return;
  const [marked, dompurify] = await Promise.all([import('marked'), import('dompurify')]);
  parser = marked.marked;
  if (purifier) return;
  purifier = dompurify.default(window);
  purifier.addHook('uponSanitizeAttribute', (node, attribute) => {
    const name = attribute.attrName;
    const allowed = node.nodeName === 'VIDEO' ? VIDEO_ATTRS : ALLOWED_ATTRS;
    if (!allowed.has(name)) attribute.keepAttr = false;
    if (name === 'href' && !/^(https?:|mailto:|#)/i.test(attribute.attrValue.trim())) attribute.keepAttr = false;
    if ((name === 'src' || name === 'poster') && !SAFE_URL.test(attribute.attrValue.trim())) attribute.keepAttr = false;
  });
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return;
    node.setAttribute('rel', 'noopener noreferrer');
    node.setAttribute('target', '_blank');
  });
}

/** 仅历史 HTML 简介进入编辑页时加载转换器。 */
export async function loadHtmlConverter(): Promise<void> {
  if (converter) return;
  const { default: Turndown } = await import('turndown');
  converter = new Turndown({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    // Turndown 的空白规则优先于 keep；没有字幕的视频也必须保留。
    blankReplacement: (_content, node) => node.nodeName === 'VIDEO'
      ? `\n\n${node.outerHTML}\n\n` : ((node as HTMLElement & { isBlock: boolean }).isBlock ? '\n\n' : ''),
  });
  converter.keep(['video', 'table', 'u', 's', 'del', 'sub', 'sup']);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

export function sanitizeUrl(value: string): string {
  const url = String(value || '').trim();
  return URL_PATTERN.test(url) ? url : '#';
}

export function markdownToHtml(source: string): string {
  if (!source) return '';
  return sanitizeHtml(parser!.parse(source, { async: false, gfm: true, breaks: true }));
}

// ── HTML 清洗 ─────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'video', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'start']);

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
  return purifier!.sanitize(source, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRS, ...VIDEO_ATTRS],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(https?:|mailto:|data:image\/|content:|file:|#)/i,
  });
}

/** 编辑历史 HTML 时保留格式、链接和媒体，先清洗再转换，避免另存时丢失正文。 */
export function htmlToMarkdown(html: unknown): string {
  const source = sanitizeHtml(html);
  if (!source) return '';
  return converter!.turndown(source);
}

/** 简介文本摘要：去掉标签后截断，用于列表与卡片。 */
export function plainText(html: unknown, max = 120): string {
  if (typeof document === 'undefined') return '';
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  const text = (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
