import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parseEnvFile } from './client-target.mjs';
import { REQUIRED_SERVER_SECRETS, SERVER_VALUE_KEYS, syncProductionEnv } from './sync-production-env.mjs';

const template = `
# 注释不进服务器
NODE_ENV=production
ENABLE_WEB=true
PORT=3000
`;

test('缺的键用模板和传入值补上，已有值和多出来的键不动', () => {
  const result = syncProductionEnv({
    currentText: 'ENABLE_WEB=false\nCUSTOM=kept\n# 保留\n',
    templateText: template,
    incoming: { APP_API_BASE: 'https://app.example.com/api/v1', JWT_SECRET: '' },
    requiredSecrets: [],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.added, ['NODE_ENV', 'PORT', 'APP_API_BASE']);
  const parsed = parseEnvFile(result.text);
  assert.equal(parsed.ENABLE_WEB, 'false');
  assert.equal(parsed.CUSTOM, 'kept');
  assert.equal(parsed.NODE_ENV, 'production');
  assert.equal(parsed.PORT, '3000');
  assert.equal(parsed.APP_API_BASE, 'https://app.example.com/api/v1');
  assert.equal(parsed.JWT_SECRET, undefined);
  assert.match(result.text, /# 保留/);
});

test('传入的新值不覆盖服务器上已有的值', () => {
  const result = syncProductionEnv({
    currentText: 'JWT_SECRET=server-value\n',
    templateText: 'JWT_SECRET=template-value\n',
    incoming: { JWT_SECRET: 'github-value' },
    requiredSecrets: ['JWT_SECRET'],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.added, []);
  assert.equal(parseEnvFile(result.text).JWT_SECRET, 'server-value');
});

test('空密钥不覆盖已有值', () => {
  const result = syncProductionEnv({
    currentText: 'JWT_SECRET=already-set\n',
    templateText: 'JWT_SECRET=from-template\n',
    incoming: { JWT_SECRET: '' },
    requiredSecrets: ['JWT_SECRET'],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.added, []);
  assert.equal(parseEnvFile(result.text).JWT_SECRET, 'already-set');
});

test('服务器上的空键可以用新值补上', () => {
  const result = syncProductionEnv({
    currentText: 'JWT_SECRET=\n',
    templateText: '',
    incoming: { JWT_SECRET: 'new-secret' },
    requiredSecrets: ['JWT_SECRET'],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(parseEnvFile(result.text).JWT_SECRET, 'new-secret');
});

test('必填密钥两边都没有时失败，并且不写出空值', () => {
  const result = syncProductionEnv({
    currentText: 'PORT=3000\n',
    templateText: template,
    incoming: {},
    requiredSecrets: ['JWT_SECRET', 'DB_PASSWORD'],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.missing, ['JWT_SECRET', 'DB_PASSWORD']);
});

test('含空格、井号和换行的值能再读回来', () => {
  const result = syncProductionEnv({
    currentText: '',
    templateText: '',
    incoming: { MAIL_SMTP_PASSWORD: 'p#ss word', ADMIN_EMAIL: 'ops@example.com' },
    requiredSecrets: [],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = parseEnvFile(result.text);
  assert.equal(parsed.MAIL_SMTP_PASSWORD, 'p#ss word');
  assert.equal(parsed.ADMIN_EMAIL, 'ops@example.com');
});

test('命令行只写入名单内的变量，输出不含值', () => {
  const directory = mkdtempSync(join(tmpdir(), 'calmobile-env-'));
  const currentPath = join(directory, 'current.env');
  const templatePath = join(directory, 'template.env');
  const outPath = join(directory, 'out.env');
  writeFileSync(currentPath, 'PORT=9\n');
  writeFileSync(templatePath, 'LOG_LEVEL=info\n');
  const secret = 'super-secret-value';
  const env = { ...process.env, NOT_A_SERVER_KEY: 'leak-me' };
  for (const key of REQUIRED_SERVER_SECRETS) env[key] = secret;
  env.APP_API_BASE = 'https://app.example.com/api/v1';
  const result = spawnSync(
    process.execPath,
    ['scripts/sync-production-env.mjs', '--current', currentPath, '--template', templatePath, '--out', outPath],
    {
      cwd: join(import.meta.dirname, '..'),
      env,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret-value|leak-me/);
  const parsed = parseEnvFile(readFileSync(outPath, 'utf8'));
  assert.equal(parsed.PORT, '9');
  assert.equal(parsed.LOG_LEVEL, 'info');
  assert.equal(parsed.JWT_SECRET, secret);
  assert.equal(parsed.APP_API_BASE, 'https://app.example.com/api/v1');
  assert.equal(parsed.NOT_A_SERVER_KEY, undefined);
  assert.equal(parsed.PATH, undefined);
});

test('缺必填密钥时命令行失败且不写输出文件', () => {
  const directory = mkdtempSync(join(tmpdir(), 'calmobile-env-'));
  const currentPath = join(directory, 'current.env');
  const templatePath = join(directory, 'template.env');
  const outPath = join(directory, 'out.env');
  writeFileSync(currentPath, '');
  writeFileSync(templatePath, 'PORT=3000\n');
  const env = { ...process.env };
  for (const key of REQUIRED_SERVER_SECRETS) env[key] = '';
  const result = spawnSync(
    process.execPath,
    ['scripts/sync-production-env.mjs', '--current', currentPath, '--template', templatePath, '--out', outPath],
    {
      cwd: join(import.meta.dirname, '..'),
      env,
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET/);
  assert.equal(result.stdout, '');
  assert.throws(() => readFileSync(outPath, 'utf8'));
});

test('发布工作流把名单里的每个键都传给部署，签名密钥不进这一步', () => {
  const yaml = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const deploy = yaml.split(/^  deploy-server:/m)[1] ?? '';
  assert.notEqual(deploy, '');
  for (const key of SERVER_VALUE_KEYS) {
    assert.match(deploy, new RegExp(`^\\s+${key}:`, 'm'));
  }
  assert.doesNotMatch(deploy, /ANDROID_/);
  assert.ok(SERVER_VALUE_KEYS.every((key) => !key.startsWith('ANDROID_')));
});
