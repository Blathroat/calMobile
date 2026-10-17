import { beforeAll, describe, expect, it } from 'vitest';
import { htmlToMarkdown, loadHtmlConverter, loadMarkdownParser, markdownToHtml } from './markdown';

beforeAll(async () => {
  await loadMarkdownParser();
  await loadHtmlConverter();
});

describe('markdownToHtml', () => {
  it('渲染编辑器工具条生成的格式与本机媒体', () => {
    const root = document.createElement('div');
    root.innerHTML = markdownToHtml(
      [
        '## 展会亮点',
        '**加粗**和*斜体*',
        '',
        '> 引用',
        '',
        '1. 第一项',
        '2. 第二项',
        '',
        '- 无序项',
        '',
        '![封面](https://appassets.androidplatform.net/media/cover.jpg)',
        '',
        '<video controls src="https://appassets.androidplatform.net/media/demo.mp4"></video>',
      ].join('\n'),
    );
    expect(root.querySelector('em')?.textContent).toBe('斜体');
    expect(root.querySelector('blockquote')?.textContent?.trim()).toBe('引用');
    expect([...root.querySelectorAll('ol li')].map((item) => item.textContent)).toEqual(['第一项', '第二项']);
    expect(root.querySelector('video')?.getAttribute('src')).toBe(
      'https://appassets.androidplatform.net/media/demo.mp4',
    );
    expect(root.querySelector('video')?.hasAttribute('controls')).toBe(true);
  });

  it('清洗解析后的脚本、事件属性和危险链接', () => {
    const root = document.createElement('div');
    root.innerHTML = markdownToHtml(
      '# 标题\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n<img src="https://example.com/p.jpg" onerror="alert(1)">',
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(root.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(root.textContent).not.toContain('alert(1)');
  });

  it('保留代码、表格和含括号与实体的链接', () => {
    const root = document.createElement('div');
    root.innerHTML = markdownToHtml(
      '```html\n<script>示例代码</script>\n```\n\n' +
        '| 名称 | 地点 |\n| --- | --- |\n| 秋展 | 上海 |\n\n' +
        '[展会](https://example.com/展会(秋)?a=1&b=2)\n\n[邮箱](mailto:info@example.com)',
    );
    expect(root.querySelector('pre code')?.textContent).toBe('<script>示例代码</script>\n');
    // 表格标签整体留在清洗白名单里，详情页才能用 .rich-content 的表格样式展示。
    expect(root.querySelector('table')).not.toBeNull();
    expect([...root.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['名称', '地点']);
    expect(root.querySelector('tbody td')?.textContent).toBe('秋展');
    expect(decodeURI(root.querySelector('a')?.getAttribute('href') ?? '')).toBe('https://example.com/展会(秋)?a=1&b=2');
    expect(root.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toBe('mailto:info@example.com');
  });
});

describe('历史 HTML 简介迁移', () => {
  it('先清洗再转换，保留无文字容器中的视频', () => {
    const markdown = htmlToMarkdown(
      '<p><video controls src="https://example.com/demo.mp4"' +
        ' poster="javascript:alert(1)" autoplay onerror="alert(1)"></video></p><script>alert(1)</script>',
    );
    const root = document.createElement('div');
    root.innerHTML = markdownToHtml(markdown);
    expect(root.querySelector('video')?.getAttribute('src')).toBe('https://example.com/demo.mp4');
    expect(root.querySelector('video')?.hasAttribute('controls')).toBe(true);
    expect(markdown).not.toMatch(/javascript:|onerror|autoplay|<script>/);
  });
});
