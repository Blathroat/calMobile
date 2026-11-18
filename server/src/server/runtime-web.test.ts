import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBranding } from '../config/branding.js';
import { cleanupRuntimeDirs, prepareRuntimeJoin, prepareRuntimeWeb } from './runtime-web.js';

function fixtureRoot(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `calmobile-${prefix}-`));
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function makeAppFixture(root: string): void {
  write(
    root,
    'index.html',
    `<!doctype html><html><head>
<title>默认应用</title>
<meta name="description" content="默认描述" />
<meta name="apple-mobile-web-app-title" content="默认短名" />
<meta name="theme-color" content="#111111" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#222222" media="(prefers-color-scheme: dark)" />
</head><body><script type="module" src="/app/assets/app.js"></script></body></html>`,
  );
  write(
    root,
    'manifest.webmanifest',
    `${JSON.stringify(
      {
        id: '/app/',
        name: '默认应用',
        short_name: '默认短名',
        description: '默认描述',
        lang: 'zh-CN',
        start_url: '/app/',
        scope: '/app/',
        display: 'standalone',
        background_color: '#f7f6f3',
        theme_color: '#f7f6f3',
        icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }],
      },
      null,
      2,
    )}\n`,
  );
  write(root, 'sw.js', 'const CACHE_NAME = "calmobile-app-static";\nconst PRECACHE = [];\n');
  write(root, 'release.json', '{"id":"static","files":[]}\n');
  write(root, 'assets/app.js', 'console.log("app");\n');
}

function makeIconDirectory(root: string): void {
  write(root, 'favicon.ico', 'ico');
  write(root, 'icons/icon-192.png', 'png-192');
  write(root, 'icons/icon-512.png', 'png-512');
  write(root, 'icons/icon-1024.png', 'png-1024');
  write(root, 'icons/maskable-512.png', 'png-maskable');
  write(root, 'icons/favicon-32.png', 'png-32');
  write(root, 'icons/apple-touch-icon-180.png', 'png-apple');
}

function readRelease(root: string): { id: string; files: { path: string; sha256: string }[] } {
  return JSON.parse(readFileSync(path.join(root, 'release.json'), 'utf8')) as {
    id: string;
    files: { path: string; sha256: string }[];
  };
}

test('没有品牌配置时直接使用静态目录，不生成副本', () => {
  const base = fixtureRoot('runtime-web-empty-');
  try {
    makeAppFixture(base);
    const result = prepareRuntimeWeb({ baseRoot: base, branding: resolveBranding({}) });
    assert.equal(result.applied, false);
    assert.equal(result.root, base);
    assert.deepEqual(result.warnings, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});

test('标题、meta、manifest、图标与 release.json 在运行时一起生成', () => {
  const base = fixtureRoot('runtime-web-base-');
  const icons = fixtureRoot('runtime-web-icons-');
  try {
    makeAppFixture(base);
    makeIconDirectory(icons);
    const branding = resolveBranding({
      PWA_APP_NAME: '活动排期助手',
      PWA_APP_SHORT_NAME: '青枳',
      PWA_APP_DESCRIPTION: '青枳 · 活动日历',
      APP_TITLE: '青枳 · 活动排期助手',
      PWA_LANG: 'zh-CN',
      PWA_THEME_COLOR: '#FDCC32',
      PWA_THEME_COLOR_DARK: '#101215',
      PWA_ICON_DIR: icons,
    });
    const result = prepareRuntimeWeb({ baseRoot: base, branding });
    assert.equal(result.applied, true);
    assert.notEqual(result.root, base);

    const html = readFileSync(path.join(result.root, 'index.html'), 'utf8');
    assert.match(html, /<title>青枳 · 活动排期助手<\/title>/);
    assert.match(html, /name="description" content="青枳 · 活动日历"/);
    assert.match(html, /apple-mobile-web-app-title" content="青枳"/);
    assert.match(html, /theme-color" content="#FDCC32" media="\(prefers-color-scheme: light\)"/);
    assert.match(html, /theme-color" content="#101215" media="\(prefers-color-scheme: dark\)"/);
    assert.match(html, /__CALMOBILE_BRANDING__/);
    assert.match(html, /"appName":"活动排期助手"/);

    const manifest = JSON.parse(readFileSync(path.join(result.root, 'manifest.webmanifest'), 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal(manifest.name, '活动排期助手');
    assert.equal(manifest.short_name, '青枳');
    assert.equal(manifest.description, '青枳 · 活动日历');
    assert.equal(manifest.theme_color, '#FDCC32');

    assert.equal(readFileSync(path.join(result.root, 'icons/icon-192.png'), 'utf8'), 'png-192');
    assert.equal(readFileSync(path.join(result.root, 'favicon.ico'), 'utf8'), 'ico');

    const release = readRelease(result.root);
    assert.notEqual(release.id, 'static');
    const paths = release.files.map((file) => file.path);
    assert.deepEqual(paths, [...paths].sort());
    for (const file of release.files) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(result.root, file.path)))
        .digest('hex');
      assert.equal(actual, file.sha256, `${file.path} 的 sha256 应和 release.json 一致`);
    }
    assert.ok(paths.includes('index.html'));
    assert.ok(paths.includes('manifest.webmanifest'));
    assert.ok(paths.includes('icons/icon-192.png'));
    assert.ok(!paths.includes('release.json'));

    const sw = readFileSync(path.join(result.root, 'sw.js'), 'utf8');
    assert.match(sw, /const CACHE_NAME = "calmobile-app-[0-9a-f]{64}";/);
    assert.doesNotMatch(sw, /calmobile-app-static/);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(icons, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});

test('只配图标时保持 index 与 manifest 字节不变，但仍重算 release.json', () => {
  const base = fixtureRoot('runtime-web-icon-only-');
  const icons = fixtureRoot('runtime-web-icon-only-src-');
  try {
    makeAppFixture(base);
    makeIconDirectory(icons);
    const beforeIndex = readFileSync(path.join(base, 'index.html'));
    const beforeManifest = readFileSync(path.join(base, 'manifest.webmanifest'));
    const result = prepareRuntimeWeb({
      baseRoot: base,
      branding: resolveBranding({ PWA_ICON_DIR: icons }),
    });
    assert.equal(result.applied, true);
    assert.deepEqual(readFileSync(path.join(result.root, 'index.html')), beforeIndex);
    assert.deepEqual(readFileSync(path.join(result.root, 'manifest.webmanifest')), beforeManifest);
    const release = readRelease(result.root);
    assert.ok(release.files.some((file) => file.path === 'icons/icon-1024.png'));
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(icons, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});

test('APP_ICON 在服务启动时调用图标生成器', () => {
  const base = fixtureRoot('runtime-web-app-icon-');
  try {
    makeAppFixture(base);
    const icon = fileURLToPath(new URL('../../../web/public/icons/icon-1024.png', import.meta.url));
    const result = prepareRuntimeWeb({
      baseRoot: base,
      branding: resolveBranding({
        PWA_APP_NAME: '活动排期助手',
        APP_ICON: icon,
        APP_ICON_TRANSPARENT: '1',
      }),
    });
    assert.equal(result.applied, true);
    assert.ok(existsSync(path.join(result.root, 'icons/icon-192.png')));
    assert.ok(existsSync(path.join(result.root, 'icons/icon-1024.png')));
    const release = readRelease(result.root);
    for (const file of release.files) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(result.root, file.path)))
        .digest('hex');
      assert.equal(actual, file.sha256);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});

test('manifest 或图标配置坏了只回退对应项，不丢其它品牌配置', () => {
  const base = fixtureRoot('runtime-web-broken-');
  try {
    makeAppFixture(base);
    rmSync(path.join(base, 'manifest.webmanifest'));
    const result = prepareRuntimeWeb({
      baseRoot: base,
      branding: resolveBranding({ PWA_APP_NAME: '活动排期助手' }),
    });
    assert.equal(result.applied, true);
    assert.notEqual(result.root, base);
    assert.ok(result.warnings.some((item) => item.includes('PWA manifest失败')));
    const html = readFileSync(path.join(result.root, 'index.html'), 'utf8');
    assert.match(html, /<title>活动排期助手<\/title>/);

    const missingIcons = prepareRuntimeWeb({
      baseRoot: base,
      branding: resolveBranding({
        PWA_APP_NAME: '活动排期助手',
        PWA_ICON_DIR: path.join(tmpdir(), 'calmobile-icons-absent'),
      }),
    });
    assert.equal(missingIcons.applied, true);
    assert.ok(missingIcons.warnings.some((item) => item.includes('PWA 图标失败')));
  } finally {
    rmSync(base, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});

test('Service Worker 缓存名支持单引号；找不到 CACHE_NAME 时只回退 SW', () => {
  const base = fixtureRoot('runtime-web-sw-');
  try {
    makeAppFixture(base);
    write(base, 'sw.js', "const CACHE_NAME = 'calmobile-app-static';\nconst PRECACHE = [];\n");
    const single = prepareRuntimeWeb({
      baseRoot: base,
      branding: resolveBranding({ PWA_APP_NAME: '活动排期助手' }),
    });
    assert.equal(single.applied, true);
    assert.doesNotMatch(readFileSync(path.join(single.root, 'sw.js'), 'utf8'), /static/);

    write(base, 'sw.js', 'const CACHE = "legacy";\n');
    const missing = prepareRuntimeWeb({
      baseRoot: base,
      branding: resolveBranding({ PWA_APP_NAME: '活动排期助手' }),
    });
    assert.equal(missing.applied, true);
    assert.ok(missing.warnings.some((item) => item.includes('Service Worker 缓存名失败')));
    assert.equal(readFileSync(path.join(missing.root, 'sw.js'), 'utf8'), 'const CACHE = "legacy";\n');
  } finally {
    rmSync(base, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});

test('报名站标题生成副本并注入品牌脚本', () => {
  const base = fixtureRoot('runtime-join-');
  try {
    write(base, 'join.html', '<!doctype html><html><head><title>报名</title></head><body></body></html>');
    write(base, 'assets/join.js', 'console.log("join");\n');
    const result = prepareRuntimeJoin({
      baseRoot: base,
      branding: resolveBranding({ JOIN_TITLE: '青枳', PWA_APP_SHORT_NAME: '青枳' }),
    });
    assert.equal(result.applied, true);
    assert.notEqual(result.root, base);
    const html = readFileSync(path.join(result.root, 'join.html'), 'utf8');
    assert.match(html, /<title>青枳<\/title>/);
    assert.match(html, /__CALMOBILE_BRANDING__/);
    assert.match(html, /"joinTitle":"青枳"/);
    assert.equal(readFileSync(path.join(result.root, 'assets/join.js'), 'utf8'), 'console.log("join");\n');
  } finally {
    rmSync(base, { recursive: true, force: true });
    cleanupRuntimeDirs();
  }
});
