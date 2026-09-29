import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown';

describe('markdownToHtml', () => {
  it('escapes HTML and rejects unsafe links', () => {
    const html = markdownToHtml('# 标题\n<script>alert(1)</script>\n[危险](javascript:alert(1))');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="#"');
  });
});
