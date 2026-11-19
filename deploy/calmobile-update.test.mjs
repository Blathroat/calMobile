import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { REQUIRED_ENTRIES } from '../scripts/runtime-bundle.mjs';
import {
  DEFAULT_CONFIG,
  REQUIRED_RELEASE_ENTRIES,
  appShellAvailable,
  compareVersions,
  decideUpdate,
  ensureTarball,
  isVersion,
  legacyConfigWarning,
  normalizeConfig,
  parseCli,
  parseEnvText,
  registryLatestUrl,
  resolveConfig,
  selectRollbackRelease,
  verifyStagedRelease,
  verifyTarballIntegrity,
} from './calmobile-update.mjs';

const EMPTY_ENV = {};

test('版本比较按数字逐段进行', () => {
  assert.equal(compareVersions('0.1.9', '0.1.12'), -1);
  assert.equal(compareVersions('0.1.12', '0.1.12'), 0);
  assert.equal(compareVersions('0.1.100', '0.1.99'), 1);
  assert.throws(() => compareVersions('0.1', '0.1.2'), /版本号必须是 x\.y\.z/);
});

test('更新决策覆盖首次安装、已最新、更新和 pin', () => {
  assert.deepEqual(decideUpdate({ current: '', latest: '0.1.5', pin: '' }), {
    action: 'install',
    reason: '还没有安装版本，安装 0.1.5',
  });
  assert.equal(decideUpdate({ current: '0.1.5', latest: '0.1.5', pin: '' }).action, 'skip');
  assert.equal(decideUpdate({ current: '0.1.5', latest: '0.1.4', pin: '' }).action, 'skip');
  assert.equal(decideUpdate({ current: '0.1.5', latest: '0.1.6', pin: '' }).action, 'update');
  assert.match(decideUpdate({ current: '0.1.5', latest: '0.1.6', pin: '0.1.5' }).reason, /已锁定在 0\.1\.5/);
  assert.equal(decideUpdate({ current: '0.1.5', latest: '0.1.6', pin: '0.1.5', force: true }).action, 'update');
  assert.throws(() => decideUpdate({ current: '0.1.5', latest: '', pin: '' }), /latest 为空/);
});

test('回滚目标是比当前版本小的最新一版', () => {
  const releases = ['0.1.12', '0.1.10', '0.1.9', '0.1.12'];
  assert.equal(selectRollbackRelease(releases, '0.1.12'), '0.1.10');
  assert.equal(selectRollbackRelease(releases, '0.1.9'), '');
  assert.equal(selectRollbackRelease([], '0.1.9'), '');
  assert.equal(selectRollbackRelease(releases, ''), '');
});

test('tarball 完整性校验支持 npm 的 sha512 口径', () => {
  const content = Buffer.from('calmobile runtime tarball');
  const sha512 = `sha512-${createHash('sha512').update(content).digest('base64')}`;
  assert.equal(verifyTarballIntegrity(content, sha512), true);
  assert.equal(verifyTarballIntegrity(Buffer.from('tampered'), sha512), false);
  assert.equal(verifyTarballIntegrity(content, ''), false);
  assert.equal(verifyTarballIntegrity(content, 'sha512-not-base64'), false);
  const sha256 = `sha256-${createHash('sha256').update(content).digest('base64')}`;
  assert.equal(verifyTarballIntegrity(content, sha256), true);
});

test('npm latest 地址按包名编码', () => {
  const base = { ...DEFAULT_CONFIG, registry: 'https://registry.npmjs.org/' };
  assert.equal(registryLatestUrl(base), 'https://registry.npmjs.org/calmobile-server/latest');
  assert.equal(
    registryLatestUrl({ ...base, package: '@blathroat/calmobile' }),
    'https://registry.npmjs.org/@blathroat%2fcalmobile/latest',
  );
});

test('env 文件文本按 dotenv 规则解析', () => {
  const parsed = parseEnvText(`
# 注释行
CALMOBILE_PACKAGE=calmobile-server
CALMOBILE_REGISTRY="https://registry.npmmirror.com"
CALMOBILE_KEEP='5'
export CALMOBILE_MIN_FREE_MB=1024
CALMOBILE_HEALTH_URL=http://127.0.0.1:3000/ping # 行尾注释
NOT_A_CALMOBILE_KEY=ignored
`);
  assert.equal(parsed.CALMOBILE_PACKAGE, 'calmobile-server');
  assert.equal(parsed.CALMOBILE_REGISTRY, 'https://registry.npmmirror.com');
  assert.equal(parsed.CALMOBILE_KEEP, '5');
  assert.equal(parsed.CALMOBILE_MIN_FREE_MB, '1024');
  assert.equal(parsed.CALMOBILE_HEALTH_URL, 'http://127.0.0.1:3000/ping');
});

test('配置默认值、env 文件、进程环境和命令行按优先级合并', () => {
  const defaults = resolveConfig({ fileText: '', env: EMPTY_ENV });
  assert.equal(defaults.package, 'calmobile-server');
  assert.equal(defaults.root, '/opt/calmobile');
  assert.equal(defaults.keep, 3);
  assert.equal(defaults.envFile, '/etc/calmobile.env');
  assert.equal(defaults.user, 'blathroat');
  assert.equal(defaults.updateService, 'calmobile-update.service');
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, 'configPath'), false);

  const fromFile = resolveConfig({
    fileText: 'CALMOBILE_REGISTRY=https://registry.npmmirror.com/\nCALMOBILE_KEEP=5\nCALMOBILE_ROOT="/srv/calmobile"\n',
    env: EMPTY_ENV,
  });
  assert.equal(fromFile.registry, 'https://registry.npmmirror.com');
  assert.equal(fromFile.keep, 5);
  assert.equal(fromFile.root, '/srv/calmobile');

  const fromEnv = resolveConfig({
    fileText: 'CALMOBILE_KEEP=5\nCALMOBILE_REGISTRY=https://registry.npmmirror.com/\n',
    env: { CALMOBILE_KEEP: '4', CALMOBILE_USER: 'ops', CALMOBILE_ROOT: '/srv/from-env' },
  });
  assert.equal(fromEnv.keep, 4);
  assert.equal(fromEnv.user, 'ops');
  assert.equal(fromEnv.root, '/srv/from-env');

  const fromCli = resolveConfig({
    fileText: '',
    env: { CALMOBILE_ROOT: '/srv/from-env' },
    cli: { root: '/srv/from-cli', envFile: '/etc/other.env', service: 'custom.service' },
  });
  assert.equal(fromCli.root, '/srv/from-cli');
  assert.equal(fromCli.envFile, '/etc/other.env');
  assert.equal(fromCli.service, 'custom.service');
});

test('配置非法值在启动前报错', () => {
  assert.throws(() => normalizeConfig({ registry: 'ftp://example.com' }), /registry 必须是 http\(s\) 地址/);
  assert.throws(() => normalizeConfig({ root: 'relative/path' }), /root 必须是绝对路径/);
  assert.throws(() => normalizeConfig({ keep: 0 }), /keep 必须是 1\.\.10/);
  assert.throws(() => normalizeConfig({ user: 'bad user' }), /user 不是合法的用户\/组名/);
  assert.throws(() => normalizeConfig({ service: 'calmobile service' }), /service 含有不能用在 systemd 单元名里的字符/);
  assert.throws(() => normalizeConfig({ repositoryUrl: 'git@example.com' }), /repositoryUrl 必须是 http\(s\) 地址/);
});

test('旧 JSON 配置不再读取，只提示一次迁移', () => {
  const config = resolveConfig({
    fileText: JSON.stringify({ registry: 'https://old.example.com', keep: 9 }),
    env: EMPTY_ENV,
  });
  assert.equal(config.registry, DEFAULT_CONFIG.registry);
  assert.equal(config.keep, DEFAULT_CONFIG.keep);

  const warning = legacyConfigWarning({ env: { CALMOBILE_CONFIG_PATH: '/etc/calmobile-update.json' } });
  assert.match(warning, /已废弃/);
  assert.match(warning, /CALMOBILE_\*/);
  assert.match(legacyConfigWarning({ env: EMPTY_ENV, legacyExists: true }), /不再读取/);
  assert.equal(legacyConfigWarning({ env: EMPTY_ENV, legacyExists: false }), '');

  // CALMOBILE_CONFIG_PATH 只用来提示，不参与配置。
  const withLegacyEnv = resolveConfig({ fileText: '', env: { CALMOBILE_CONFIG_PATH: '/etc/old.json' } });
  assert.equal(withLegacyEnv.root, DEFAULT_CONFIG.root);
});

test('命令行参数解析与覆盖', () => {
  assert.deepEqual(parseCli([]), { mode: 'update', force: false, version: '', overrides: {} });
  assert.deepEqual(parseCli(['--check']), { mode: 'check', force: false, version: '', overrides: {} });
  assert.deepEqual(parseCli(['--update', '--force']), { mode: 'update', force: true, version: '', overrides: {} });
  assert.deepEqual(parseCli(['--rollback']), { mode: 'rollback', force: false, version: '', overrides: {} });
  assert.deepEqual(parseCli(['--rollback', '0.1.5']), {
    mode: 'rollback',
    force: false,
    version: '0.1.5',
    overrides: {},
  });
  assert.deepEqual(parseCli(['--pin', '0.1.5']), { mode: 'pin', force: false, version: '0.1.5', overrides: {} });
  assert.deepEqual(parseCli(['--unpin']), { mode: 'unpin', force: false, version: '', overrides: {} });
  assert.deepEqual(parseCli(['--env-file=/etc/other.env', '--root=/srv/app', '--service=custom.service']), {
    mode: 'update',
    force: false,
    version: '',
    overrides: { envFile: '/etc/other.env', root: '/srv/app', service: 'custom.service' },
  });
  assert.throws(() => parseCli(['--nope']), /不认识的参数/);
  assert.throws(() => parseCli(['--keep=5']), /不认识的参数/);
});

test('健康检查接受 3xx 重定向，不把 Host 不一致当缺产物', () => {
  assert.equal(appShellAvailable({ status: 200 }), true);
  assert.equal(appShellAvailable({ status: 308 }), true);
  assert.equal(appShellAvailable({ status: 404 }), false);
  assert.equal(appShellAvailable({ status: 500 }), false);
});

test('版本格式', () => {
  assert.equal(isVersion('0.1.12'), true);
  assert.equal(isVersion('0.1'), false);
  assert.equal(isVersion('v0.1.12'), false);
});

/** @param {string} root @param {string} relative @param {string} text */
async function writeFixture(root, relative, text) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

test('运行时包必须文件清单与 runtime-bundle 保持同步', () => {
  assert.deepEqual([...REQUIRED_RELEASE_ENTRIES].sort(), [...REQUIRED_ENTRIES].sort());
});

test('解压后的运行时包必须文件齐全且版本一致', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-release-'));
  try {
    /** @type {Record<string, string>} */
    const entries = {
      'package.json': '{"version":"0.1.7"}',
      'server/package.json': '{"version":"0.1.7"}',
      'server/pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'server/pnpm-workspace.yaml': 'allowBuilds:\n  esbuild: true\n',
      'server/dist/index.js': 'export {};\n',
      'server/dist/config/migrate.js': 'export {};\n',
      'server/dist/server/app-shell.js': 'export {};\n',
      'server/dist/server/join-site.js': 'export {};\n',
      'web/dist/index.html': '<!doctype html>\n',
      'web/dist/release.json': '{}\n',
      'server/dist/app-shell/index.html': '<!doctype html>\n',
      'web/dist-join/join.html': '<!doctype html>\n',
      'server/dist/app-shell-join/join.html': '<!doctype html>\n',
    };
    for (const entry of REQUIRED_RELEASE_ENTRIES) {
      if (!Object.prototype.hasOwnProperty.call(entries, entry)) entries[entry] = '// fixture\n';
    }
    for (const [relative, text] of Object.entries(entries)) {
      await writeFixture(directory, relative, text);
    }
    await verifyStagedRelease(directory, '0.1.7');
    await assert.rejects(verifyStagedRelease(directory, '0.1.8'), /版本是 0\.1\.7/);
    await rm(path.join(directory, 'web/dist/index.html'));
    await assert.rejects(verifyStagedRelease(directory, '0.1.7'), /缺文件/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('下载 tarball 会校验完整性并复用缓存', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-cache-'));
  const content = Buffer.from('calmobile runtime tarball fixture');
  const integrity = `sha512-${createHash('sha512').update(content).digest('base64')}`;
  const server = createServer((request, response) => {
    if (request.url === '/pkg.tgz') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(content);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const config = normalizeConfig({ root: directory, registry: 'http://127.0.0.1:1' });
  try {
    const tarballUrl = `http://127.0.0.1:${port}/pkg.tgz`;
    const first = await ensureTarball(config, { version: '0.1.2', tarball: tarballUrl, integrity });
    assert.equal((await readFile(first)).equals(content), true);

    await assert.rejects(
      ensureTarball(config, { version: '0.1.3', tarball: tarballUrl, integrity: 'sha512-wrong' }),
      /校验失败/,
    );

    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    const cached = await ensureTarball(config, { version: '0.1.2', tarball: tarballUrl, integrity });
    assert.equal(cached, first);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
