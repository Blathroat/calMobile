import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadUnitTemplates, renderUnits, timerUnitName } from './render-units.mjs';

const CONFIG = {
  user: 'calmobile',
  group: 'calmobile',
  root: '/opt/calmobile',
  envFile: '/etc/calmobile.env',
  service: 'calmobile.service',
  updateService: 'calmobile-update.service',
  updaterPath: '/usr/local/lib/calmobile/calmobile-update.mjs',
  node: '/usr/bin/node',
  repositoryUrl: 'https://github.com/Blathroat/calMobile',
  templates: {
    service:
      '[Service]\nUser=@CALMOBILE_USER@\nGroup=@CALMOBILE_GROUP@\nWorkingDirectory=@CALMOBILE_ROOT@/current/server\nEnvironmentFile=@CALMOBILE_ENV_FILE@\n',
    updateService:
      '[Service]\nExecStart=@CALMOBILE_NODE@ @CALMOBILE_UPDATER_PATH@ --update\nEnvironment=HOME=/home/@CALMOBILE_USER@\n',
    timer: '[Timer]\nUnit=@CALMOBILE_UPDATE_SERVICE@\n',
  },
};

test('三个单元按配置渲染，文件名来自服务名', () => {
  const units = renderUnits(CONFIG);
  assert.deepEqual(
    units.map((unit) => unit.name),
    ['calmobile.service', 'calmobile-update.service', 'calmobile-update.timer'],
  );
  assert.match(units[0].content, /User=calmobile/);
  assert.match(units[0].content, /Group=calmobile/);
  assert.match(units[0].content, /WorkingDirectory=\/opt\/calmobile\/current\/server/);
  assert.match(units[0].content, /EnvironmentFile=\/etc\/calmobile\.env/);
  assert.match(
    units[1].content,
    /ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/calmobile\/calmobile-update\.mjs --update/,
  );
  assert.match(units[2].content, /Unit=calmobile-update\.service/);
  for (const unit of units) assert.doesNotMatch(unit.content, /@CALMOBILE_/);
});

test('未知占位符、缺模板和缺配置都会报错', () => {
  assert.throws(
    () => renderUnits({ ...CONFIG, templates: { ...CONFIG.templates, timer: '[Timer]\nUnit=@CALMOBILE_NOPE@\n' } }),
    /未知占位符/,
  );
  assert.throws(
    () => renderUnits({ ...CONFIG, templates: { service: '', updateService: CONFIG.templates.updateService, timer: CONFIG.templates.timer } }),
    /缺少单元模板/,
  );
  assert.throws(() => renderUnits({ ...CONFIG, service: '' }), /缺少配置：service/);
});

test('timer 名从更新服务名派生', () => {
  assert.equal(timerUnitName('calmobile-update.service'), 'calmobile-update.timer');
  assert.equal(timerUnitName('custom-update'), 'custom-update.timer');
});

test('仓库里的模板能完整渲染', () => {
  const units = renderUnits({ ...CONFIG, templates: loadUnitTemplates() });
  assert.deepEqual(
    units.map((unit) => unit.name),
    ['calmobile.service', 'calmobile-update.service', 'calmobile-update.timer'],
  );
  assert.match(
    units[0].content,
    /Documentation=https:\/\/github\.com\/Blathroat\/calMobile\/blob\/master\/docs\/operations\.md/,
  );
  assert.match(units[0].content, /ExecStartPre=.*test -f \/opt\/calmobile\/current\/web\/dist\/index\.html/);
  assert.match(units[0].content, /ExecStartPre=.*dist-join\/join\.html/);
  assert.match(units[0].content, /ExecStart=\/usr\/bin\/node dist\/index\.js --production/);
  assert.match(units[1].content, /Environment=PATH=\/usr\/local\/bin:\/usr\/bin:\/bin/);
  assert.match(units[1].content, /TimeoutStartSec=300/);
  assert.match(units[2].content, /OnUnitActiveSec=5min/);
  for (const unit of units) assert.doesNotMatch(unit.content, /@CALMOBILE_/);
});

test('CLI 用实例 env 示例渲染到临时目录', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'calmobile-units-'));
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CALMOBILE_')) delete env[key];
    const result = spawnSync(
      process.execPath,
      ['scripts/render-units.mjs', '--env-file', 'deploy/instance.env.example', '--out', dir],
      { cwd: path.join(import.meta.dirname, '..'), env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(dir).sort(), [
      'calmobile-update.service',
      'calmobile-update.timer',
      'calmobile.service',
    ]);
    const service = readFileSync(path.join(dir, 'calmobile.service'), 'utf8');
    assert.match(service, /User=blathroat/);
    assert.match(service, /WorkingDirectory=\/opt\/calmobile\/current\/server/);
    assert.doesNotMatch(service, /@CALMOBILE_/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
