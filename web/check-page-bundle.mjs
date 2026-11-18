/**
 * 检查页面包是否写死了实例域名 / API 基址。
 *
 * 同一份 `web/dist`、`web/dist-join` 会被发布到多个 `PUBLIC_BASE_URL`，页面到 API
 * 必须走相对 `/api/v1`。这里阻止构建时又把 `APP_API_BASE`、`VITE_API_BASE` 或
 * `https://<某域名>/api/v1` 打进产物；它不是运行时检查，不依赖浏览器。
 *
 * 两份 Vite 配置都用 `pageBundleCheckPlugin()` 把它挂到 `writeBundle` 与 `closeBundle`，
 * 普通构建和 `--watch` 每次写完都会检查。命令行只用于手工复核：
 * `node check-page-bundle.mjs [目录...]`；缺省检查 `dist` 与 `dist-join`。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 需要扫描的文本产物后缀；图片、字体、source map 不参与。 */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.txt']);

/** 页面里出现这些绝对 API 地址或构建变量，说明产物又重新绑定了实例。 */
const FORBIDDEN = [
  { label: 'APP_API_BASE', pattern: /APP_API_BASE/g },
  { label: 'VITE_API_BASE', pattern: /VITE_API_BASE/g },
  { label: '绝对 API 地址', pattern: /https?:\/\/[^\s"'`\\]+\/api\/v1\b/gi },
];

/**
 * @param {string} dir
 * @returns {string[]} 问题列表，空数组表示通过。
 */
export function checkPageBundle(dir) {
  const root = path.resolve(dir);
  if (!existsSync(root)) throw new Error(`页面包目录不存在：${root}`);
  const problems = [];
  walk(root, (file) => {
    const text = readFileSync(file, 'utf8');
    for (const { label, pattern } of FORBIDDEN) {
      pattern.lastIndex = 0;
      const matched = text.match(pattern);
      if (matched) problems.push(`${path.relative(root, file)} 含 ${label}：${matched[0]}`);
    }
  });
  return problems;
}

/**
 * Vite 构建插件：普通构建与 `--watch` 每次产物写完后都检查，避免只在 npm script 里生效。
 * `writeBundle` 覆盖 watch 的每次重建；`closeBundle` 再覆盖 pwaAssets 在最后写出的
 * manifest / sw / icons，两者都只读检查，重复跑一次没有副作用。
 * @param {{ distDir: string }} options
 * @returns {{ name: string, apply: 'build', enforce: 'post', writeBundle: () => void, closeBundle: () => void }}
 */
export function pageBundleCheckPlugin({ distDir }) {
  const check = () => {
    const problems = checkPageBundle(distDir);
    if (problems.length > 0) {
      throw new Error(`页面包写死了实例地址：\n${problems.join('\n')}`);
    }
  };
  return {
    name: 'calmobile-page-bundle-check',
    apply: 'build',
    enforce: 'post',
    writeBundle: check,
    closeBundle: check,
  };
}

/**
 * @param {string} root
 * @param {(file: string) => void} visit
 */
function walk(root, visit) {
  for (const name of readdirSync(root)) {
    const file = path.join(root, name);
    if (statSync(file).isDirectory()) {
      walk(file, visit);
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) visit(file);
  }
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === path.resolve(entry)) {
  const explicit = process.argv.length > 2;
  const dirs = explicit ? process.argv.slice(2) : ['dist', 'dist-join'];
  let failed = false;
  let checked = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      // 单构建 app 或 join 时另一个目录不存在；显式点名却不存在是参数/构建错误。
      if (explicit) {
        failed = true;
        process.stderr.write(`页面包目录不存在：${dir}\n`);
      } else {
        process.stderr.write(`跳过不存在的页面包目录：${dir}\n`);
      }
      continue;
    }
    let problems;
    try {
      problems = checkPageBundle(dir);
    } catch (error) {
      failed = true;
      process.stderr.write(`页面包检查失败（${dir}）：${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }
    checked += 1;
    if (problems.length > 0) {
      failed = true;
      process.stderr.write(`页面包写死了实例地址（${dir}）：\n${problems.join('\n')}\n`);
    }
  }
  if (checked === 0) failed = true;
  if (failed) process.exit(1);
  process.stdout.write(`页面包检查通过：${dirs.join('、')}\n`);
}
