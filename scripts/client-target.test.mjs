import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBuildEnv, parseEnvFile, resolveClientTarget } from './client-target.mjs';

test('没配 APP_API_BASE 时用本机和 PORT', () => {
  const target = resolveClientTarget({ PORT: '8080' });
  assert.equal(target.apiBase, 'http://127.0.0.1:8080/api/v1');
  assert.equal(target.mediaOrigin, 'http://127.0.0.1:8080');
  assert.equal(target.allowCleartext, true);
  assert.equal(target.loopbackPort, 8080);
  assert.equal(target.applicationId, 'com.blathroat.calmobile');
  assert.equal(target.versionCode, 1);
  assert.equal(target.versionName, '0.1.0');
});

test('https 地址关掉明文，并忽略尾斜杠', () => {
  const target = resolveClientTarget({
    APP_API_BASE: 'https://app.example.com/api/v1/',
    ANDROID_APPLICATION_ID: 'app.calmobile',
    ANDROID_VERSION_CODE: '12',
    ANDROID_VERSION_NAME: '1.2.0',
  });
  assert.equal(target.apiBase, 'https://app.example.com/api/v1');
  assert.equal(target.allowCleartext, false);
  assert.equal(target.loopbackPort, null);
  assert.equal(target.applicationId, 'app.calmobile');
  assert.equal(target.versionCode, 12);
  assert.equal(target.versionName, '1.2.0');
});

test('本机 https 仍标成回环，留给正式包构建拒绝', () => {
  const target = resolveClientTarget({ APP_API_BASE: 'https://127.0.0.1/api/v1' });
  assert.equal(target.allowCleartext, false);
  assert.equal(target.loopbackPort, 443);
});

test('非法地址、路径、包名和版本在构建前失败', () => {
  assert.throws(() => resolveClientTarget({ APP_API_BASE: 'app.example.com/api/v1' }), /绝对地址/);
  assert.throws(() => resolveClientTarget({ APP_API_BASE: 'https://app.example.com/api' }), /\/api\/v1/);
  assert.throws(() => resolveClientTarget({ APP_API_BASE: 'https://user:pw@app.example.com/api/v1' }), /用户信息/);
  assert.throws(() => resolveClientTarget({ ANDROID_APPLICATION_ID: 'calmobile' }), /包名/);
  assert.throws(() => resolveClientTarget({ ANDROID_VERSION_CODE: '0' }), /正整数/);
  assert.throws(() => resolveClientTarget({ ANDROID_VERSION_NAME: '1.0 测试' }), /版本名/);
});

test('环境文件里的注释和引号按值读，进程里的非空变量优先', () => {
  const parsed = parseEnvFile(`
# 注释
APP_API_BASE=http://127.0.0.1:3000/api/v1
ANDROID_KEYSTORE_PASSWORD="a#b"
EMPTY=
`);
  assert.equal(parsed.APP_API_BASE, 'http://127.0.0.1:3000/api/v1');
  assert.equal(parsed.ANDROID_KEYSTORE_PASSWORD, 'a#b');
  assert.equal(parsed.EMPTY, '');

  const merged = loadBuildEnv({ APP_API_BASE: 'https://app.example.com/api/v1', PORT: '' }, 'APP_API_BASE=http://127.0.0.1:9/api/v1\nPORT=4000\n');
  assert.equal(merged.APP_API_BASE, 'https://app.example.com/api/v1');
  assert.equal(merged.PORT, '4000');
});

test('签名变量原样交给 Gradle，不在这里判断正式包', () => {
  const target = resolveClientTarget({
    ANDROID_KEYSTORE_PATH: ' C:/keys/app.jks ',
    ANDROID_KEYSTORE_PASSWORD: 'secret',
    ANDROID_KEY_ALIAS: 'upload',
    ANDROID_KEY_PASSWORD: 'secret',
  });
  assert.deepEqual(target.signing, {
    storeFile: 'C:/keys/app.jks',
    storePassword: 'secret',
    keyAlias: 'upload',
    keyPassword: 'secret',
  });
});
