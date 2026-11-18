import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildManifest,
  pwaAssetsPlugin,
  pwaHtmlCopyPlugin,
  readCopy,
  renderHtml,
  resolvePwaMeta,
  serviceWorkerSource,
} from './pwa-build.mjs';

const copy = readCopy();
const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * 按真实页面文件跑一遍占位符替换。
 * @param {string} file
 * @param {{ copy: Record<string, string>, env?: Record<string, string>, includePwa?: boolean }} options
 * @returns {string}
 */
function renderPage(file, options) {
  const plugin = pwaHtmlCopyPlugin(options);
  const html = readFileSync(path.join(root, file), 'utf8');
  return plugin.transformIndexHtml.handler(html, { path: `/${file}`, filename: path.join(root, file) });
}

/** @param {string} html */
function leftoverPlaceholders(html) {
  return [...new Set(html.match(/%[A-Za-z0-9_]+%/g) ?? [])].sort();
}

test('zh.json 里有安装元信息需要的文案', () => {
  const keys = [
    'app.documentTitle',
    'pwa.manifest.shortName',
    'pwa.manifest.description',
    'pwa.install.title',
    'pwa.install.intro',
    'pwa.install.stepOpen',
    'join.documentTitle',
    'join.iosAction',
    'join.iosBarTitle',
    'join.iosHint',
  ];
  for (const key of keys) {
    assert.equal(typeof copy[key], 'string', `${key} 应存在`);
    assert.ok(copy[key].trim().length > 0, `${key} 不应为空`);
  }
});

test('安装元信息默认取文案表', () => {
  assert.deepEqual(resolvePwaMeta({}, copy), {
    name: copy['app.documentTitle'],
    shortName: copy['pwa.manifest.shortName'],
    description: copy['pwa.manifest.description'],
  });
});

test('PWA_* 环境变量非空时覆盖安装元信息', () => {
  const meta = resolvePwaMeta(
    { PWA_APP_NAME: ' 自定义应用 ', PWA_APP_SHORT_NAME: '自定义', PWA_APP_DESCRIPTION: '自定义描述' },
    copy,
  );
  assert.equal(meta.name, '自定义应用');
  assert.equal(meta.shortName, '自定义');
  assert.equal(meta.description, '自定义描述');

  const fallback = resolvePwaMeta({ PWA_APP_NAME: '  ', PWA_APP_SHORT_NAME: '', PWA_APP_DESCRIPTION: undefined }, copy);
  assert.equal(fallback.name, copy['app.documentTitle']);
  assert.equal(fallback.shortName, copy['pwa.manifest.shortName']);
  assert.equal(fallback.description, copy['pwa.manifest.description']);
});

test('安装元信息缺文案时构建失败', () => {
  assert.throws(() => resolvePwaMeta({}, {}), /安装元信息缺少文案/);
  assert.throws(
    () => resolvePwaMeta({ PWA_APP_NAME: '只有名字' }, { 'app.documentTitle': '标题' }),
    /PWA_APP_DESCRIPTION/,
  );
  assert.deepEqual(resolvePwaMeta({ PWA_APP_NAME: '甲', PWA_APP_SHORT_NAME: '乙', PWA_APP_DESCRIPTION: '丙' }, {}), {
    name: '甲',
    shortName: '乙',
    description: '丙',
  });
});

test('manifest 字段满足安装与启动需要', () => {
  const meta = resolvePwaMeta({}, copy);
  const manifest = buildManifest(meta);
  assert.equal(manifest.name, meta.name);
  assert.equal(manifest.short_name, meta.shortName);
  assert.equal(manifest.description, meta.description);
  assert.equal(manifest.id, '/app/');
  assert.equal(manifest.start_url, '/app/');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.display_override, ['standalone', 'minimal-ui']);
  assert.equal(manifest.prefer_related_applications, false);
  assert.equal(manifest.lang, 'zh-CN');
  assert.equal(manifest.background_color, '#f7f6f3');
  assert.equal(manifest.theme_color, '#f7f6f3');
  for (const size of ['192x192', '512x512']) {
    assert.ok(
      manifest.icons.some((icon) => icon.sizes === size),
      `图标应包含 ${size}`,
    );
  }
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === 'maskable'),
    '应有 maskable 图标',
  );
  assert.ok(
    manifest.icons.every((icon) => icon.src.startsWith('icons/')),
    '图标路径相对 manifest 自身',
  );
});

test('renderHtml 替换占位符并做 HTML 转义', () => {
  const html =
    '<title>%APP_TITLE%</title><meta content="%PWA_DESCRIPTION%"><link href="%BASE_URL%manifest.webmanifest">';
  const rendered = renderHtml(html, { APP_TITLE: 'A & B', PWA_DESCRIPTION: '"展" <会> \'x\'' });
  assert.equal(
    rendered,
    '<title>A &amp; B</title><meta content="&quot;展&quot; &lt;会&gt; &#39;x&#39;"><link href="%BASE_URL%manifest.webmanifest">',
  );
});

test('index.html 换成安装元信息，join.html 只换标题', () => {
  const meta = resolvePwaMeta({}, copy);
  const index = renderPage('index.html', { copy, env: {}, includePwa: true });
  assert.ok(index.includes(`<title>${meta.name}</title>`));
  assert.ok(index.includes(`<meta name="description" content="${meta.description}" />`));
  assert.ok(index.includes(`<meta name="apple-mobile-web-app-title" content="${meta.shortName}" />`));
  assert.ok(index.includes('href="%BASE_URL%manifest.webmanifest"'));
  assert.ok(index.includes('href="%BASE_URL%favicon.ico"'));
  assert.ok(index.includes('name="mobile-web-app-capable" content="yes"'));
  assert.ok(index.includes('name="apple-mobile-web-app-capable" content="yes"'));
  assert.ok(index.includes('name="apple-mobile-web-app-status-bar-style" content="default"'));
  assert.equal(index.match(/name="theme-color"/g)?.length, 2);
  assert.ok(index.includes('rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png"'));
  assert.ok(index.includes('rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png"'));
  assert.deepEqual(leftoverPlaceholders(index), ['%BASE_URL%']);

  const join = renderPage('join.html', { copy, env: {}, includePwa: false });
  assert.ok(join.includes(`<title>${copy['join.documentTitle']}</title>`));
  assert.deepEqual(leftoverPlaceholders(join), []);
});

test('缺占位符取值时直接报错，不把占位符发到线上', () => {
  assert.throws(() => renderPage('index.html', { copy, env: {}, includePwa: false }), /占位符/);
});

test('报名站标题缺文案时构建失败', () => {
  const plugin = pwaHtmlCopyPlugin({ copy: {}, env: {}, includePwa: false });
  const html = readFileSync(path.join(root, 'join.html'), 'utf8');
  assert.throws(
    () => plugin.transformIndexHtml.handler(html, { path: '/join.html', filename: path.join(root, 'join.html') }),
    /join\.documentTitle/,
  );
});

test('Service Worker 源码带预缓存路径，且不缓存版本清单与自身', () => {
  const source = serviceWorkerSource(['/app/index.html', '/app/assets/index-abc.js'], 'abc123');
  assert.ok(source.includes('const CACHE_NAME = "calmobile-app-abc123";'));
  assert.ok(source.includes('/app/assets/index-abc.js'));
  assert.ok(source.includes('cache.add(item)'));
  assert.ok(source.includes("'/api/'"));
  assert.ok(source.includes("'/media/'"));
  assert.ok(!source.includes('self.skipWaiting'));
  assert.ok(!source.includes('self.clients.claim'));
  assert.ok(source.includes("request.mode === 'navigate'"));
  assert.ok(source.includes("cache.match('/app/index.html')"));
  assert.ok(!source.includes('release.json'));
  assert.ok(!source.includes('/app/sw.js'));
});

test('pwaAssetsPlugin 写 manifest 与 sw，预缓存排除版本清单', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'calmobile-pwa-'));
  try {
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
    writeFileSync(path.join(dist, 'release.json'), '{"id":"stale"}');
    writeFileSync(path.join(dist, 'sw.js'), '// stale');
    const plugin = pwaAssetsPlugin({ distDir: dist, env: { PWA_APP_NAME: '测试应用' }, copy });
    await plugin.closeBundle();

    const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.name, '测试应用');
    assert.equal(manifest.short_name, copy['pwa.manifest.shortName']);
    for (const name of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon-180.png']) {
      assert.ok(existsSync(path.join(dist, 'icons', name)), `应生成 ${name}`);
    }
    assert.ok(existsSync(path.join(dist, 'favicon.ico')), '应生成 favicon.ico');

    const source = readFileSync(path.join(dist, 'sw.js'), 'utf8');
    assert.match(source, /const CACHE_NAME = "calmobile-app-[0-9a-f]{64}";/);
    assert.ok(source.includes('/app/assets/index-abc.js'));
    assert.ok(source.includes('/app/index.html'));
    assert.ok(source.includes('/app/manifest.webmanifest'));
    assert.ok(!source.includes('release.json'));
    assert.ok(!source.includes('/app/sw.js'));
    assert.ok(!source.includes('// stale'));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
