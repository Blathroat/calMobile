import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildReleaseManifest, writeReleaseManifest } from './release-manifest.mjs';

test('清单覆盖构建产物，且不把自己算进 id', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'calmobile-release-'));
  try {
    writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'index-abc.js'), 'console.log(1)');
    writeFileSync(path.join(root, 'release.json'), '{"stale":true}');

    const first = writeReleaseManifest(root);
    assert.deepEqual(
      first.files.map((file) => file.path),
      ['assets/index-abc.js', 'index.html'],
    );
    assert.match(first.id, /^[0-9a-f]{64}$/);
    const written = JSON.parse(readFileSync(path.join(root, 'release.json'), 'utf8'));
    assert.equal(written.id, first.id);

    const second = buildReleaseManifest(root);
    assert.equal(second.id, first.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
