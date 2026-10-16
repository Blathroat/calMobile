import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appCacheControl, appRelativePath, lookupAppFile } from './app-shell.js';

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
  assert.match(appCacheControl('assets/index-abc.js'), /immutable/);
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
