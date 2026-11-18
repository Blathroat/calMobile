import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appCacheControl, appRelativePath, defaultPackagedAppRoot, lookupAppFile, pickAppRoot } from './app-shell.js';

test('应用页面路径停在 /app 内', () => {
  assert.equal(appRelativePath('/app'), 'index.html');
  assert.equal(appRelativePath('/app/'), 'index.html');
  assert.equal(appRelativePath('/app/index.html'), 'index.html');
  assert.equal(appRelativePath('/app/assets/index-abc.js'), 'assets/index-abc.js');
  assert.equal(appRelativePath('/app/release.json'), 'release.json');
  assert.equal(appRelativePath('/e/exh-1'), null);
  assert.equal(appRelativePath('/app/../secret'), null);
  assert.equal(appRelativePath('/app/%2e%2e/secret'), null);
  assert.equal(appRelativePath('/app/assets/'), null);
});

test('入口不长期缓存，哈希资源可以', () => {
  assert.equal(appCacheControl('index.html'), 'no-cache');
  assert.equal(appCacheControl('release.json'), 'no-cache');
  assert.equal(appCacheControl('sw.js'), 'no-cache');
  assert.equal(appCacheControl('manifest.webmanifest'), 'no-cache');
  assert.equal(appCacheControl('icons/apple-touch-icon.png'), 'no-cache');
  assert.match(appCacheControl('assets/index-abc.js'), /immutable/);
});

test('PWA 清单、Service Worker 和图标按固定类型托管，不长期缓存', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'calmobile-pwa-'));
  try {
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>应用</title>');
    writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"展会排期助手","start_url":"/app/"}');
    writeFileSync(path.join(root, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(path.join(root, 'favicon.ico'), 'ico');
    mkdirSync(path.join(root, 'icons'));
    writeFileSync(path.join(root, 'icons', 'icon-192.png'), 'png');
    const manifest = lookupAppFile(root, '/app/manifest.webmanifest');
    assert.equal(manifest.kind, 'file');
    if (manifest.kind === 'file') {
      assert.equal(manifest.file.type, 'application/manifest+json; charset=utf-8');
      assert.equal(manifest.file.cache, 'no-cache');
      assert.match(manifest.file.body.toString(), /展会排期助手/);
    }
    const worker = lookupAppFile(root, '/app/sw.js');
    assert.equal(worker.kind, 'file');
    if (worker.kind === 'file') {
      assert.equal(worker.file.type, 'text/javascript; charset=utf-8');
      assert.equal(worker.file.cache, 'no-cache');
    }
    const icon = lookupAppFile(root, '/app/icons/icon-192.png');
    assert.equal(icon.kind, 'file');
    if (icon.kind === 'file') {
      assert.equal(icon.file.type, 'image/png');
      assert.equal(icon.file.cache, 'no-cache');
    }
    const favicon = lookupAppFile(root, '/app/favicon.ico');
    assert.equal(favicon.kind, 'file');
    if (favicon.kind === 'file') {
      assert.equal(favicon.file.type, 'image/x-icon');
      assert.equal(favicon.file.cache, 'no-cache');
    }
    assert.equal(lookupAppFile(root, '/app/manifest.missing.webmanifest').kind, 'missing');
    assert.equal(lookupAppFile(root, '/app/sw-missing.js').kind, 'missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('缺的脚本不回退成页面，穿越读不到目录外', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'calmobile-app-'));
  try {
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>应用</title>');
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)');
    const page = lookupAppFile(root, '/app/');
    assert.equal(page.kind, 'file');
    if (page.kind === 'file') assert.match(page.file.body.toString(), /应用/);
    const script = lookupAppFile(root, '/app/assets/app.js');
    assert.equal(script.kind, 'file');
    if (script.kind === 'file') assert.match(script.file.cache, /immutable/);
    assert.equal(lookupAppFile(root, '/app/assets/missing.js').kind, 'missing');
    assert.equal(lookupAppFile(root, '/app/../secret').kind, 'missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('web/dist 缺失时选择运行时包里的 app-shell 副本', () => {
  const web = mkdtempSync(path.join(tmpdir(), 'calmobile-app-web-'));
  const packaged = mkdtempSync(path.join(tmpdir(), 'calmobile-app-packaged-'));
  try {
    writeFileSync(path.join(packaged, 'index.html'), '<!doctype html><title>包内页面</title>');
    assert.equal(pickAppRoot(web, packaged), packaged);
    writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>构建页面</title>');
    assert.equal(pickAppRoot(web, packaged), web);
  } finally {
    rmSync(web, { recursive: true, force: true });
    rmSync(packaged, { recursive: true, force: true });
  }
});

test('运行时包 app-shell 路径在 server/dist 下', () => {
  assert.match(defaultPackagedAppRoot(), /server[\\/]dist[\\/]app-shell$/);
});
