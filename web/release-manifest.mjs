/**
 * 给应用页面包写 `release.json`。
 *
 * 客户端用其中的 id 判断要不要热更新，并用每个文件的 sha256 核对下载。
 * 清单本身不参与 id，避免写入之后 id 又变了。
 *
 * **HTML 例外**：反向代理会改写页面——Cloudflare 的 JavaScript 检测（JSD）会往 HTML 里插一段
 * 脚本，构建时的 sha256 和客户端拿到的字节永远对不上，热更新会整包被判失败。因此 HTML 条目
 * 额外带 `skipVerify: true`：sha256 照旧写进清单（id 与旧客户端都依赖它），客户端下载后不做
 * 哈希核对，只检查文件完整（非空、HTML 有正常结尾）。其余文件仍然逐个核对。
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} root 构建目录（`web/dist`）。
 * @returns {{ id: string, files: { path: string, sha256: string, skipVerify?: boolean }[] }}
 */
export function buildReleaseManifest(root) {
  /** @type {{ path: string, sha256: string, skipVerify?: boolean }[]} */
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
 * @param {{ path: string, sha256: string, skipVerify?: boolean }[]} files
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
    const entry = { path: relative, sha256 };
    // 见文件头：HTML 可能被反向代理改写，客户端跳过哈希核对。
    if (relative.toLowerCase().endsWith('.html')) entry.skipVerify = true;
    files.push(entry);
  }
}
