import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  DEFAULT_PACKAGE_NAME,
  REQUIRED_ENTRIES,
  listFiles,
  resolvePackageName,
  rewriteServerPackage,
  runtimePackageJson,
  stageRuntimePackage,
  verifyRuntimeManifest,
  verifyRuntimePackage,
} from './runtime-bundle.mjs';

/** @type {string} */
let fixtureRoot;

/** @param {string} root @param {string} relative @param {string} text */
async function write(root, relative, text) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

before(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'calmobile-runtime-'));
  await write(fixtureRoot, 'server/package.json', '{"name":"calmobile-server","version":"1.0.0","type":"module"}\n');
  await write(fixtureRoot, 'server/pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  await write(fixtureRoot, 'server/pnpm-workspace.yaml', 'allowBuilds:\n  esbuild: true\n');
  await write(fixtureRoot, 'server/dist/index.js', 'export {};\n');
  await write(fixtureRoot, 'server/dist/config/migrate.js', 'export {};\n');
  await write(fixtureRoot, 'server/dist/server/app-shell.js', 'export {};\n');
  await write(fixtureRoot, 'server/dist/server/join-site.js', 'export {};\n');
  await write(fixtureRoot, 'server/src/index.ts', 'export {};\n');
  await write(fixtureRoot, 'web/dist/index.html', '<!doctype html><title>app</title>\n');
  await write(fixtureRoot, 'web/dist/release.json', '{"id":"abc","files":[]}\n');
  await write(fixtureRoot, 'web/dist-join/join.html', '<!doctype html><title>join</title>\n');
  await write(fixtureRoot, 'web/src/main.ts', 'export {};\n');
  await write(fixtureRoot, 'deploy/production.env', 'NODE_ENV=production\nPORT=3000\n');
  await write(fixtureRoot, 'deploy/instance.env.example', 'CALMOBILE_ROOT=/opt/calmobile\n');
  await write(fixtureRoot, 'deploy/calmobile-update.mjs', '// updater\n');
  await write(fixtureRoot, 'deploy/systemd/calmobile.service.in', '[Service]\n');
  await write(fixtureRoot, 'deploy/systemd/calmobile-update.service.in', '[Service]\n');
  await write(fixtureRoot, 'deploy/systemd/calmobile-update.timer.in', '[Timer]\n');
  await write(fixtureRoot, 'scripts/sync-production-env.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/client-target.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/env-file.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/build-icons.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/icons/png.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/icons/config.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/icons/web.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/icons/android.mjs', 'export {};\n');
  await write(fixtureRoot, 'scripts/render-units.mjs', 'export {};\n');
});

after(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

test('暂存运行时包保持 server 与 web 同级，并写入发布版本', async () => {
  const outDir = path.join(fixtureRoot, '.out');
  const result = await stageRuntimePackage({ repoRoot: fixtureRoot, outDir, version: '0.1.42' });
  assert.equal(result.version, '0.1.42');

  const files = await listFiles(outDir);
  for (const entry of REQUIRED_ENTRIES) assert.ok(files.includes(entry), `缺少 ${entry}`);
  assert.ok(!files.some((file) => file.startsWith('server/src/')), '源码不应进包');
  assert.ok(!files.some((file) => file.startsWith('web/src/')), '源码不应进包');

  const rootPackage = JSON.parse(await readFile(path.join(outDir, 'package.json'), 'utf8'));
  assert.equal(rootPackage.name, DEFAULT_PACKAGE_NAME);
  assert.equal(rootPackage.version, '0.1.42');

  const serverPackage = JSON.parse(await readFile(path.join(outDir, 'server/package.json'), 'utf8'));
  assert.equal(serverPackage.version, '0.1.42');
});

test('缺少构建产物时拒绝暂存', async () => {
  const brokenRoot = await mkdtemp(path.join(tmpdir(), 'calmobile-runtime-broken-'));
  try {
    const outDir = path.join(brokenRoot, '.out');
    await assert.rejects(stageRuntimePackage({ repoRoot: brokenRoot, outDir, version: '0.1.1' }), /缺少构建产物/);
  } finally {
    await rm(brokenRoot, { recursive: true, force: true });
  }
});

test('校验会发现缺文件和多余源码', async () => {
  const outDir = path.join(fixtureRoot, '.check');
  await stageRuntimePackage({ repoRoot: fixtureRoot, outDir, version: '0.1.43' });
  await verifyRuntimePackage(outDir, '0.1.43');

  await write(outDir, 'server/src/secret.ts', 'export {};\n');
  await assert.rejects(verifyRuntimePackage(outDir), /不该打包：server\/src\/secret\.ts/);

  await rm(path.join(outDir, 'web/dist/index.html'));
  await assert.rejects(verifyRuntimePackage(outDir), /缺少 web\/dist\/index\.html/);
});

test('清单校验只认包内相对路径', () => {
  assert.deepEqual(verifyRuntimeManifest(REQUIRED_ENTRIES), []);
  assert.deepEqual(verifyRuntimeManifest([...REQUIRED_ENTRIES, 'server/src/a.ts']), ['不该打包：server/src/a.ts']);
});

test('包名默认 calmobile-server，可由 CALMOBILE_PACKAGE 覆盖', () => {
  const previous = process.env.CALMOBILE_PACKAGE;
  delete process.env.CALMOBILE_PACKAGE;
  try {
    assert.equal(DEFAULT_PACKAGE_NAME, 'calmobile-server');
    assert.equal(resolvePackageName({}), DEFAULT_PACKAGE_NAME);
    assert.equal(resolvePackageName({ CALMOBILE_PACKAGE: 'custom-runtime' }), 'custom-runtime');
    assert.throws(() => resolvePackageName({ CALMOBILE_PACKAGE: 'bad name' }), /合法的 npm 包名/);
    assert.equal(runtimePackageJson('0.1.7').name, DEFAULT_PACKAGE_NAME);
    assert.equal(runtimePackageJson('0.1.7', 'custom-runtime').name, 'custom-runtime');
  } finally {
    if (previous === undefined) delete process.env.CALMOBILE_PACKAGE;
    else process.env.CALMOBILE_PACKAGE = previous;
  }
});

test('版本号必须是 x.y.z，改写只动 server 版本', () => {
  assert.throws(() => runtimePackageJson('1.0'), /版本号必须是 x\.y\.z/);
  const rewritten = rewriteServerPackage('{"name":"calmobile-server","version":"1.0.0","type":"module"}\n', '0.1.7');
  assert.deepEqual(JSON.parse(rewritten), { name: 'calmobile-server', version: '0.1.7', type: 'module' });
});
