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
