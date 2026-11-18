import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkPageBundle, pageBundleCheckPlugin } from './check-page-bundle.mjs';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-page-bundle-'));
  mkdirSync(path.join(dir, 'assets'));
  return dir;
}

test('相对 /api/v1 和普通外部链接不算写死实例', () => {
  const dir = fixture();
  try {
    writeFileSync(
      path.join(dir, 'assets', 'index.js'),
      'const base="/api/v1";fetch(`${base}/auth/login`);const docs="https://example.com/privacy";',
    );
    assert.deepEqual(checkPageBundle(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('绝对 API 地址和构建变量会被拦下', () => {
  const dir = fixture();
  try {
    writeFileSync(
      path.join(dir, 'assets', 'index.js'),
      'fetch("https://app.example.com/api/v1/auth/login");const marker="APP_API_BASE";',
    );
    const problems = checkPageBundle(dir);
    assert.ok(problems.some((item) => item.includes('绝对 API 地址')));
    assert.ok(problems.some((item) => item.includes('APP_API_BASE')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('目录不存在时直接报错，不再静默当作通过', () => {
  assert.throws(() => checkPageBundle(path.join(tmpdir(), 'calmobile-page-bundle-missing')), /目录不存在/);
});

test('Vite 插件在每次产物写完后和关闭前都做同一套检查', () => {
  const dir = fixture();
  try {
    writeFileSync(path.join(dir, 'index.html'), '<title>ok</title>');
    const plugin = pageBundleCheckPlugin({ distDir: dir });
    assert.doesNotThrow(() => plugin.writeBundle());
    assert.doesNotThrow(() => plugin.closeBundle());
    writeFileSync(path.join(dir, 'index.html'), '<title>https://app.example.com/api/v1</title>');
    assert.throws(() => plugin.writeBundle(), /写死了实例地址/);
    assert.throws(() => plugin.closeBundle(), /写死了实例地址/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
