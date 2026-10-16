/**
 * 给应用页面包写 `release.json`。
 *
 * 客户端用其中的 id 判断要不要热更新，并用每个文件的 sha256 核对下载。
 * 清单本身不参与 id，避免写入之后 id 又变了。
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} root 构建目录（`web/dist`）。
 * @returns {{ id: string, files: { path: string, sha256: string }[] }}
 */
export function buildReleaseManifest(root) {
  /** @type {{ path: string, sha256: string }[]} */
  const files = [];
  walk(root, root, files);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const id = createHash('sha256');
  for (const file of files) {
    id.update(file.path);
    id.update('\0');
    id.update(file.sha256);
    id.update('\n');
  }
  return { id: id.digest('hex'), files };
}

/** @param {string} root */
export function writeReleaseManifest(root) {
  const manifest = buildReleaseManifest(root);
  writeFileSync(path.join(root, 'release.json'), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {{ path: string, sha256: string }[]} files
 */
function walk(root, dir, files) {
  for (const name of readdirSync(dir)) {
    if (dir === root && name === 'release.json') continue;
    const full = path.join(dir, name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (statSync(full).isDirectory()) {
      walk(root, full, files);
      continue;
    }
    const sha256 = createHash('sha256').update(readFileSync(full)).digest('hex');
    files.push({ path: relative, sha256 });
  }
}
