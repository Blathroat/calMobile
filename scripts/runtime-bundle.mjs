/**
 * 把构建产物暂存成可以直接 `npm publish` 的运行时包。
 *
 * 包内保持部署根的样子：`server/` 与 `web/` 同级。服务端用
 * `new URL('../../../web/dist', import.meta.url)` 找页面产物，解压后必须仍然是
 * `releases/<版本>/server/dist/server/...` 与 `releases/<版本>/web/dist/...`。
 *
 * 只复制运行时要用的文件。源码、测试、开发脚本和 `.env` 不进包。
 * `server/dist` 里另外带 `app-shell/`、`app-shell-join/` 两份页面壳副本，`web/dist`
 * 或 `web/dist-join` 被 systemd 误删时服务端可以回退；`scripts/build-icons.mjs`
 * 供服务器启动时按 `APP_ICON` 生成运行时图标，图标实现拆在 `scripts/icons/`。
 * 部署配置以 `deploy/instance.env.example` 说明、`deploy/systemd/*.in` 提供单元模板，
 * 由 `scripts/render-units.mjs` 渲染；包名默认 `calmobile-server`，可用
 * `CALMOBILE_PACKAGE` 覆盖。
 */

import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 默认的 npm 包名。多实例或改名发布时用 CALMOBILE_PACKAGE 覆盖。 */
export const DEFAULT_PACKAGE_NAME = 'calmobile-server';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolvePackageName(env = process.env) {
  const value = String(env.CALMOBILE_PACKAGE ?? '').trim();
  if (!value) return DEFAULT_PACKAGE_NAME;
  if (/\s/.test(value)) throw new Error(`CALMOBILE_PACKAGE 必须是合法的 npm 包名：${value}`);
  return value;
}

/** 版本号与仓库里 `0.1.<运行编号>` 的发布口径一致。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** 包根相对路径 ← 仓库根相对路径。目录整份复制。 */
export const RUNTIME_ENTRIES = [
  ['server/package.json', 'server/package.json'],
  ['server/pnpm-lock.yaml', 'server/pnpm-lock.yaml'],
  ['server/pnpm-workspace.yaml', 'server/pnpm-workspace.yaml'],
  ['server/dist', 'server/dist'],
  ['web/dist', 'web/dist'],
  ['web/dist-join', 'web/dist-join'],
  ['deploy/production.env', 'deploy/production.env'],
  ['deploy/instance.env.example', 'deploy/instance.env.example'],
  ['deploy/calmobile-update.mjs', 'deploy/calmobile-update.mjs'],
  ['deploy/systemd/calmobile.service.in', 'deploy/systemd/calmobile.service.in'],
  ['deploy/systemd/calmobile-update.service.in', 'deploy/systemd/calmobile-update.service.in'],
  ['deploy/systemd/calmobile-update.timer.in', 'deploy/systemd/calmobile-update.timer.in'],
  ['scripts/sync-production-env.mjs', 'scripts/sync-production-env.mjs'],
  ['scripts/client-target.mjs', 'scripts/client-target.mjs'],
  ['scripts/env-file.mjs', 'scripts/env-file.mjs'],
  // 运行时品牌层在服务启动时按 APP_ICON 生成图标，生成器和它依赖的模块一起进包。
  ['scripts/build-icons.mjs', 'scripts/build-icons.mjs'],
  ['scripts/icons/png.mjs', 'scripts/icons/png.mjs'],
  ['scripts/icons/config.mjs', 'scripts/icons/config.mjs'],
  ['scripts/icons/web.mjs', 'scripts/icons/web.mjs'],
  ['scripts/icons/android.mjs', 'scripts/icons/android.mjs'],
  // 服务器上的 systemd 单元用这份脚本按实例配置渲染。
  ['scripts/render-units.mjs', 'scripts/render-units.mjs'],
];

/** 服务器更新器解压后必须能找到的文件。与 deploy/calmobile-update.mjs 的清单一致（测试直接比对）。 */
export const REQUIRED_ENTRIES = [
  'package.json',
  'server/package.json',
  'server/pnpm-lock.yaml',
  'server/pnpm-workspace.yaml',
  'server/dist/index.js',
  'server/dist/config/migrate.js',
  'server/dist/server/app-shell.js',
  'server/dist/server/join-site.js',
  'web/dist/index.html',
  'web/dist/release.json',
  'server/dist/app-shell/index.html',
  'web/dist-join/join.html',
  'server/dist/app-shell-join/join.html',
  'deploy/production.env',
  'deploy/instance.env.example',
  'deploy/calmobile-update.mjs',
  'deploy/systemd/calmobile.service.in',
  'deploy/systemd/calmobile-update.service.in',
  'deploy/systemd/calmobile-update.timer.in',
  'scripts/sync-production-env.mjs',
  'scripts/client-target.mjs',
  'scripts/env-file.mjs',
  'scripts/build-icons.mjs',
  'scripts/icons/png.mjs',
  'scripts/icons/config.mjs',
  'scripts/icons/web.mjs',
  'scripts/icons/android.mjs',
  'scripts/render-units.mjs',
];

/** 这些路径出现在包里说明复制范围写错了。 */
export const FORBIDDEN_PATHS = [
  /^server\/src\//,
  /^server\/test\//,
  /^server\/scripts\//,
  /^server\/status-page\//,
  /^server\/\.env/,
  /^web\/src\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
];

/**
 * @param {string} version
 * @param {string} [name] npm 包名，默认取 CALMOBILE_PACKAGE 或 calmobile-server
 * @returns {{ name: string, version: string, description: string, private: boolean, license: string, engines: { node: string } }}
 */
export function runtimePackageJson(version, name = resolvePackageName()) {
  const text = String(version);
  if (!VERSION_PATTERN.test(text)) throw new Error(`运行时包版本号必须是 x.y.z：${text}`);
  return {
    name,
    version: text,
    description: '展会排期助手运行时包：服务端与两份页面产物',
    private: false,
    license: 'UNLICENSED',
    repository: { type: 'git', url: 'git+https://github.com/Blathroat/calMobile.git' },
    engines: { node: '^24.15.0 || >=26.0.0' },
  };
}

/**
 * 版本号同时写进 `server/package.json`，`/api/v1/status` 的 `serviceVersion` 才是当前发布的版本。
 *
 * @param {string} text
 * @param {string} version
 */
export function rewriteServerPackage(text, version) {
  const pkg = JSON.parse(String(text));
  if (typeof pkg !== 'object' || pkg === null) throw new Error('server/package.json 不是对象');
  pkg.version = version;
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * @param {string} root
 * @returns {Promise<string[]>} 相对路径，分隔符统一成 `/`。
 */
export async function listFiles(root) {
  /** @type {string[]} */
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      files.push(relative);
    }
  }
  await walk(root);
  return files.sort();
}

/**
 * @param {string[]} files 相对路径
 * @returns {string[]} 问题清单，空数组表示通过。
 */
export function verifyRuntimeManifest(files) {
  const present = new Set(files);
  const problems = [];
  for (const entry of REQUIRED_ENTRIES) {
    if (!present.has(entry)) problems.push(`缺少 ${entry}`);
  }
  for (const file of files) {
    if (FORBIDDEN_PATHS.some((pattern) => pattern.test(file))) {
      problems.push(`不该打包：${file}`);
    }
  }
  return problems;
}

/**
 * @param {string} root
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(root, relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

/**
 * 校验一个已经暂存好的运行时包目录。
 *
 * @param {string} dir
 * @param {string} [expectedVersion]
 * @param {string} [expectedName] 默认取 CALMOBILE_PACKAGE 或 calmobile-server
 */
export async function verifyRuntimePackage(dir, expectedVersion, expectedName = resolvePackageName()) {
  const root = path.resolve(dir);
  const files = await listFiles(root);
  const problems = verifyRuntimeManifest(files);
  let version = '';
  if (!problems.length) {
    const rootPackage = await readJson(root, 'package.json');
    version = typeof rootPackage.version === 'string' ? rootPackage.version : '';
    if (rootPackage.name !== expectedName) problems.push(`包名必须是 ${expectedName}：${String(rootPackage.name)}`);
    if (expectedVersion && rootPackage.version !== expectedVersion) {
      problems.push(`包版本必须是 ${expectedVersion}：${String(rootPackage.version)}`);
    }
    const serverPackage = await readJson(root, 'server/package.json');
    if (serverPackage.version !== version) {
      problems.push(`server/package.json 的版本是 ${String(serverPackage.version)}，与包版本 ${version} 不一致`);
    }
    if (expectedVersion && serverPackage.version !== expectedVersion) {
      problems.push(`server/package.json 版本必须是 ${expectedVersion}：${String(serverPackage.version)}`);
    }
  }
  if (problems.length) throw new Error(`运行时包不完整：\n${problems.join('\n')}`);
  return { version, files };
}

/**
 * @param {{ repoRoot: string, outDir: string, version: string }} input
 */
export async function stageRuntimePackage(input) {
  const repoRoot = path.resolve(input.repoRoot);
  const outDir = path.resolve(input.outDir);
  const version = String(input.version);
  const packageName = resolvePackageName();
  runtimePackageJson(version, packageName);

  const missing = [];
  for (const [from] of RUNTIME_ENTRIES) {
    try {
      await stat(path.join(repoRoot, from));
    } catch {
      missing.push(from);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `缺少构建产物：${missing.join('、')}。先执行 pnpm --dir server build 与 pnpm --dir web build。`,
    );
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const [from, to] of RUNTIME_ENTRIES) {
    const source = path.join(repoRoot, from);
    const target = path.join(outDir, to);
    await mkdir(path.dirname(target), { recursive: true });
    const info = await stat(source);
    if (info.isDirectory()) {
      await cp(source, target, { recursive: true });
    } else {
      await copyFile(source, target);
    }
  }

  // 运行时包里保留 web/dist 给常规读取，同时把它复制到 server/dist/app-shell：
  // 生产 systemd 可能清掉 current/web/dist，服务端会退到这份副本继续提供 /app/。
  await cp(path.join(repoRoot, 'web/dist'), path.join(outDir, 'server/dist/app-shell'), {
    recursive: true,
  });
  // 报名站同样留一份副本，避免 systemd 一并清掉 web/dist-join 后报名站 502。
  await cp(path.join(repoRoot, 'web/dist-join'), path.join(outDir, 'server/dist/app-shell-join'), {
    recursive: true,
  });

  await writeFile(
    path.join(outDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson(version, packageName), null, 2)}\n`,
    'utf8',
  );
  const serverPackagePath = path.join(outDir, 'server/package.json');
  await writeFile(
    serverPackagePath,
    rewriteServerPackage(await readFile(serverPackagePath, 'utf8'), version),
    'utf8',
  );

  const result = await verifyRuntimePackage(outDir, version, packageName);
  return { dir: outDir, version, files: result.files };
}

/**
 * @param {string[]} argv
 * @returns {{ mode: 'stage' | 'check', version: string, outDir: string }}
 */
function parseArgs(argv) {
  /** @type {{ mode: 'stage' | 'check', version: string, outDir: string }} */
  const options = { mode: 'stage', version: '', outDir: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version') {
      options.version = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--out') {
      options.outDir = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--check') {
      options.mode = 'check';
      options.outDir = argv[index + 1] ?? '';
      index += 1;
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'check') {
    if (!options.outDir) throw new Error('用法：runtime-bundle.mjs --check <目录>');
    const result = await verifyRuntimePackage(options.outDir);
    process.stdout.write(`运行时包完整：${result.files.length} 个文件（版本 ${result.version || '未声明'}）\n`);
    return;
  }
  if (!options.version || !options.outDir) {
    throw new Error('用法：runtime-bundle.mjs --version <x.y.z> --out <目录>');
  }
  const result = await stageRuntimePackage({
    repoRoot: fileURLToPath(new URL('..', import.meta.url)),
    outDir: options.outDir,
    version: options.version,
  });
  process.stdout.write(`运行时包已暂存：${result.dir}（${result.files.length} 个文件，版本 ${result.version}）\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
