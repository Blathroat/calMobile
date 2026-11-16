#!/usr/bin/env node
/**
 * 从 npm 更新生产环境的 calMobile 运行时包。
 *
 * 由 `calmobile-update.timer` 每 5 分钟调用一次（见同目录的 unit 文件）。
 * 也可以手动执行：
 *
 *   calmobile-update --check                 看当前版本、npm latest 和 pin
 *   calmobile-update --update [--force]      安装 npm 上的最新版本
 *   calmobile-update --rollback [版本]       切回上一版（或指定版本）并 pin
 *   calmobile-update --pin <版本>            锁定版本，timer 不再自动更新
 *   calmobile-update --unpin                 解除锁定
 *
 * 目录：
 *   <root>/releases/<版本>/{server,web}      解压后的运行时包（server 与 web 必须同级）
 *   <root>/current                          指向当前版本的符号链接
 *   <root>/state/{pin,update.lock,cache/}    锁定版本、并发锁和下载缓存
 *
 * 运行时包来自 `npm publish` 的 `calmobile-server`，版本号与 APK 的 `0.1.<运行编号>` 一致。
 *
 * 纯函数（版本比较、更新决策、配置解析、完整性校验）单独导出，测试见
 * `deploy/calmobile-update.test.mjs`。副作用只留在本文件下半部分。
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, statfs, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CONFIG = Object.freeze({
  package: 'calmobile-server',
  registry: 'https://registry.npmjs.org',
  root: '/opt/calmobile',
  keep: 3,
  healthUrl: 'http://127.0.0.1:3000/ping',
  appUrl: 'http://127.0.0.1:3000/app/release.json',
  service: 'calmobile.service',
  envFile: '/etc/calmobile.env',
  configPath: '/etc/calmobile-update.json',
  updaterPath: '/usr/local/lib/calmobile/calmobile-update.mjs',
  minFreeMb: 512,
});

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** 运行时包解压后必须有的文件。与 scripts/runtime-bundle.mjs 的清单保持一致。 */
const REQUIRED_RELEASE_ENTRIES = [
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
  'web/dist-join/join.html',
  'deploy/production.env',
  'deploy/calmobile-update.mjs',
  'scripts/sync-production-env.mjs',
  'scripts/client-target.mjs',
];

const ENV_OVERRIDES = {
  CALMOBILE_PACKAGE: 'package',
  CALMOBILE_REGISTRY: 'registry',
  CALMOBILE_ROOT: 'root',
  CALMOBILE_KEEP: 'keep',
  CALMOBILE_HEALTH_URL: 'healthUrl',
  CALMOBILE_APP_URL: 'appUrl',
  CALMOBILE_SERVICE: 'service',
  CALMOBILE_ENV_FILE: 'envFile',
  CALMOBILE_CONFIG_PATH: 'configPath',
  CALMOBILE_UPDATER_PATH: 'updaterPath',
  CALMOBILE_MIN_FREE_MB: 'minFreeMb',
};

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 750;
const METADATA_TIMEOUT_MS = 15_000;
const TARBALL_TIMEOUT_MS = 120_000;

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isVersion(value) {
  return VERSION_PATTERN.test(String(value));
}

/**
 * @param {string} version
 * @returns {[number, number, number]}
 */
function parseVersion(version) {
  const text = String(version);
  const matched = VERSION_PATTERN.exec(text);
  if (!matched) throw new Error(`版本号必须是 x.y.z：${text}`);
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number} 负数表示 left < right
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/**
 * 更新决策。`pin` 存在时 timer 不再自动更新，除非手动 `--force`。
 *
 * @param {{ current: string, latest: string, pin?: string, force?: boolean }} input
 * @returns {{ action: 'install' | 'update' | 'skip', reason: string }}
 */
export function decideUpdate(input) {
  const current = String(input.current || '');
  const latest = String(input.latest || '');
  const pin = String(input.pin || '');
  const force = Boolean(input.force);
  if (!latest) throw new Error('npm latest 为空');
  if (!current) return { action: 'install', reason: `还没有安装版本，安装 ${latest}` };
  if (pin && !force) {
    return { action: 'skip', reason: pin === latest ? `已锁定在 ${pin}` : `已锁定在 ${pin}，不更新到 ${latest}` };
  }
  if (compareVersions(latest, current) <= 0) return { action: 'skip', reason: `已是最新 ${current}` };
  return { action: 'update', reason: `从 ${current} 更新到 ${latest}` };
}

/**
 * 回滚目标：比当前版本小的最新一版。
 *
 * @param {string[]} releases
 * @param {string} current
 * @returns {string}
 */
export function selectRollbackRelease(releases, current) {
  if (!current) return '';
  const older = releases
    .filter((version) => isVersion(version) && compareVersions(version, current) < 0)
    .sort((left, right) => compareVersions(right, left));
  return older[0] ?? '';
}

/**
 * 校验 npm 元数据里的 `dist.integrity`（`sha512-<base64>`）。
 *
 * @param {Buffer} content
 * @param {string} integrity
 * @returns {boolean}
 */
export function verifyTarballIntegrity(content, integrity) {
  const text = String(integrity || '').trim();
  if (!text) return false;
  const dash = text.indexOf('-');
  if (dash <= 0) return false;
  const algorithm = text.slice(0, dash);
  const expected = text.slice(dash + 1);
  if (algorithm !== 'sha512' && algorithm !== 'sha256' && algorithm !== 'sha1') return false;
  const actual = createHash(algorithm).update(content).digest('base64');
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @returns {string}
 */
export function registryLatestUrl(config) {
  const registry = config.registry.replace(/\/+$/, '');
  const name = config.package.startsWith('@')
    ? config.package.replace('/', '%2f')
    : encodeURIComponent(config.package);
  return `${registry}/${name}/latest`;
}

/**
 * @param {Record<string, unknown>} input
 * @returns {typeof DEFAULT_CONFIG}
 */
export function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      config[key] = input[key];
    }
  }
  config.package = String(config.package ?? '').trim();
  if (!config.package || /\s/.test(config.package)) throw new Error('配置 package 必须是合法的 npm 包名');
  config.registry = String(config.registry ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(config.registry)) throw new Error('配置 registry 必须是 http(s) 地址');
  for (const key of ['root', 'envFile', 'configPath', 'updaterPath']) {
    const value = String(config[key] ?? '').trim();
    if (!path.isAbsolute(value)) throw new Error(`配置 ${key} 必须是绝对路径：${value}`);
    config[key] = value;
  }
  config.service = String(config.service ?? '').trim();
  if (!config.service) throw new Error('配置 service 不能为空');
  config.healthUrl = String(config.healthUrl ?? '').trim();
  if (config.healthUrl && !/^https?:\/\//.test(config.healthUrl)) throw new Error('配置 healthUrl 必须是 http(s) 地址');
  config.appUrl = String(config.appUrl ?? '').trim();
  if (config.appUrl && !/^https?:\/\//.test(config.appUrl)) throw new Error('配置 appUrl 必须是 http(s) 地址');
  config.keep = Number(config.keep);
  if (!Number.isInteger(config.keep) || config.keep < 1 || config.keep > 10) {
    throw new Error('配置 keep 必须是 1..10 的整数');
  }
  config.minFreeMb = Number(config.minFreeMb);
  if (!Number.isInteger(config.minFreeMb) || config.minFreeMb < 0) {
    throw new Error('配置 minFreeMb 必须是非负整数');
  }
  return config;
}

/**
 * @param {{ fileText?: string, env?: Record<string, string | undefined> }} [input]
 * @returns {typeof DEFAULT_CONFIG}
 */
export function resolveConfig(input = {}) {
  const fileText = String(input.fileText ?? '');
  const env = input.env ?? process.env;
  /** @type {Record<string, unknown>} */
  let parsed = {};
  if (fileText.trim()) {
    const value = JSON.parse(fileText);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('更新器配置必须是 JSON 对象');
    }
    parsed = value;
  }
  /** @type {Record<string, unknown>} */
  const overrides = {};
  for (const [envKey, configKey] of Object.entries(ENV_OVERRIDES)) {
    const value = env[envKey];
    if (typeof value === 'string' && value !== '') overrides[configKey] = value;
  }
  return normalizeConfig({ ...parsed, ...overrides });
}

/**
 * @param {string[]} argv
 * @returns {{ mode: 'check' | 'update' | 'rollback' | 'pin' | 'unpin' | 'help', force: boolean, version: string }}
 */
export function parseCli(argv) {
  /** @type {{ mode: 'check' | 'update' | 'rollback' | 'pin' | 'unpin' | 'help', force: boolean, version: string }} */
  const options = { mode: 'update', force: false, version: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      options.mode = 'check';
    } else if (arg === '--update') {
      options.mode = 'update';
    } else if (arg === '--rollback') {
      options.mode = 'rollback';
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options.version = next;
        index += 1;
      }
    } else if (arg === '--pin') {
      options.mode = 'pin';
      options.version = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--unpin') {
      options.mode = 'unpin';
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      options.mode = 'help';
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  return options;
}

function log(message) {
  process.stdout.write(`[calmobile-update] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[calmobile-update] ${message}\n`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code ?? signal}`));
    });
  });
}

/**
 * 捕获输出，用于 `sudo cat`、配置脚本等需要读结果的命令。
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 配置文件路径本身也允许用环境变量覆盖，所以先解析一次路径再读文件。
 *
 * @returns {Promise<typeof DEFAULT_CONFIG>}
 */
async function loadConfig() {
  const base = resolveConfig({ fileText: '', env: process.env });
  let fileText = '';
  try {
    fileText = await readFile(base.configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return resolveConfig({ fileText, env: process.env });
}

async function readCurrentVersion(config) {
  try {
    const target = await readlink(path.join(config.root, 'current'));
    const version = path.basename(target);
    return isVersion(version) ? version : '';
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EINVAL') return '';
    throw error;
  }
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @returns {Promise<string[]>} 从新到旧
 */
async function listReleaseVersions(config) {
  const releasesDir = path.join(config.root, 'releases');
  /** @type {string[]} */
  let entries = [];
  try {
    entries = await readdir(releasesDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((name) => isVersion(name))
    .sort((left, right) => compareVersions(right, left));
}

function pinPath(config) {
  return path.join(config.root, 'state', 'pin');
}

async function readPin(config) {
  try {
    const text = (await readFile(pinPath(config), 'utf8')).trim();
    return isVersion(text) ? text : '';
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function writePin(config, version) {
  parseVersion(version);
  await mkdir(path.join(config.root, 'state'), { recursive: true });
  await writeFile(pinPath(config), `${version}\n`, 'utf8');
}

async function clearPin(config) {
  await rm(pinPath(config), { force: true });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(config) {
  const lockDir = path.join(config.root, 'state', 'update.lock');
  await mkdir(path.dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir);
      await writeFile(path.join(lockDir, 'pid'), `${process.pid}\n`, 'utf8');
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let pid = 0;
      try {
        pid = Number((await readFile(path.join(lockDir, 'pid'), 'utf8')).trim());
      } catch {
        pid = 0;
      }
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
        throw new Error(`已有更新进程在运行（pid ${pid}）`);
      }
      await rm(lockDir, { recursive: true, force: true });
    }
  }
  throw new Error('无法取得更新锁');
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @returns {Promise<{ version: string, tarball: string, integrity: string }>}
 */
async function fetchLatest(config) {
  const url = registryLatestUrl(config);
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`读取 npm 元数据失败（${url}）：${messageOf(error)}`);
  }
  if (!response.ok) throw new Error(`读取 npm 元数据失败（${url}）：HTTP ${response.status}`);
  const meta = await response.json();
  const version = String(meta?.version ?? '');
  if (!isVersion(version)) throw new Error(`npm 返回的版本号不合法：${version}`);
  const tarball = String(meta?.dist?.tarball ?? '');
  const integrity = String(meta?.dist?.integrity ?? '');
  if (!tarball) throw new Error('npm 元数据里没有 dist.tarball');
  if (!integrity) throw new Error('npm 元数据里没有 dist.integrity，拒绝安装未校验的包');
  return { version, tarball, integrity };
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {{ version: string, tarball: string, integrity: string }} info
 * @returns {Promise<string>} 本地 tarball 路径
 */
export async function ensureTarball(config, info) {
  const cacheDir = path.join(config.root, 'state', 'cache');
  await mkdir(cacheDir, { recursive: true });
  const safeName = config.package.replace(/^@/, '').replace(/[\\/]/g, '-');
  const cachePath = path.join(cacheDir, `${safeName}-${info.version}.tgz`);

  try {
    const cached = await readFile(cachePath);
    if (verifyTarballIntegrity(cached, info.integrity)) {
      log(`使用缓存 ${cachePath}`);
      return cachePath;
    }
    await rm(cachePath, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let response;
  try {
    response = await fetch(info.tarball, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`下载 ${info.tarball} 失败：${messageOf(error)}`);
  }
  if (!response.ok) throw new Error(`下载运行时包失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!verifyTarballIntegrity(buffer, info.integrity)) {
    throw new Error('运行时包校验失败：内容与 npm 元数据不一致');
  }
  await writeFile(cachePath, buffer);
  log(`已下载 ${info.version}（${buffer.length} 字节）`);
  return cachePath;
}

/**
 * @param {string} tarball
 * @param {string} targetDir
 */
async function extractTarball(tarball, targetDir) {
  await mkdir(targetDir, { recursive: true });
  await run('tar', ['-xzf', tarball, '--strip-components=1', '-C', targetDir]);
}

/**
 * @param {string} releaseDir
 * @param {string} version
 */
export async function verifyStagedRelease(releaseDir, version) {
  const missing = [];
  for (const entry of REQUIRED_RELEASE_ENTRIES) {
    try {
      await stat(path.join(releaseDir, entry));
    } catch {
      missing.push(entry);
    }
  }
  if (missing.length > 0) throw new Error(`运行时包缺文件：${missing.join('、')}`);
  for (const [label, relative] of [
    ['package.json', 'package.json'],
    ['server/package.json', 'server/package.json'],
  ]) {
    const pkg = JSON.parse(await readFile(path.join(releaseDir, relative), 'utf8'));
    if (pkg.version !== version) {
      throw new Error(`${label} 的版本是 ${String(pkg.version)}，与 npm 上的 ${version} 不一致`);
    }
  }
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} releaseDir
 */
async function installDependencies(config, releaseDir) {
  log('安装生产依赖');
  await run('pnpm', ['install', '--frozen-lockfile', '--prod', '--registry', config.registry], {
    cwd: path.join(releaseDir, 'server'),
    env: { ...process.env, npm_config_registry: config.registry },
  });
}

/**
 * 只补 `/etc/calmobile.env` 还没有的键。必填密钥缺失时同步脚本会失败，更新随之中止。
 *
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} releaseDir
 */
async function mergeEnvironment(config, releaseDir) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'calmobile-env-'));
  try {
    const currentPath = path.join(tempDir, 'current.env');
    const mergedPath = path.join(tempDir, 'merged.env');
    const current = await capture('sudo', ['-n', 'cat', config.envFile]);
    if (current.code !== 0) {
      if (!/No such file/i.test(current.stderr)) {
        throw new Error(`读取 ${config.envFile} 失败：${current.stderr.trim() || `退出码 ${current.code}`}`);
      }
      await writeFile(currentPath, '', 'utf8');
    } else {
      await writeFile(currentPath, current.stdout, 'utf8');
    }
    const merged = await capture(
      process.execPath,
      [
        path.join(releaseDir, 'scripts', 'sync-production-env.mjs'),
        '--current',
        currentPath,
        '--template',
        path.join(releaseDir, 'deploy', 'production.env'),
        '--out',
        mergedPath,
      ],
      // 服务器环境文件是唯一来源：不把更新器进程里的变量再当成「新值」传进去。
      { cwd: releaseDir, env: {} },
    );
    if (merged.code !== 0) {
      throw new Error(`环境文件合并失败：${merged.stderr.trim() || merged.stdout.trim() || `退出码 ${merged.code}`}`);
    }
    const nextText = await readFile(mergedPath, 'utf8');
    const currentText = current.code === 0 ? current.stdout : '';
    if (nextText === currentText) {
      log('环境文件没有缺键');
      return;
    }
    await run('sudo', ['-n', 'install', '-m', '600', '-o', 'root', '-g', 'root', mergedPath, config.envFile]);
    log(`环境文件已补齐：${merged.stdout.trim()}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} releaseDir
 */
async function runMigrations(config, releaseDir) {
  log('执行数据库迁移');
  await run(
    'sudo',
    [
      '-n',
      'env',
      `DOTENV_CONFIG_PATH=${config.envFile}`,
      'DOTENV_CONFIG_QUIET=true',
      process.execPath,
      'dist/config/migrate.js',
      'migrate',
      '--production',
    ],
    { cwd: path.join(releaseDir, 'server') },
  );
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} version
 */
async function switchCurrent(config, version) {
  const releasesDir = path.join(config.root, 'releases');
  const target = path.join(releasesDir, version);
  const temporary = path.join(config.root, '.current.tmp');
  await rm(temporary, { force: true });
  await symlink(target, temporary);
  await rename(temporary, path.join(config.root, 'current'));
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 */
async function restartService(config) {
  log(`重启 ${config.service}`);
  await run('sudo', ['-n', 'systemctl', 'restart', config.service]);
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 */
async function waitHealthy(config) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(config.healthUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        if (config.appUrl) {
          const app = await fetch(config.appUrl, { signal: AbortSignal.timeout(2000) }).catch(() => null);
          if (!app?.ok) warn(`应用页面产物暂时不可用：${config.appUrl}`);
        }
        return;
      }
    } catch {
      // 进程可能还在启动，继续等。
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
  throw new Error(`健康检查超时：${config.healthUrl}`);
}

/**
 * 更新器本身也随包发布。切换成功后再覆盖，下一次运行使用新版本。
 *
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} releaseDir
 */
async function selfUpdate(config, releaseDir) {
  const source = path.join(releaseDir, 'deploy', 'calmobile-update.mjs');
  const next = await readFile(source, 'utf8');
  let installed = '';
  try {
    installed = await readFile(config.updaterPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (installed === next) return false;
  await run('sudo', ['-n', 'install', '-m', '755', '-o', 'root', '-g', 'root', source, config.updaterPath]);
  return true;
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} current
 * @param {string} pinned
 */
async function cleanup(config, current, pinned) {
  const releases = await listReleaseVersions(config);
  const keep = new Set(releases.slice(0, config.keep));
  if (current) keep.add(current);
  if (pinned) keep.add(pinned);
  for (const version of releases) {
    if (keep.has(version)) continue;
    await rm(path.join(config.root, 'releases', version), { recursive: true, force: true });
    log(`删除旧版本 ${version}`);
  }
  const cacheDir = path.join(config.root, 'state', 'cache');
  try {
    for (const name of await readdir(cacheDir)) {
      if (!current || !name.includes(`-${current}.tgz`)) {
        await rm(path.join(cacheDir, name), { force: true });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * 上次进程被强杀时可能留下未完成的临时目录，更新前清掉。
 *
 * @param {typeof DEFAULT_CONFIG} config
 */
async function removeStaleTemporaryReleases(config) {
  const releasesDir = path.join(config.root, 'releases');
  /** @type {string[]} */
  let entries = [];
  try {
    entries = await readdir(releasesDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const name of entries) {
    if (!name.startsWith('.tmp-')) continue;
    await rm(path.join(releasesDir, name), { recursive: true, force: true });
    warn(`清理未完成的临时版本 ${name}`);
  }
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 */
async function checkFreeSpace(config) {
  const info = await statfs(config.root);
  const freeMb = (Number(info.bavail) * Number(info.bsize)) / 1024 / 1024;
  if (freeMb < config.minFreeMb) {
    throw new Error(`磁盘余量不足：剩 ${Math.floor(freeMb)} MB，至少需要 ${config.minFreeMb} MB`);
  }
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {{ force: boolean }} options
 */
async function runUpdate(config, options) {
  const releaseLock = await acquireLock(config);
  let temporary = '';
  try {
    const current = await readCurrentVersion(config);
    const pin = await readPin(config);
    const info = await fetchLatest(config);
    const decision = decideUpdate({ current, latest: info.version, pin, force: options.force });
    log(`当前 ${current || '未安装'}，npm latest ${info.version}：${decision.reason}`);
    if (decision.action === 'skip') return;

    await checkFreeSpace(config);
    await removeStaleTemporaryReleases(config);
    const tarball = await ensureTarball(config, info);
    const releasesDir = path.join(config.root, 'releases');
    await mkdir(releasesDir, { recursive: true });
    temporary = path.join(releasesDir, `.tmp-${info.version}-${process.pid}`);
    await rm(temporary, { recursive: true, force: true });
    await extractTarball(tarball, temporary);
    await verifyStagedRelease(temporary, info.version);
    await installDependencies(config, temporary);
    await mergeEnvironment(config, temporary);
    await runMigrations(config, temporary);

    const finalDir = path.join(releasesDir, info.version);
    await rm(finalDir, { recursive: true, force: true });
    await rename(temporary, finalDir);
    temporary = '';
    await switchCurrent(config, info.version);

    try {
      await restartService(config);
      await waitHealthy(config);
    } catch (error) {
      const reason = messageOf(error);
      if (current) {
        warn(`新版本 ${info.version} 启动失败，回滚到 ${current}：${reason}`);
        await switchCurrent(config, current);
        await restartService(config);
        await waitHealthy(config);
        await writePin(config, current);
        throw new Error(`新版本 ${info.version} 启动失败，已回滚并锁定在 ${current}`);
      }
      throw error;
    }

    if (options.force) await clearPin(config);
    let updaterChanged = false;
    try {
      updaterChanged = await selfUpdate(config, finalDir);
    } catch (error) {
      warn(`更新器自更新失败（不影响本次版本）：${messageOf(error)}`);
    }
    await cleanup(config, info.version, await readPin(config));
    log(`已更新到 ${info.version}${updaterChanged ? '；更新器下次运行使用新版本' : ''}`);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    await releaseLock();
  }
}

/**
 * @param {typeof DEFAULT_CONFIG} config
 * @param {string} target
 */
async function runRollback(config, target) {
  const releaseLock = await acquireLock(config);
  try {
    const current = await readCurrentVersion(config);
    const releases = await listReleaseVersions(config);
    const version = target || selectRollbackRelease(releases, current);
    if (!version) throw new Error(`没有可回滚的版本（当前 ${current || '未安装'}）`);
    if (!releases.includes(version)) throw new Error(`回滚目标 ${version} 不存在`);
    if (version === current) {
      log(`当前已经是 ${version}`);
      return;
    }
    await switchCurrent(config, version);
    await restartService(config);
    await waitHealthy(config);
    await writePin(config, version);
    log(`已回滚到 ${version} 并锁定；修复后执行 --unpin 恢复自动更新`);
  } finally {
    await releaseLock();
  }
}

async function runCheck(config) {
  const current = await readCurrentVersion(config);
  const pin = await readPin(config);
  const info = await fetchLatest(config);
  const decision = decideUpdate({ current, latest: info.version, pin });
  log(`当前版本：${current || '未安装'}`);
  log(`npm latest：${info.version}`);
  log(`pin：${pin || '无'}`);
  log(`下一步：${decision.reason}`);
}

function printHelp() {
  process.stdout.write(`用法：calmobile-update [--check | --update [--force] | --rollback [版本] | --pin <版本> | --unpin]

  --check       只打印当前版本、npm latest 和 pin
  --update      安装 npm latest（默认；timer 调用的就是它）
  --force       忽略 pin，强制更新
  --rollback    切回上一版并 pin；可指定目标版本
  --pin         锁定版本，timer 不再自动更新
  --unpin       解除锁定
`);
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.mode === 'help') {
    printHelp();
    return;
  }
  const config = await loadConfig();
  if (options.mode === 'check') {
    await runCheck(config);
    return;
  }
  if (options.mode === 'rollback') {
    await runRollback(config, options.version);
    return;
  }
  if (options.mode === 'pin') {
    parseVersion(options.version);
    await writePin(config, options.version);
    log(`已锁定在 ${options.version}`);
    return;
  }
  if (options.mode === 'unpin') {
    await clearPin(config);
    log('已解除版本锁定');
    return;
  }
  await runUpdate(config, { force: options.force });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    warn(`失败：${messageOf(error)}`);
    process.exit(1);
  });
}
